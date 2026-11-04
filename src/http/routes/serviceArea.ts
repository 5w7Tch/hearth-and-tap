import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import type { Deps } from '../../deps.js';
import { PostcodeInput, ServiceAreaSchema } from '../../schemas.js';
import { checkServiceArea } from '../../services/area.js';
import { problemResponses } from '../problem.js';

const route = createRoute({
  method: 'get',
  path: '/api/v1/service-area',
  tags: ['Service area'],
  summary: 'Check whether we cover a postcode',
  description: 'Looks the postcode up on postcodes.io and returns borough, distance from our Clapham base and the travel fee.',
  request: { query: z.object({ postcode: PostcodeInput }) },
  responses: {
    200: { description: 'Coverage result (covered may be false)', content: { 'application/json': { schema: ServiceAreaSchema } } },
    ...problemResponses({ 400: 'Missing postcode', 422: 'Not a valid UK postcode', 503: 'postcodes.io unavailable' }),
  },
});

export function registerServiceAreaRoute(app: OpenAPIHono, deps: Deps): void {
  app.openapi(route, async (c) => c.json(await checkServiceArea(deps, c.req.valid('query').postcode), 200));
}
