import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/domain/errors.js';
import { bookVisit, type BookVisitRequest } from '../../src/services/booking.js';
import { findAvailability } from '../../src/services/availability.js';
import { bookingRequest, makeDeps } from '../helpers.js';

const book = (deps: ReturnType<typeof makeDeps>, key: string, overrides: Record<string, unknown> = {}) =>
  bookVisit(deps, bookingRequest(overrides) as BookVisitRequest, key);
const starts = async (deps: ReturnType<typeof makeDeps>, jobType: 'dripping_tap' | 'boiler_service') =>
  (await findAvailability(deps, { jobType, urgency: 'standard', from: '2026-11-09', days: 1 })).windows.map((w) => w.start.slice(11, 16));

describe('findAvailability', () => {
  it('defaults from to today in London and returns the resolved range', async () => {
    const result = await findAvailability(makeDeps(), { jobType: 'dripping_tap', urgency: 'standard', days: 7 });
    expect(result).toMatchObject({ from: '2026-11-04', days: 7 });
    // Wed 4 Nov at 09:00: 10:00 onwards is bookable (>= 60 min notice), so 4 windows remain that day.
    expect(result.windows[0]).toMatchObject({ label: 'Wed 4 Nov, 10am–12pm', tier: 'standard' });
  });

  it('uses the London date near midnight, not the UTC date', async () => {
    const deps = makeDeps({ now: () => new Date('2026-10-24T23:30:00Z') }); // 00:30 BST on Sun 25 Oct
    const result = await findAvailability(deps, { jobType: 'dripping_tap', urgency: 'standard', days: 1 });
    expect(result.from).toBe('2026-10-25');
  });

  it('closes a gas window when both Dan and Priya are booked', async () => {
    const deps = makeDeps();
    expect(await starts(deps, 'boiler_service')).toContain('08:00');
    await book(deps, 'key-aaaaaaaa', { jobType: 'boiler_service' });
    expect(await starts(deps, 'boiler_service')).toContain('08:00');
    await book(deps, 'key-bbbbbbbb', { jobType: 'boiler_service' });
    expect(await starts(deps, 'boiler_service')).not.toContain('08:00');
  });

  it('keeps a non-gas window open when only Tom is booked, and when Dan and Tom are', async () => {
    const deps = makeDeps();
    await book(deps, 'key-aaaaaaaa');
    expect(await starts(deps, 'dripping_tap')).toContain('08:00');
    await book(deps, 'key-bbbbbbbb');
    expect(await starts(deps, 'dripping_tap')).toContain('08:00');
    await book(deps, 'key-cccccccc');
    expect(await starts(deps, 'dripping_tap')).not.toContain('08:00');
  });

  it('a non-gas booking taking Tom does not close the gas window', async () => {
    const deps = makeDeps();
    await book(deps, 'key-aaaaaaaa');
    expect(await starts(deps, 'boiler_service')).toContain('08:00');
  });

  it('reopens a window when its booking is cancelled', async () => {
    const deps = makeDeps();
    const { booking } = await book(deps, 'key-aaaaaaaa', { jobType: 'boiler_service' });
    await book(deps, 'key-bbbbbbbb', { jobType: 'boiler_service' });
    expect(await starts(deps, 'boiler_service')).not.toContain('08:00');
    await deps.bookings.cancel(booking.reference, deps.now());
    expect(await starts(deps, 'boiler_service')).toContain('08:00');
  });

  it('rejects a from date beyond the 14-day horizon and stops at the last bookable day', async () => {
    const ask = (from: string) => findAvailability(makeDeps(), { jobType: 'dripping_tap', urgency: 'standard', from, days: 7 });
    await expect(ask('2026-11-18')).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('2026-11-17') });
    const last = await ask('2026-11-17');
    expect(new Set(last.windows.map((w) => w.start.slice(0, 10)))).toEqual(new Set(['2026-11-17']));
  });

  it('returns an empty list without querying bookings when there are no windows', async () => {
    const deps = makeDeps();
    const result = await findAvailability(deps, { jobType: 'dripping_tap', urgency: 'standard', from: '2026-11-08', days: 1 });
    expect(result.windows).toEqual([]);
    expect(await deps.db.query('select 1 from bookings')).toHaveLength(0);
  });

  it('propagates UPSTREAM_UNAVAILABLE when the bank-holiday calendar is down', async () => {
    const deps = makeDeps({
      bankHolidays: {
        dates: async () => {
          throw new AppError('UPSTREAM_UNAVAILABLE', 'gov.uk is down');
        },
      },
    });
    await expect(findAvailability(deps, { jobType: 'dripping_tap', urgency: 'standard', days: 7 })).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });
});
