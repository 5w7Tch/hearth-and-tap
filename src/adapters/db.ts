/** Minimal SQL port: parameterised text in, rows out. Implemented for Neon (production) and PGlite (dev and tests). */
export interface Db {
  query<T>(text: string, params?: unknown[]): Promise<T[]>;
}

/** Postgres SQLSTATE for unique_violation. Both drivers expose it as `code` on the thrown error. */
export const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === UNIQUE_VIOLATION;
}
