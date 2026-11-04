import { isUniqueViolation } from '../adapters/db.js';
import type { NewBooking } from '../adapters/bookingsRepo.js';
import type { Deps } from '../deps.js';
import { eligibleEngineers } from '../domain/allocation.js';
import { canCancel, normalisePhone, toBookingView, type BookingRecord, type BookingView } from '../domain/booking.js';
import { getJob, type JobType, type Urgency } from '../domain/catalogue.js';
import { normalisePostcode } from '../domain/area.js';
import { AppError } from '../domain/errors.js';
import { quoteVisit, requireCoveredArea, requireWindow } from './visit.js';

export interface BookVisitRequest {
  jobType: JobType;
  urgency: Urgency;
  postcode: string;
  addressLine1: string;
  windowStart: string;
  customer: { name: string; phone: string; email?: string | undefined };
  problemDescription: string;
}

export interface BookVisitResult {
  booking: BookingView;
  /** False when the idempotency key had already been used and the original booking is returned. */
  created: boolean;
}

const NOT_FOUND = () => new AppError('NOT_FOUND', 'We could not find a booking with that reference and postcode.');

async function buildNewBooking(deps: Deps, request: BookVisitRequest, idempotencyKey: string): Promise<Omit<NewBooking, 'reference' | 'engineerId'>> {
  const job = getJob(request.jobType);
  const area = await requireCoveredArea(deps, request.postcode);
  const window = await requireWindow(deps, job, request.urgency, request.windowStart);
  return {
    idempotencyKey,
    jobType: request.jobType,
    urgency: request.urgency,
    windowStart: new Date(window.start),
    windowEnd: new Date(window.end),
    postcode: area.postcode,
    addressLine1: request.addressLine1,
    customerName: request.customer.name,
    customerPhone: normalisePhone(request.customer.phone),
    customerEmail: request.customer.email ?? null,
    problemDescription: request.problemDescription,
    quote: quoteVisit(job, area, request.urgency, window.tier),
  };
}

/**
 * Tries one engineer. A unique violation that is not the engineer/window rule means either a racing request
 * with the same idempotency key (return its booking) or a reference clash (retry once with a fresh reference).
 */
async function tryEngineer(deps: Deps, booking: Omit<NewBooking, 'reference'>): Promise<{ record: BookingRecord; created: boolean } | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      const record = await deps.bookings.insertIfFree({ ...booking, reference: deps.newReference() });
      return record && { record, created: true };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const existing = await deps.bookings.findByIdempotencyKey(booking.idempotencyKey);
      if (existing) return { record: existing, created: false };
      if (attempt > 0) throw err;
    }
  }
}

/**
 * A key that was already used returns its booking only for the same request (job, window, postcode, phone).
 * Otherwise it is IDEMPOTENCY_KEY_REUSED. A guessable key such as "booking-1" must never hand one
 * customer another customer's booking.
 */
function replay(existing: BookingRecord, request: BookVisitRequest): BookVisitResult {
  const sameRequest =
    existing.jobType === request.jobType &&
    existing.windowStart.getTime() === new Date(request.windowStart).getTime() &&
    existing.postcode === normalisePostcode(request.postcode) &&
    existing.customerPhone === normalisePhone(request.customer.phone);
  if (!sameRequest) {
    throw new AppError('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for a different booking. Generate a new random key (for example a UUID) and call again.');
  }
  return { booking: toBookingView(existing), created: false };
}

export async function bookVisit(deps: Deps, request: BookVisitRequest, idempotencyKey: string): Promise<BookVisitResult> {
  const existing = await deps.bookings.findByIdempotencyKey(idempotencyKey);
  if (existing) return replay(existing, request);

  const base = await buildNewBooking(deps, request, idempotencyKey);
  for (const engineer of eligibleEngineers(getJob(request.jobType))) {
    const result = await tryEngineer(deps, { ...base, engineerId: engineer.id });
    if (result) return result.created ? { booking: toBookingView(result.record), created: true } : replay(result.record, request);
  }
  throw new AppError('SLOT_UNAVAILABLE', 'Sorry, that arrival window has just been taken. Call find_availability and offer the customer another window.');
}

/** Finds a booking by reference + postcode. Unknown reference and wrong postcode are deliberately indistinguishable. */
async function findOwnBooking(deps: Deps, reference: string, rawPostcode: string): Promise<BookingRecord> {
  const postcode = normalisePostcode(rawPostcode);
  const record = await deps.bookings.findByReference(reference.trim().toUpperCase());
  if (!record || record.postcode !== postcode) throw NOT_FOUND();
  return record;
}

export async function getBooking(deps: Deps, reference: string, postcode: string): Promise<BookingView> {
  return toBookingView(await findOwnBooking(deps, reference, postcode));
}

export async function cancelBooking(deps: Deps, reference: string, postcode: string): Promise<BookingView> {
  const record = await findOwnBooking(deps, reference, postcode);
  if (record.status === 'cancelled') return toBookingView(record);
  if (!canCancel(record.windowStart, deps.now())) {
    throw new AppError('TOO_LATE_TO_CANCEL', 'Bookings can only be cancelled up to 2 hours before the arrival window. Please call us instead.');
  }
  // null means a concurrent request cancelled it first, so the stored booking is the answer.
  const cancelled = (await deps.bookings.cancel(record.reference, deps.now())) ?? (await deps.bookings.findByReference(record.reference));
  if (!cancelled) throw NOT_FOUND();
  return toBookingView(cancelled);
}
