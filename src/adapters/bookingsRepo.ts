import type { BookingRecord, BookingStatus } from '../domain/booking.js';
import type { JobType, Urgency } from '../domain/catalogue.js';
import type { Quote } from '../domain/pricing.js';
import type { Db } from './db.js';

export interface NewBooking extends Omit<BookingRecord, 'status'> {
  idempotencyKey: string;
}

export interface BookedSlot {
  engineerId: string;
  windowStart: Date;
}

export interface BookingsRepo {
  findByIdempotencyKey(key: string): Promise<BookingRecord | null>;
  findByReference(reference: string): Promise<BookingRecord | null>;
  /**
   * Inserts a confirmed booking unless the engineer already has a confirmed one at that window start (returns null then).
   * Other unique violations (idempotency key, reference) are thrown as database errors.
   */
  insertIfFree(booking: NewBooking): Promise<BookingRecord | null>;
  /** Cancels a confirmed booking. Returns null if there was no confirmed booking with that reference. */
  cancel(reference: string, cancelledAt: Date): Promise<BookingRecord | null>;
  /** Confirmed bookings whose window starts within [from, to]. */
  bookedSlots(from: Date, to: Date): Promise<BookedSlot[]>;
}

interface BookingRow {
  reference: string;
  status: BookingStatus;
  job_type: JobType;
  urgency: Urgency;
  engineer_id: string;
  window_start: string | Date;
  window_end: string | Date;
  postcode: string;
  address_line1: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  problem_description: string;
  quote: Quote;
}

function toRecord(row: BookingRow): BookingRecord {
  return {
    reference: row.reference,
    status: row.status,
    jobType: row.job_type,
    urgency: row.urgency,
    engineerId: row.engineer_id,
    windowStart: new Date(row.window_start),
    windowEnd: new Date(row.window_end),
    postcode: row.postcode,
    addressLine1: row.address_line1,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email,
    problemDescription: row.problem_description,
    quote: row.quote,
  };
}

export function createBookingsRepo(db: Db): BookingsRepo {
  return {
    async findByIdempotencyKey(key) {
      const rows = await db.query<BookingRow>('select * from bookings where idempotency_key = $1', [key]);
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async findByReference(reference) {
      const rows = await db.query<BookingRow>('select * from bookings where reference = $1', [reference]);
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async insertIfFree(b) {
      const rows = await db.query<BookingRow>(
        `insert into bookings
           (reference, idempotency_key, status, job_type, urgency, engineer_id, window_start, window_end,
            postcode, address_line1, customer_name, customer_phone, customer_email, problem_description, quote)
         values ($1, $2, 'confirmed', $3, $4, $5, $6::timestamptz, $7::timestamptz, $8, $9, $10, $11, $12, $13, $14::jsonb)
         on conflict (engineer_id, window_start) where status = 'confirmed' do nothing
         returning *`,
        [
          b.reference, b.idempotencyKey, b.jobType, b.urgency, b.engineerId, b.windowStart.toISOString(), b.windowEnd.toISOString(),
          b.postcode, b.addressLine1, b.customerName, b.customerPhone, b.customerEmail, b.problemDescription, JSON.stringify(b.quote),
        ],
      );
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async cancel(reference, cancelledAt) {
      const rows = await db.query<BookingRow>(
        `update bookings set status = 'cancelled', cancelled_at = $2::timestamptz
         where reference = $1 and status = 'confirmed' returning *`,
        [reference, cancelledAt.toISOString()],
      );
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async bookedSlots(from, to) {
      const rows = await db.query<{ engineer_id: string; window_start: string | Date }>(
        `select engineer_id, window_start from bookings
         where status = 'confirmed' and window_start >= $1::timestamptz and window_start <= $2::timestamptz`,
        [from.toISOString(), to.toISOString()],
      );
      return rows.map((r) => ({ engineerId: r.engineer_id, windowStart: new Date(r.window_start) }));
    },
  };
}
