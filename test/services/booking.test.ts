import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/domain/errors.js';
import { bookVisit, cancelBooking, getBooking, type BookVisitRequest } from '../../src/services/booking.js';
import { bookingRequest, makeDeps } from '../helpers.js';

const request = (overrides: Record<string, unknown> = {}) => bookingRequest(overrides) as BookVisitRequest;
const gas = (overrides: Record<string, unknown> = {}) => request({ jobType: 'boiler_service', ...overrides });

describe('bookVisit', () => {
  it('books the first free engineer in preference order (Tom, then Dan, then Priya)', async () => {
    const deps = makeDeps();
    const engineers: string[] = [];
    for (const key of ['key-aaaaaaaa', 'key-bbbbbbbb', 'key-cccccccc']) {
      engineers.push((await bookVisit(deps, request(), key)).booking.engineer.firstName);
    }
    expect(engineers).toEqual(['Tom', 'Dan', 'Priya']);
    await expect(bookVisit(deps, request(), 'key-dddddddd')).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
  });

  it('gas jobs skip Tom: Dan then Priya, and the third is SLOT_UNAVAILABLE', async () => {
    const deps = makeDeps();
    expect((await bookVisit(deps, gas(), 'key-aaaaaaaa')).booking.engineer.firstName).toBe('Dan');
    expect((await bookVisit(deps, gas(), 'key-bbbbbbbb')).booking.engineer.firstName).toBe('Priya');
    await expect(bookVisit(deps, gas(), 'key-cccccccc')).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
  });

  it('stores the quote snapshot and normalised fields', async () => {
    const deps = makeDeps();
    const { booking, created } = await bookVisit(deps, request(), 'key-aaaaaaaa');
    expect(created).toBe(true);
    expect(booking).toMatchObject({ reference: 'HT-000001', status: 'confirmed', postcode: 'SW4 7AA', customerName: 'Sam Carter' });
    expect(booking.quote).toMatchObject({ tier: 'standard', totalLowPence: 9600, totalHighPence: 13800 });
    const [row] = await deps.db.query<{ quote: unknown; customer_phone: string; customer_email: string }>('select quote, customer_phone, customer_email from bookings');
    expect(row?.quote).toEqual(booking.quote);
    expect(row).toMatchObject({ customer_phone: '+447700900123', customer_email: 'sam@example.com' });
  });

  // PGlite runs on one connection, so Promise.all interleaves at await points rather than racing inside Postgres.
  // Safety under true concurrency comes from the partial unique index, which bookingsRepo.test.ts exercises directly.
  // The deployed service was also hit with parallel requests against Neon (see NOTE.md).
  it('three concurrent gas bookings for one window: two succeed, one gets SLOT_UNAVAILABLE', async () => {
    const deps = makeDeps();
    const results = await Promise.allSettled(['key-aaaaaaaa', 'key-bbbbbbbb', 'key-cccccccc'].map((k) => bookVisit(deps, gas(), k)));
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(2);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBeInstanceOf(AppError);
    expect(failed[0]?.reason).toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    const rows = await deps.db.query<{ engineer_id: string }>(`select engineer_id from bookings where status = 'confirmed' order by 1`);
    expect(rows.map((r) => r.engineer_id)).toEqual(['eng_dan', 'eng_priya']);
  });

  it('allows a cancelled slot to be booked again', async () => {
    const deps = makeDeps();
    const first = await bookVisit(deps, gas(), 'key-aaaaaaaa');
    await bookVisit(deps, gas(), 'key-bbbbbbbb');
    await cancelBooking(deps, first.booking.reference, 'SW4 7AA');
    const again = await bookVisit(deps, gas(), 'key-cccccccc');
    expect(again.booking.engineer.firstName).toBe('Dan');
  });

  describe('idempotency', () => {
    it('the same key twice in sequence returns the original booking, with one row', async () => {
      const deps = makeDeps();
      const first = await bookVisit(deps, request(), 'key-aaaaaaaa');
      const second = await bookVisit(deps, request(), 'key-aaaaaaaa');
      expect(second.created).toBe(false);
      expect(second.booking).toEqual(first.booking);
      expect(await deps.db.query('select 1 from bookings')).toHaveLength(1);
    });

    it('rejects a reused key from a different customer and reveals nothing about the original booking', async () => {
      const deps = makeDeps();
      await bookVisit(deps, request(), 'key-aaaaaaaa');
      const otherCustomer = request({ postcode: 'E1 6AN', addressLine1: '1 Other Street', customer: { name: 'Alex Other', phone: '07700 900456' } });
      const err = await bookVisit(deps, otherCustomer, 'key-aaaaaaaa').catch((e: unknown) => e);
      expect(err).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', status: 422 });
      expect((err as Error).message).not.toMatch(/Sam|Acre|SW4|HT-/);
      expect(await deps.db.query('select 1 from bookings')).toHaveLength(1);
    });

    it('treats the same customer asking for a different window as a different request', async () => {
      const deps = makeDeps();
      await bookVisit(deps, request(), 'key-aaaaaaaa');
      await expect(bookVisit(deps, request({ windowStart: '2026-11-09T10:00:00+00:00' }), 'key-aaaaaaaa')).rejects.toMatchObject({
        code: 'IDEMPOTENCY_KEY_REUSED',
      });
    });

    it('still replays when only formatting differs (postcode casing, phone spacing, UTC vs London offset)', async () => {
      const deps = makeDeps();
      const first = await bookVisit(deps, request(), 'key-aaaaaaaa');
      const sameButReformatted = request({ postcode: 'SW47AA', windowStart: '2026-11-09T08:00:00Z', customer: { name: 'Sam Carter', phone: '+44 7700 900123' } });
      expect(await bookVisit(deps, sameButReformatted, 'key-aaaaaaaa')).toEqual({ booking: first.booking, created: false });
    });

    it('the same key twice concurrently makes one row and one reference', async () => {
      const deps = makeDeps();
      const [a, b] = await Promise.all([bookVisit(deps, request(), 'key-aaaaaaaa'), bookVisit(deps, request(), 'key-aaaaaaaa')]);
      expect(a.booking.reference).toBe(b.booking.reference);
      expect([a.created, b.created].sort()).toEqual([false, true]);
      expect(await deps.db.query('select 1 from bookings')).toHaveLength(1);
    });
  });

  describe('reference clashes', () => {
    it('retries once with a fresh reference', async () => {
      const refs = ['HT-000001', 'HT-000001', 'HT-000002'];
      const deps = makeDeps({ newReference: () => refs.shift()! });
      await bookVisit(deps, request(), 'key-aaaaaaaa');
      const second = await bookVisit(deps, request(), 'key-bbbbbbbb');
      expect(second.booking.reference).toBe('HT-000002');
    });

    it('gives up loudly if the retry clashes too', async () => {
      const deps = makeDeps({ newReference: () => 'HT-000001' });
      await bookVisit(deps, request(), 'key-aaaaaaaa');
      await expect(bookVisit(deps, request(), 'key-bbbbbbbb')).rejects.toMatchObject({ code: '23505' });
    });
  });

  describe('server-side validation', () => {
    it('rejects a window less than 60 minutes away', async () => {
      const deps = makeDeps({ now: () => new Date('2026-11-09T07:01:00Z') });
      await expect(bookVisit(deps, request(), 'key-aaaaaaaa')).rejects.toMatchObject({ code: 'INVALID_WINDOW' });
    });

    it('accepts a window exactly 60 minutes away', async () => {
      const deps = makeDeps({ now: () => new Date('2026-11-09T07:00:00Z') });
      await expect(bookVisit(deps, request(), 'key-aaaaaaaa')).resolves.toMatchObject({ created: true });
    });

    it('rejects an instant that is not a window start', async () => {
      await expect(bookVisit(makeDeps(), request({ windowStart: '2026-11-09T08:30:00+00:00' }), 'key-aaaaaaaa')).rejects.toMatchObject({ code: 'INVALID_WINDOW' });
    });

    it('rejects an out-of-area postcode', async () => {
      await expect(bookVisit(makeDeps(), request({ postcode: 'RH1 1AA' }), 'key-aaaaaaaa')).rejects.toMatchObject({ code: 'OUT_OF_AREA' });
    });

    it('rejects a malformed postcode', async () => {
      await expect(bookVisit(makeDeps(), request({ postcode: 'nope' }), 'key-aaaaaaaa')).rejects.toMatchObject({ code: 'INVALID_POSTCODE' });
    });

    it('rejects a bad phone number', async () => {
      const deps = makeDeps();
      await expect(bookVisit(deps, request({ customer: { name: 'Sam', phone: '12345' } }), 'key-aaaaaaaa')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(await deps.db.query('select 1 from bookings')).toHaveLength(0);
    });

    it('rejects an emergency on a job that is not eligible', async () => {
      await expect(bookVisit(makeDeps(), request({ urgency: 'emergency' }), 'key-aaaaaaaa')).rejects.toMatchObject({ code: 'NOT_EMERGENCY_ELIGIBLE' });
    });

    it('prices a Saturday emergency window from the stored window, not the client', async () => {
      const deps = makeDeps();
      const { booking } = await bookVisit(deps, request({ jobType: 'burst_pipe', urgency: 'emergency', windowStart: '2026-11-08T10:00:00+00:00' }), 'key-aaaaaaaa');
      expect(booking.window.tier).toBe('out_of_hours');
      expect(booking.quote.tier).toBe('out_of_hours');
    });
  });
});

describe('getBooking', () => {
  it('accepts any casing and spacing of the postcode and reference', async () => {
    const deps = makeDeps();
    const { booking } = await bookVisit(deps, request(), 'key-aaaaaaaa');
    await expect(getBooking(deps, booking.reference.toLowerCase(), 'sw47aa')).resolves.toEqual(booking);
    await expect(getBooking(deps, ` ${booking.reference} `, ' Sw4  7aA ')).resolves.toEqual(booking);
  });

  it('a wrong postcode and an unknown reference give the identical error', async () => {
    const deps = makeDeps();
    const { booking } = await bookVisit(deps, request(), 'key-aaaaaaaa');
    const wrongPostcode = await getBooking(deps, booking.reference, 'E1 6AN').catch((e: unknown) => e);
    const unknown = await getBooking(deps, 'HT-ZZZZZZ', 'SW4 7AA').catch((e: unknown) => e);
    expect(wrongPostcode).toBeInstanceOf(AppError);
    expect(wrongPostcode).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect({ ...(wrongPostcode as AppError) }).toEqual({ ...(unknown as AppError) });
    expect((wrongPostcode as AppError).message).toBe((unknown as AppError).message);
  });
});

describe('cancelBooking', () => {
  // Booking is for Mon 9 Nov 08:00Z, so the deadline is 06:00Z.
  async function bookedAt(nowIso: string) {
    const deps = makeDeps();
    const { booking } = await bookVisit(deps, request(), 'key-aaaaaaaa');
    const later = { ...deps, now: () => new Date(nowIso) };
    return { deps: later, booking };
  }

  it('cancels at exactly window start minus 2h', async () => {
    const { deps, booking } = await bookedAt('2026-11-09T06:00:00Z');
    expect(await cancelBooking(deps, booking.reference, 'SW4 7AA')).toMatchObject({ status: 'cancelled' });
  });

  it('refuses at window start minus 1h59m with TOO_LATE_TO_CANCEL', async () => {
    const { deps, booking } = await bookedAt('2026-11-09T06:01:00Z');
    await expect(cancelBooking(deps, booking.reference, 'SW4 7AA')).rejects.toMatchObject({ code: 'TOO_LATE_TO_CANCEL', status: 409 });
    expect((await getBooking(deps, booking.reference, 'SW4 7AA')).status).toBe('confirmed');
  });

  it('returns NOT_FOUND for the wrong postcode and leaves the booking alone', async () => {
    const { deps, booking } = await bookedAt('2026-11-05T09:00:00Z');
    await expect(cancelBooking(deps, booking.reference, 'E1 6AN')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await getBooking(deps, booking.reference, 'SW4 7AA')).status).toBe('confirmed');
  });

  it('cancelling twice returns 200-style success with the cancelled booking, even after the deadline', async () => {
    const { deps, booking } = await bookedAt('2026-11-05T09:00:00Z');
    const first = await cancelBooking(deps, booking.reference, 'SW4 7AA');
    const late = { ...deps, now: () => new Date('2026-11-09T07:00:00Z') };
    await expect(cancelBooking(late, booking.reference, 'SW4 7AA')).resolves.toEqual(first);
  });

  it('survives losing a cancel race: returns the booking cancelled by the other request', async () => {
    const { deps, booking } = await bookedAt('2026-11-05T09:00:00Z');
    const results = await Promise.all([cancelBooking(deps, booking.reference, 'SW4 7AA'), cancelBooking(deps, booking.reference, 'SW4 7AA')]);
    expect(results.map((r) => r.status)).toEqual(['cancelled', 'cancelled']);
  });
});
