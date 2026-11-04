import { OpenAPIHono, z } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { Deps } from './deps.js';
import { AppError } from './domain/errors.js';
import { landingPage } from './http/landing.js';
import { requestLogger } from './http/logger.js';
import { problem } from './http/problem.js';
import { registerAvailabilityRoute } from './http/routes/availability.js';
import { registerBookingRoutes } from './http/routes/bookings.js';
import { registerHealthRoute } from './http/routes/health.js';
import { registerQuotesRoute } from './http/routes/quotes.js';
import { registerServiceAreaRoute } from './http/routes/serviceArea.js';
import { registerServicesRoute } from './http/routes/services.js';
import { mcpHandler } from './mcp/server.js';

export function createApp(deps: Deps): OpenAPIHono {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) return problem(c, new AppError('VALIDATION_ERROR', z.prettifyError(result.error)));
    },
  });

  app.use('*', requestLogger(deps.log));
  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Accept', 'Idempotency-Key', 'Mcp-Protocol-Version', 'Mcp-Session-Id'],
    }),
  );
  // The largest legitimate request (a booking) is about 2 KB.
  app.use('*', bodyLimit({ maxSize: 16 * 1024, onError: (c) => problem(c, new AppError('PAYLOAD_TOO_LARGE', 'Request bodies are limited to 16 KB.')) }));

  app.get('/', landingPage);
  registerHealthRoute(app);

  registerServicesRoute(app);
  registerServiceAreaRoute(app, deps);
  registerQuotesRoute(app, deps);
  registerAvailabilityRoute(app, deps);
  registerBookingRoutes(app, deps);

  app.post('/mcp', mcpHandler(deps));
  app.on(['GET', 'DELETE'], '/mcp', (c) => c.json({ error: 'Stateless MCP server: use POST.' }, 405, { Allow: 'POST' }));

  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Hearth & Tap Booking API',
      version: '1.0.0',
      description: 'Demo business for an Agentplace test task. The same use cases are exposed as MCP tools at /mcp.',
    },
  });
  app.get('/docs', swaggerUI({ url: '/openapi.json' }));

  app.notFound((c) => problem(c, new AppError('NOT_FOUND', 'No such endpoint. See /docs.')));
  app.onError((err, c) => {
    if (err instanceof AppError) return problem(c, err);
    // Hono's own 4xx, e.g. "Malformed JSON in request body" from the validator, is the client's fault.
    if (err instanceof HTTPException && err.status < 500) return problem(c, new AppError('VALIDATION_ERROR', err.message));
    deps.log(JSON.stringify({ level: 'error', where: 'http', message: err.message, stack: err.stack }));
    return problem(c, new AppError('INTERNAL_ERROR', 'Something went wrong on our side.'));
  });

  return app;
}
