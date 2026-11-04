import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from '../../src/adapters/db.js';
import { applyMigrations } from '../../src/adapters/migrate.js';
import { createPgliteDb } from '../../src/adapters/pglite.js';

describe('applyMigrations', () => {
  it('creates the bookings table and the partial unique index, and is safe to run twice', async () => {
    const db = createPgliteDb(new PGlite());
    await applyMigrations(db);
    await applyMigrations(db);
    const idx = await db.query<{ indexdef: string }>(`select indexdef from pg_indexes where indexname = 'bookings_engineer_window_confirmed'`);
    expect(idx[0]?.indexdef).toMatch(/UNIQUE.*\(engineer_id, window_start\).*WHERE.*confirmed/i);
  });

  it('runs files in name order, one statement at a time', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'migrations-'));
    await writeFile(join(dir, '002_second.sql'), 'insert into t values (2);\n');
    await writeFile(join(dir, '001_first.sql'), 'create table t (n int);\ninsert into t values (1);\n');
    await writeFile(join(dir, 'notes.txt'), 'not sql');
    const db = createPgliteDb(new PGlite());
    await applyMigrations(db, dir);
    expect(await db.query('select n from t order by n')).toEqual([{ n: 1 }, { n: 2 }]);
  });
});

describe('isUniqueViolation', () => {
  it('recognises the PGlite error for a duplicate key, with its constraint name', async () => {
    const db = createPgliteDb(new PGlite());
    await db.query('create table u (k text constraint u_k_key unique)');
    await db.query(`insert into u values ('a')`);
    const err = await db.query(`insert into u values ('a')`).catch((e: unknown) => e);
    expect(isUniqueViolation(err)).toBe(true);
    expect(err).toMatchObject({ code: '23505', constraint: 'u_k_key' });
  });

  it('is false for other errors', () => {
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
  });
});
