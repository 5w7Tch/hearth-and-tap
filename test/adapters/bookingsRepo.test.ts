import { beforeEach, describe, expect, it } from 'vitest';
import { createBookingsRepo, type BookingsRepo, type NewBooking } from '../../src/adapters/bookingsRepo.js';
import { isUniqueViolation, type Db } from '../../src/adapters/db.js';
import { getJob } from '../../src/domain/catalogue.js';
import { priceJob } from '../../src/domain/pricing.js';
import { migratedDb } from '../fakes/db.js';

function newBooking(overrides: Partial<NewBooking> = {}): NewBooking {
  return {
    reference: 'HT-000001',
    idempotencyKey: 'key-00000001',
    jobType: 'boiler_service',
    urgency: 'standard',
    engineerId: 'eng_dan',
    windowStart: new Date('2026-11-09T08:00:00Z'),
    windowEnd: new Date('2026-11-09T10:00:00Z'),
    postcode: 'SW4 7AA',
    addressLine1: '14 Acre Lane',
    customerName: 'Sam Carter',
    customerPhone: '07700900123',
    customerEmail: null,
    problemDescription: 'Annual service',
    quote: priceJob({ job: getJob('boiler_service'), tier: 'standard', urgency: 'standard', travelFeePence: 0 }),
    ...overrides,
  };
}

describe('bookings repo (PGlite)', () => {
  let db: Db;
  let repo: BookingsRepo;
  beforeEach(async () => {
    db = await migratedDb();
    repo = createBookingsRepo(db);
  });

  it('inserts, and reads back by reference and by idempotency key, with the quote snapshot as jsonb', async () => {
    const input = newBooking();
    const saved = await repo.insertIfFree(input);
    expect(saved).toMatchObject({ reference: 'HT-000001', status: 'confirmed', engineerId: 'eng_dan', customerEmail: null });
    expect(saved?.windowStart).toEqual(input.windowStart);
    expect(saved?.quote).toEqual(input.quote);
    expect(await repo.findByReference('HT-000001')).toEqual(saved);
    expect(await repo.findByIdempotencyKey('key-00000001')).toEqual(saved);
    expect(await repo.findByReference('HT-NOPE00')).toBeNull();
    const [row] = await db.query<{ type: string }>(`select jsonb_typeof(quote) as type from bookings`);
    expect(row?.type).toBe('object');
  });

  it('returns null (does not throw) when the engineer is already booked for that window', async () => {
    await repo.insertIfFree(newBooking());
    const clash = await repo.insertIfFree(newBooking({ reference: 'HT-000002', idempotencyKey: 'key-00000002' }));
    expect(clash).toBeNull();
    expect(await db.query('select 1 from bookings')).toHaveLength(1);
  });

  it('a raw duplicate confirmed insert violates the partial unique index', async () => {
    await repo.insertIfFree(newBooking());
    const err = await db
      .query(
        `insert into bookings (reference, idempotency_key, status, job_type, urgency, engineer_id, window_start, window_end, postcode, address_line1, customer_name, customer_phone, problem_description, quote)
         values ('HT-000009', 'key-00000009', 'confirmed', 'boiler_service', 'standard', 'eng_dan', '2026-11-09T08:00:00Z', '2026-11-09T10:00:00Z', 'SW4 7AA', 'x', 'x', 'x', 'x', '{}')`,
      )
      .catch((e: unknown) => e);
    expect(isUniqueViolation(err)).toBe(true);
    expect(err).toMatchObject({ constraint: 'bookings_engineer_window_confirmed' });
  });

  it('throws a unique violation naming the constraint for a reused idempotency key or reference', async () => {
    await repo.insertIfFree(newBooking());
    const sameKey = await repo.insertIfFree(newBooking({ reference: 'HT-000002', engineerId: 'eng_priya' })).catch((e: unknown) => e);
    expect(sameKey).toMatchObject({ code: '23505', constraint: 'bookings_idempotency_key_key' });
    const sameRef = await repo.insertIfFree(newBooking({ idempotencyKey: 'key-00000002', engineerId: 'eng_priya' })).catch((e: unknown) => e);
    expect(sameRef).toMatchObject({ code: '23505', constraint: 'bookings_reference_key' });
  });

  it('frees the slot when a booking is cancelled, so it can be booked again', async () => {
    await repo.insertIfFree(newBooking());
    const at = new Date('2026-11-05T10:00:00Z');
    expect(await repo.cancel('HT-000001', at)).toMatchObject({ status: 'cancelled' });
    expect(await repo.cancel('HT-000001', at)).toBeNull();
    expect(await repo.cancel('HT-UNKNOWN', at)).toBeNull();
    const rebooked = await repo.insertIfFree(newBooking({ reference: 'HT-000002', idempotencyKey: 'key-00000002' }));
    expect(rebooked).toMatchObject({ reference: 'HT-000002', status: 'confirmed' });
  });

  it('bookedSlots returns only confirmed bookings inside the inclusive range', async () => {
    await repo.insertIfFree(newBooking());
    await repo.insertIfFree(newBooking({ reference: 'HT-000002', idempotencyKey: 'key-00000002', windowStart: new Date('2026-11-09T10:00:00Z'), windowEnd: new Date('2026-11-09T12:00:00Z') }));
    await repo.insertIfFree(newBooking({ reference: 'HT-000003', idempotencyKey: 'key-00000003', windowStart: new Date('2026-11-10T10:00:00Z'), windowEnd: new Date('2026-11-10T12:00:00Z') }));
    await repo.cancel('HT-000002', new Date('2026-11-05T10:00:00Z'));
    const slots = await repo.bookedSlots(new Date('2026-11-09T08:00:00Z'), new Date('2026-11-10T10:00:00Z'));
    expect(slots.map((s) => s.windowStart.toISOString())).toEqual(['2026-11-09T08:00:00.000Z', '2026-11-10T10:00:00.000Z']);
    expect(await repo.bookedSlots(new Date('2026-11-09T08:00:01Z'), new Date('2026-11-10T09:59:59Z'))).toEqual([]);
  });
});
