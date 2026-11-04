import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Deps } from '../../deps.js';
import { QuoteRequestShape, QuoteResultSchema } from '../../schemas.js';
import { getQuote } from '../../services/quote.js';
import { runTool } from '../runTool.js';

export function registerGetQuote(server: McpServer, deps: Deps): void {
  server.registerTool(
    'get_quote',
    {
      title: 'Get a quote',
      description:
        'Price a job as a low-high range in pence INCLUDING 20% VAT (divide by 100 for pounds), with line items. Call it after check_service_area says the postcode is covered. ' +
        'Without windowStart the price uses the standard weekday-daytime tier and tierNote says so: re-call with windowStart once the customer has picked a window, because Saturday, evening, Sunday and bank-holiday windows cost more. ' +
        'On OUT_OF_AREA apologise and do not book. On NOT_EMERGENCY_ELIGIBLE offer a standard visit. On INVALID_WINDOW call find_availability again. On UPSTREAM_UNAVAILABLE apologise and offer a call back.',
      inputSchema: QuoteRequestShape,
      outputSchema: QuoteResultSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => runTool(deps.log, () => getQuote(deps, args)),
  );
}
