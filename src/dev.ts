// Local development server: `npm run dev`.
import { PGlite } from '@electric-sql/pglite';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createBookingsRepo } from './adapters/bookingsRepo.js';
import { applyMigrations } from './adapters/migrate.js';
import { createPgliteDb } from './adapters/pglite.js';
import { buildDeps, buildProductionDeps, type Deps } from './deps.js';

async function buildDevDeps(): Promise<Deps> {
  if (process.env.DATABASE_URL) return buildProductionDeps();
  console.log('DATABASE_URL is not set: using in-memory PGlite (bookings are lost on restart).');
  const db = createPgliteDb(new PGlite());
  await applyMigrations(db);
  return buildDeps(createBookingsRepo(db));
}

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: createApp(await buildDevDeps()).fetch, port });
console.log(`Hearth & Tap API on http://localhost:${port}`);
