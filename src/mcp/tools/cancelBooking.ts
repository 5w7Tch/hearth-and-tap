import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Deps } from '../../deps.js';
import { BookingLookupShape, BookingSchema } from '../../schemas.js';
import { cancelBooking } from '../../services/booking.js';
import { runTool } from '../runTool.js';

export function registerCancelBooking(server: McpServer, deps: Deps): void {
  server.registerTool(
    'cancel_booking',
    {
      title: 'Cancel a booking',
      description:
        'Cancel a booking by its reference and postcode. Only call it after the customer has explicitly confirmed they want to cancel. ' +
        'Cancelling is allowed until 2 hours before the arrival window; the booking\'s cancellableUntil says when. Cancelling twice is safe and returns the cancelled booking. ' +
        'On TOO_LATE_TO_CANCEL tell the customer it is too late to cancel online and offer a call back. On NOT_FOUND ask them to double-check the reference and postcode.',
      inputSchema: BookingLookupShape,
      outputSchema: BookingSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    ({ reference, postcode }) => runTool(deps.log, () => cancelBooking(deps, reference, postcode)),
  );
}
