import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import { ServiceListSchema } from '../../schemas.js';
import { listServices } from '../../services/catalogue.js';

const route = createRoute({
  method: 'get',
  path: '/api/v1/services',
  tags: ['Catalogue'],
  summary: 'List the jobs we do and how they are priced',
  description: 'The 9 job types with pricing basis, Gas Safe requirement and emergency eligibility, plus the gas-emergency safety notice.',
  responses: { 200: { description: 'The catalogue', content: { 'application/json': { schema: ServiceListSchema } } } },
});

export function registerServicesRoute(app: OpenAPIHono): void {
  app.openapi(route, (c) => c.json(listServices(), 200));
}
