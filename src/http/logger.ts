import type { MiddlewareHandler } from 'hono';

/** One JSON line per request. Logs the path only: query strings can carry postcodes. */
export function requestLogger(log: (line: string) => void): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now();
    await next();
    log(JSON.stringify({ method: c.req.method, path: c.req.path, status: c.res.status, ms: Math.round(performance.now() - started) }));
  };
}
