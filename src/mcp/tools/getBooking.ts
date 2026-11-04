import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Deps } from '../../deps.js';
import { BookingLookupShape, BookingSchema } from '../../schemas.js';
import { getBooking } from '../../services/booking.js';
import { runTool } from '../runTool.js';

export function registerGetBooking(server: McpServer, deps: Deps): void {
  server.registerTool(
    'get_booking',
    {
      title: 'Get a booking',
      description:
        'Look up a booking\'s status, window and price by its reference (like HT-7K3M9Q) and the postcode it was booked for. Ask the customer for both. ' +
        'NOT_FOUND means the reference and postcode do not match any booking (we do not say which is wrong): ask the customer to double-check both.',
      inputSchema: BookingLookupShape,
      outputSchema: BookingSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ reference, postcode }) => runTool(deps.log, () => getBooking(deps, reference, postcode)),
  );
}
