import type { Db } from './db.js';

/** The slice of PGlite we use, so production code never imports the dev-only package. */
interface PgliteLike {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export function createPgliteDb(pglite: PgliteLike): Db {
  return {
    async query<T>(text: string, params?: unknown[]) {
      return (await pglite.query<T>(text, params)).rows;
    },
  };
}
