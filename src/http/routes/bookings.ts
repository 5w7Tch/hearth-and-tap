import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import type { Deps } from '../../deps.js';
import { BookingBodySchema, BookingLookupShape, BookingSchema, IdempotencyKeyInput, PostcodeInput, ReferenceInput } from '../../schemas.js';
import { bookVisit, cancelBooking, getBooking } from '../../services/booking.js';
import { problemResponses } from '../problem.js';

const bookingContent = { 'application/json': { schema: BookingSchema } };

const bookRoute = createRoute({
  method: 'post',
  path: '/api/v1/bookings',
  tags: ['Bookings'],
  summary: 'Book a visit',
  description:
    'Re-validates the area, window and notice, prices the visit, allocates a free eligible engineer and returns the booking with its reference. ' +
    'Send a unique Idempotency-Key: repeating a key returns the original booking (200) instead of creating another.',
  request: {
    headers: z.object({ 'idempotency-key': IdempotencyKeyInput }),
    body: { content: { 'application/json': { schema: BookingBodySchema } }, required: true },
  },
  responses: {
    201: { description: 'Booking confirmed', content: bookingContent },
    200: { description: 'This Idempotency-Key was already used: the original booking', content: bookingContent },
    ...problemResponses({
      400: 'Invalid body, phone number or Idempotency-Key',
      409: 'SLOT_UNAVAILABLE: every eligible engineer is booked for that window',
      422: 'Invalid or uncovered postcode, invalid window, or emergency on an ineligible job',
      503: 'postcodes.io or the bank-holiday calendar is unavailable',
    }),
  },
});

const getRoute = createRoute({
  method: 'get',
  path: '/api/v1/bookings/{reference}',
  tags: ['Bookings'],
  summary: 'Booking status',
  description: 'Needs the reference and the postcode it was booked for. A wrong postcode returns the same 404 as an unknown reference.',
  request: { params: z.object({ reference: ReferenceInput }), query: z.object({ postcode: PostcodeInput }) },
  responses: {
    200: { description: 'The booking', content: bookingContent },
    ...problemResponses({ 400: 'Missing postcode', 404: 'No booking with that reference and postcode', 422: 'Not a valid UK postcode' }),
  },
});

const cancelRoute = createRoute({
  method: 'post',
  path: '/api/v1/bookings/{reference}/cancel',
  tags: ['Bookings'],
  summary: 'Cancel a booking',
  description:
    'Allowed until 2 hours before the arrival window starts (inclusive). Cancelling an already-cancelled booking returns it unchanged with 200.',
  request: {
    params: z.object({ reference: ReferenceInput }),
    body: { content: { 'application/json': { schema: z.object({ postcode: BookingLookupShape.postcode }).openapi('CancelRequest') } }, required: true },
  },
  responses: {
    200: { description: 'The cancelled booking', content: bookingContent },
    ...problemResponses({
      400: 'Missing postcode',
      404: 'No booking with that reference and postcode',
      409: 'TOO_LATE_TO_CANCEL: less than 2 hours before the window',
      422: 'Not a valid UK postcode',
    }),
  },
});

export function registerBookingRoutes(app: OpenAPIHono, deps: Deps): void {
  app.openapi(bookRoute, async (c) => {
    const { booking, created } = await bookVisit(deps, c.req.valid('json'), c.req.valid('header')['idempotency-key']);
    return created ? c.json(booking, 201) : c.json(booking, 200);
  });
  app.openapi(getRoute, async (c) => c.json(await getBooking(deps, c.req.valid('param').reference, c.req.valid('query').postcode), 200));
  app.openapi(cancelRoute, async (c) => c.json(await cancelBooking(deps, c.req.valid('param').reference, c.req.valid('json').postcode), 200));
}
