import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import type { Deps } from '../../deps.js';
import { AvailabilityQueryShape, AvailabilityResultSchema } from '../../schemas.js';
import { findAvailability } from '../../services/availability.js';
import { problemResponses } from '../problem.js';

const route = createRoute({
  method: 'get',
  path: '/api/v1/availability',
  tags: ['Availability'],
  summary: 'Open 2-hour arrival windows',
  description: 'Windows in the next 1-14 days that have at least one free eligible engineer, with the price tier of each.',
  request: { query: z.object(AvailabilityQueryShape) },
  responses: {
    200: { description: 'Open windows (may be empty)', content: { 'application/json': { schema: AvailabilityResultSchema } } },
    ...problemResponses({
      400: 'Invalid job type, urgency, from date or days (1-14)',
      422: 'Emergency requested for a job that is not emergency eligible',
      503: 'The bank-holiday calendar is unavailable',
    }),
  },
});

export function registerAvailabilityRoute(app: OpenAPIHono, deps: Deps): void {
  app.openapi(route, async (c) => c.json(await findAvailability(deps, c.req.valid('query')), 200));
}
