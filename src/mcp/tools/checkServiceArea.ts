import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Deps } from '../../deps.js';
import { PostcodeInput, ServiceAreaSchema } from '../../schemas.js';
import { checkServiceArea } from '../../services/area.js';
import { runTool } from '../runTool.js';

export function registerCheckServiceArea(server: McpServer, deps: Deps): void {
  server.registerTool(
    'check_service_area',
    {
      title: 'Check service area',
      description:
        'Check whether Hearth & Tap covers a UK postcode. Returns the borough, distance from our Clapham base and the travel fee in pence (ex VAT). ' +
        'Call this first, before quoting or showing availability. If covered is false, apologise and do not book.',
      inputSchema: { postcode: PostcodeInput },
      outputSchema: ServiceAreaSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ postcode }) => runTool(deps.log, () => checkServiceArea(deps, postcode)),
  );
}
