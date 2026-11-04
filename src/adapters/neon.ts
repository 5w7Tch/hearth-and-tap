import { neon } from '@neondatabase/serverless';
import type { Db } from './db.js';

/** Neon's HTTP driver: one round trip per statement, `sql.query` already returns the rows. */
export function createNeonDb(connectionString: string): Db {
  const sql = neon(connectionString);
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await sql.query(text, params)) as unknown as T[];
    },
  };
}
