import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ServiceListSchema } from '../../schemas.js';
import { listServices } from '../../services/catalogue.js';
import { runTool } from '../runTool.js';

export function registerListServices(server: McpServer, log: (line: string) => void): void {
  server.registerTool(
    'list_services',
    {
      title: 'List services',
      description:
        'List every job Hearth & Tap does, with its jobType id, a customer-ready pricingBasis (VAT-inclusive; quote this to customers), whether it needs a Gas Safe engineer and whether it can be booked as an emergency. ' +
        'Call this once at the start to map the customer\'s problem to a jobType. It also returns the gas-emergency safety notice: show it if the customer mentions a gas smell or carbon monoxide, and do not book.',
      outputSchema: ServiceListSchema,
      annotations: { readOnlyHint: true },
    },
    () => runTool(log, async () => listServices()),
  );
}
