import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';

const route = createRoute({
  method: 'get',
  path: '/health',
  tags: ['Operations'],
  summary: 'Liveness check',
  responses: { 200: { description: 'The service is up', content: { 'application/json': { schema: z.object({ status: z.literal('ok') }).openapi('Health') } } } },
});

export function registerHealthRoute(app: OpenAPIHono): void {
  app.openapi(route, (c) => c.json({ status: 'ok' as const }, 200));
}
