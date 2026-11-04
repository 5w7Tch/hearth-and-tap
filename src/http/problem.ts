import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppError } from '../domain/errors.js';
import { ProblemSchema } from '../schemas.js';

/** RFC 9457 problem details response. */
export function problem(c: Context, err: AppError): Response {
  const body = { type: 'about:blank', title: err.code, status: err.status, code: err.code, detail: err.message };
  return c.body(JSON.stringify(body), err.status as ContentfulStatusCode, { 'Content-Type': 'application/problem+json' });
}

/** OpenAPI response entries for the error statuses a route can return (500 is added to every route). */
export function problemResponses(descriptions: Record<number, string>) {
  return Object.fromEntries(
    Object.entries({ ...descriptions, 500: 'Unexpected server error (INTERNAL_ERROR)' }).map(([status, description]) => [
      status,
      { description, content: { 'application/problem+json': { schema: ProblemSchema } } },
    ]),
  );
}
