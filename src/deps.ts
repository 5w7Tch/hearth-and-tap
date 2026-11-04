import { createGovUkBankHolidays, type BankHolidaySource } from './adapters/bankHolidays.js';
import { createBookingsRepo, type BookingsRepo } from './adapters/bookingsRepo.js';
import { createNeonDb } from './adapters/neon.js';
import { createPostcodesIo, type PostcodeLookup } from './adapters/postcodes.js';
import { makeReference } from './domain/reference.js';

/** Everything with a side effect (network, database, clock, randomness, logging). Built once at the edge, faked in tests. */
export interface Deps {
  postcodes: PostcodeLookup;
  bankHolidays: BankHolidaySource;
  bookings: BookingsRepo;
  /** A fresh booking reference such as HT-7K3M9Q. */
  newReference: () => string;
  now: () => Date;
  log: (line: string) => void;
}

/** Real network clients, clock and randomness around whichever bookings repo the caller chose. */
export function buildDeps(bookings: BookingsRepo): Deps {
  const now = () => new Date();
  return {
    postcodes: createPostcodesIo(),
    bankHolidays: createGovUkBankHolidays({ now }),
    bookings,
    newReference: () => makeReference((length) => crypto.getRandomValues(new Uint8Array(length))),
    now,
    log: (line) => console.log(line),
  };
}

export function buildProductionDeps(): Deps {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Point it at the Neon Postgres database (see scripts/migrate.ts).');
  }
  return buildDeps(createBookingsRepo(createNeonDb(databaseUrl)));
}
