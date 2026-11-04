import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import type { Deps } from '../../deps.js';
import { QuoteRequestSchema, QuoteResultSchema } from '../../schemas.js';
import { getQuote } from '../../services/quote.js';
import { problemResponses } from '../problem.js';

const route = createRoute({
  method: 'post',
  path: '/api/v1/quotes',
  tags: ['Quotes'],
  summary: 'Price range for a job at a postcode',
  description:
    'Prices a job as a low-high range in pence including VAT. Without windowStart it uses the standard tier and says so; with windowStart it prices that exact window.',
  request: { body: { content: { 'application/json': { schema: QuoteRequestSchema } }, required: true } },
  responses: {
    200: { description: 'The quote', content: { 'application/json': { schema: QuoteResultSchema } } },
    ...problemResponses({
      400: 'Invalid request body',
      422: 'Invalid postcode, postcode outside our area, emergency on an ineligible job, or windowStart is not a real window',
      503: 'postcodes.io or the bank-holiday calendar is unavailable',
    }),
  },
});

export function registerQuotesRoute(app: OpenAPIHono, deps: Deps): void {
  app.openapi(route, async (c) => c.json(await getQuote(deps, c.req.valid('json')), 200));
}
