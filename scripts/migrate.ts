// Applies db/migrations/*.sql to the database in DATABASE_URL: `DATABASE_URL=... npm run db:migrate`.
// Run by hand before each deploy. Migrations are idempotent, so running it twice is safe.
import { applyMigrations } from '../src/adapters/migrate.js';
import { createNeonDb } from '../src/adapters/neon.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

await applyMigrations(createNeonDb(url));
console.log('Migrations applied.');
