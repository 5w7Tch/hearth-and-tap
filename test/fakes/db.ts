import { PGlite } from '@electric-sql/pglite';
import { applyMigrations } from '../../src/adapters/migrate.js';
import type { Db } from '../../src/adapters/db.js';
import { createPgliteDb } from '../../src/adapters/pglite.js';

// Booting PGlite and running the migrations takes a few hundred ms, so each test file boots it once and tests get an empty table.
// Tests within a file run one after another, so sharing the instance is safe.
let shared: Promise<Db> | undefined;

/** The real migrations on in-memory Postgres, with the bookings table emptied. */
export async function migratedDb(): Promise<Db> {
  shared ??= (async () => {
    const db = createPgliteDb(new PGlite());
    await applyMigrations(db);
    return db;
  })();
  const db = await shared;
  await db.query('truncate bookings restart identity');
  return db;
}

/** Like migratedDb, but only boots (and empties) the database on first use, so tests that never touch bookings stay fast. */
export function lazyMigratedDb(): Db {
  let ready: Promise<Db> | undefined;
  return {
    async query<T>(text: string, params?: unknown[]) {
      ready ??= migratedDb();
      return (await ready).query<T>(text, params);
    },
  };
}
