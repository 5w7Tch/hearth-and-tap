import { createBookingsRepo } from '../src/adapters/bookingsRepo.js';
import type { Db } from '../src/adapters/db.js';
import type { Deps } from '../src/deps.js';
import { fakeBankHolidays } from './fakes/bankHolidays.js';
import { lazyMigratedDb } from './fakes/db.js';
import { fakePostcodes } from './fakes/postcodes.js';

export interface TestDeps extends Deps {
  logs: string[];
  /** The PGlite database behind `bookings`, for asserting on rows directly. */
  db: Db;
}

/** Deps wired with fakes and a fixed clock: Wed 4 Nov 2026, 09:00 London (GMT). */
export function makeDeps(overrides: Partial<Deps> = {}): TestDeps {
  const logs: string[] = [];
  const db = lazyMigratedDb();
  let counter = 0;
  return {
    postcodes: fakePostcodes(),
    bankHolidays: fakeBankHolidays(),
    bookings: createBookingsRepo(db),
    // Digits are valid Crockford characters, so these match the real reference format.
    newReference: () => `HT-${String(++counter).padStart(6, '0')}`,
    now: () => new Date('2026-11-04T09:00:00Z'),
    log: (line) => logs.push(line),
    ...overrides,
    logs,
    db,
  };
}

/** A valid booking request: a dripping tap at SW4 7AA in the Mon 9 Nov 08:00 window. */
export function bookingRequest(overrides: Record<string, unknown> = {}) {
  return {
    jobType: 'dripping_tap',
    urgency: 'standard',
    postcode: 'sw4 7aa',
    addressLine1: '14 Acre Lane',
    windowStart: '2026-11-09T08:00:00+00:00',
    customer: { name: 'Sam Carter', phone: '07700 900123', email: 'sam@example.com' },
    problemDescription: 'The kitchen tap drips all night.',
    ...overrides,
  };
}
