import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';

const DEFAULT_DIR = fileURLToPath(new URL('../../db/migrations/', import.meta.url));

/**
 * Applies every db/migrations/*.sql file in name order, one statement at a time
 * (the Neon HTTP driver runs one statement per request). Migrations must be idempotent and must not contain ';' inside a statement.
 */
export async function applyMigrations(db: Db, dir: string = DEFAULT_DIR): Promise<void> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await readFile(`${dir}/${file}`, 'utf8');
    for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
      await db.query(statement);
    }
  }
}
