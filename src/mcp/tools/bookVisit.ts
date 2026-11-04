import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Deps } from '../../deps.js';
import { BookingBodyShape, BookingSchema, IdempotencyKeyInput } from '../../schemas.js';
import { bookVisit } from '../../services/booking.js';
import { runTool } from '../runTool.js';

export function registerBookVisit(server: McpServer, deps: Deps): void {
  server.registerTool(
    'book_visit',
    {
      title: 'Book a visit',
      description:
        'Book and confirm an engineer visit. Only call this AFTER the customer has seen the quote and the chosen window and explicitly said yes, and you have their name, UK phone number and full address. ' +
        'Never book a gas smell or suspected carbon monoxide: send them to 0800 111 999. ' +
        'Generate a random idempotencyKey (for example a UUID) once per booking attempt. Re-send the SAME key if the call fails or times out, so you never double-book. ' +
        'On success give the customer the reference. On SLOT_UNAVAILABLE the window was just taken: call find_availability and offer another. ' +
        'On IDEMPOTENCY_KEY_REUSED generate a new random key and call again. ' +
        'On INVALID_WINDOW, OUT_OF_AREA, VALIDATION_ERROR or NOT_EMERGENCY_ELIGIBLE fix the input or explain, and re-ask the customer. On UPSTREAM_UNAVAILABLE apologise and offer a call back.',
      inputSchema: { ...BookingBodyShape, idempotencyKey: IdempotencyKeyInput },
      outputSchema: BookingSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    ({ idempotencyKey, ...request }) => runTool(deps.log, async () => (await bookVisit(deps, request, idempotencyKey)).booking),
  );
}
