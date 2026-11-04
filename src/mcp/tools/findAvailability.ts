import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Deps } from '../../deps.js';
import { AvailabilityQueryShape, AvailabilityResultSchema } from '../../schemas.js';
import { findAvailability } from '../../services/availability.js';
import { runTool } from '../runTool.js';

export function registerFindAvailability(server: McpServer, deps: Deps): void {
  server.registerTool(
    'find_availability',
    {
      title: 'Find available windows',
      description:
        'List open 2-hour arrival windows (London time) for a job over the next 1-14 days, each with its price tier. Only windows with a free eligible engineer are returned, ' +
        'so never offer a time that is not in the result. Call it after get_quote, show the label of each window, and pass the chosen window\'s start unchanged to get_quote and book_visit. ' +
        'An empty list means nothing is free: offer a later from date. On UPSTREAM_UNAVAILABLE apologise and offer a call back.',
      inputSchema: AvailabilityQueryShape,
      outputSchema: AvailabilityResultSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => runTool(deps.log, () => findAvailability(deps, args)),
  );
}
