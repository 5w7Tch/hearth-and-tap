import { getEngineer, getJob, type JobType, type Urgency } from './catalogue.js';
import { AppError } from './errors.js';
import type { Quote } from './pricing.js';
import { describeWindow, toLondonIso, type Window } from './windows.js';

export type BookingStatus = 'confirmed' | 'cancelled';

/** A booking as stored. */
export interface BookingRecord {
  reference: string;
  status: BookingStatus;
  jobType: JobType;
  urgency: Urgency;
  engineerId: string;
  windowStart: Date;
  windowEnd: Date;
  postcode: string;
  addressLine1: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  problemDescription: string;
  quote: Quote;
}

/** A booking as shown to the customer (no phone or email echoed back). */
export type BookingView = {
  reference: string;
  status: BookingStatus;
  jobType: JobType;
  jobLabel: string;
  urgency: Urgency;
  window: Window;
  engineer: { firstName: string };
  postcode: string;
  addressLine1: string;
  customerName: string;
  quote: Quote;
  /** Last moment the customer can cancel, ISO 8601 with the London offset. */
  cancellableUntil: string;
}

const CANCEL_NOTICE_MS = 2 * 60 * 60 * 1000;
/** +44 then a 9-10 digit national number that does not start with 0. */
const UK_PHONE = /^\+44[1-9]\d{8,9}$/;

export function cancelDeadline(windowStart: Date): Date {
  return new Date(windowStart.getTime() - CANCEL_NOTICE_MS);
}

/** Cancelling is allowed up to and including the deadline. */
export function canCancel(windowStart: Date, now: Date): boolean {
  return now.getTime() <= cancelDeadline(windowStart).getTime();
}

/**
 * Canonical +44 form, so "07700 900123", "+44 7700 900123" and "+44 (0)7700 900123" are the same phone.
 * That matters for idempotent replay.
 */
export function normalisePhone(input: string): string {
  let n = input.replace(/[\s\-().]/g, '');
  if (n.startsWith('0044')) n = `+${n.slice(2)}`;
  if (n.startsWith('+440')) n = `+44${n.slice(4)}`;
  else if (n.startsWith('0')) n = `+44${n.slice(1)}`;
  if (!UK_PHONE.test(n)) {
    throw new AppError('VALIDATION_ERROR', 'That does not look like a UK phone number (for example 07700 900123 or +44 20 7946 0000).');
  }
  return n;
}

export function toBookingView(record: BookingRecord): BookingView {
  return {
    reference: record.reference,
    status: record.status,
    jobType: record.jobType,
    jobLabel: getJob(record.jobType).label,
    urgency: record.urgency,
    window: { ...describeWindow(record.windowStart, record.windowEnd), tier: record.quote.tier },
    engineer: { firstName: getEngineer(record.engineerId).firstName },
    postcode: record.postcode,
    addressLine1: record.addressLine1,
    customerName: record.customerName,
    quote: record.quote,
    cancellableUntil: toLondonIso(cancelDeadline(record.windowStart)),
  };
}
