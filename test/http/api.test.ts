import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { AppError } from '../../src/domain/errors.js';
import { REFERENCE_PATTERN } from '../../src/domain/reference.js';
import { bookingRequest, makeDeps } from '../helpers.js';

const json = { 'Content-Type': 'application/json' };

function setup(overrides: Parameters<typeof makeDeps>[0] = {}) {
  const deps = makeDeps(overrides);
  const app = createApp(deps);
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, { method: 'POST', headers: { ...json, ...headers }, body: JSON.stringify(body) });
  const book = (key: string | null, body: unknown = bookingRequest()) => post('/api/v1/bookings', body, key === null ? {} : { 'Idempotency-Key': key });
  return { deps, app, post, book };
}

describe('GET /api/v1/services', () => {
  it('lists the 9 jobs and the gas safety notice', async () => {
    const res = await setup().app.request('/api/v1/services');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { services: Array<{ jobType: string; gasSafeRequired: boolean; pricingBasis: string }>; safetyNotice: string; pricingNote: string };
    expect(body.services).toHaveLength(9);
    // Customer-facing text shows VAT-inclusive prices (UK consumer pricing), matching what get_quote charges.
    expect(body.services.find((s) => s.jobType === 'boiler_service')).toMatchObject({ gasSafeRequired: true, pricingBasis: 'Fixed price £114 incl. VAT.' });
    const burst = body.services.find((s) => s.jobType === 'burst_pipe')?.pricingBasis;
    expect(burst).toBe('£90 call-out (covers the first hour), then £72 per extra hour. Usually 1–2.5 hours; parts about £18–£144.');
    // The VAT and surcharge rule is stated once, not repeated under every service.
    expect(body.pricingNote).toBe('All prices include VAT. Saturdays, evenings, Sundays, bank holidays and emergencies cost more.');
    expect(body.services.every((s) => !s.pricingBasis.includes('All prices include VAT'))).toBe(true);
    expect(body.services.every((s) => !s.pricingBasis.includes('ex VAT'))).toBe(true);
    expect(body.safetyNotice).toContain('0800 111 999');
  });
});

describe('POST /api/v1/quotes', () => {
  it('quotes at the standard tier without a window and says so', async () => {
    const res = await setup().post('/api/v1/quotes', { jobType: 'dripping_tap', postcode: 'sw4 7aa' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      jobType: 'dripping_tap', urgency: 'standard', postcode: 'SW4 7AA', tier: 'standard', windowStart: null,
      totalLowPence: 9600, totalHighPence: 13800, currency: 'GBP', note: 'Final price confirmed by the engineer before work starts.',
      tierNote: expect.stringMatching(/standard/),
    });
  });

  it('adds travel for a farther postcode (SE10 9NF is GBP 10)', async () => {
    const body = (await (await setup().post('/api/v1/quotes', { jobType: 'dripping_tap', postcode: 'SE10 9NF' })).json()) as { totalLowPence: number };
    expect(body.totalLowPence).toBe(Math.round(((7500 + 500 + 1000) * 120) / 100));
  });

  it('prices at the tier of the chosen window', async () => {
    const res = await setup().post('/api/v1/quotes', { jobType: 'boiler_service', postcode: 'SW4 7AA', windowStart: '2026-11-07T09:00:00+00:00' });
    expect(await res.json()).toMatchObject({ tier: 'saturday', totalLowPence: 14250, totalHighPence: 14250, windowStart: '2026-11-07T09:00:00+00:00' });
  });

  it('prices an emergency on an out-of-hours window: 22500-51300 with GBP 20 travel', async () => {
    const res = await setup().post('/api/v1/quotes', { jobType: 'burst_pipe', postcode: 'BR1 1AA', urgency: 'emergency', windowStart: '2026-11-09T18:00:00+00:00' });
    expect(await res.json()).toMatchObject({ tier: 'out_of_hours', totalLowPence: 22500, totalHighPence: 51300 });
  });

  it.each([
    ['out of area', { jobType: 'dripping_tap', postcode: 'RH1 1AA' }, 422, 'OUT_OF_AREA'],
    ['emergency on ineligible job', { jobType: 'dripping_tap', postcode: 'SW4 7AA', urgency: 'emergency' }, 422, 'NOT_EMERGENCY_ELIGIBLE'],
    ['not a real window', { jobType: 'dripping_tap', postcode: 'SW4 7AA', windowStart: '2026-11-08T10:00:00+00:00' }, 422, 'INVALID_WINDOW'],
    ['bad postcode', { jobType: 'dripping_tap', postcode: 'nope' }, 422, 'INVALID_POSTCODE'],
    ['unknown job', { jobType: 'plumbing', postcode: 'SW4 7AA' }, 400, 'VALIDATION_ERROR'],
    ['bad windowStart', { jobType: 'dripping_tap', postcode: 'SW4 7AA', windowStart: 'tomorrow' }, 400, 'VALIDATION_ERROR'],
  ])('%s -> %i %s', async (_name, body, status, code) => {
    const res = await setup().post('/api/v1/quotes', body);
    expect(res.status).toBe(status);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(await res.json()).toMatchObject({ code });
  });
});

describe('GET /api/v1/availability', () => {
  const get = (query: string, overrides?: Parameters<typeof makeDeps>[0]) => setup(overrides).app.request(`/api/v1/availability?${query}`);

  it('returns the 5 standard windows for Mon 9 Nov', async () => {
    const res = await get('jobType=dripping_tap&from=2026-11-09&days=1');
    const body = (await res.json()) as { windows: unknown[]; from: string; days: number };
    expect(body).toMatchObject({ from: '2026-11-09', days: 1 });
    expect(body.windows).toHaveLength(5);
  });

  it('defaults to 7 days from today', async () => {
    const body = (await (await get('jobType=dripping_tap')).json()) as { from: string; days: number };
    expect(body).toMatchObject({ from: '2026-11-04', days: 7 });
  });

  it.each(['days=0', 'days=15', 'days=abc', 'days=1.5', 'from=09-11-2026', 'from=2026-02-30', 'urgency=asap'])('rejects %s with VALIDATION_ERROR', async (query) => {
    const res = await get(`jobType=dripping_tap&${query}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('accepts the boundaries days=1 and days=14', async () => {
    expect((await get('jobType=dripping_tap&days=1')).status).toBe(200);
    expect((await get('jobType=dripping_tap&days=14')).status).toBe(200);
  });

  it('rejects an emergency on an ineligible job with 422', async () => {
    const res = await get('jobType=dripping_tap&urgency=emergency');
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'NOT_EMERGENCY_ELIGIBLE' });
  });

  it('returns 503 when gov.uk is down', async () => {
    const res = await get('jobType=dripping_tap', {
      bankHolidays: {
        dates: async () => {
          throw new AppError('UPSTREAM_UNAVAILABLE', 'The bank-holiday calendar is not responding.');
        },
      },
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });

  it('hides a window once it is fully booked', async () => {
    const { app, book } = setup();
    await book('key-aaaaaaaa', bookingRequest({ jobType: 'boiler_service' }));
    await book('key-bbbbbbbb', bookingRequest({ jobType: 'boiler_service' }));
    const body = (await (await app.request('/api/v1/availability?jobType=boiler_service&from=2026-11-09&days=1')).json()) as { windows: unknown[] };
    expect(body.windows).toHaveLength(4);
  });
});

describe('POST /api/v1/bookings', () => {
  it('creates a booking: 201, reference format, engineer first name and no contact details', async () => {
    const res = await setup().book('key-aaaaaaaa');
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown> & { reference: string };
    expect(body.reference).toMatch(REFERENCE_PATTERN);
    expect(body).toMatchObject({
      status: 'confirmed', jobType: 'dripping_tap', jobLabel: 'Dripping or leaking tap', urgency: 'standard', engineer: { firstName: 'Tom' },
      postcode: 'SW4 7AA', addressLine1: '14 Acre Lane', customerName: 'Sam Carter',
      window: { start: '2026-11-09T08:00:00+00:00', label: 'Mon 9 Nov, 8–10am', tier: 'standard' },
      quote: { totalLowPence: 9600, totalHighPence: 13800 },
      cancellableUntil: '2026-11-09T06:00:00+00:00',
    });
    expect(JSON.stringify(body)).not.toContain('07700');
  });

  it('returns 200 and the same body when the Idempotency-Key is reused', async () => {
    const { book, deps } = setup();
    const first = await book('key-aaaaaaaa');
    const second = await book('key-aaaaaaaa');
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(await deps.db.query('select 1 from bookings')).toHaveLength(1);
  });

  it('rejects a missing Idempotency-Key with 400', async () => {
    const res = await setup().book(null);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it.each(['short', 'has spaces in it', 'x'.repeat(101), 'bad!chars123'])('rejects the Idempotency-Key %j', async (key) => {
    expect((await setup().book(key)).status).toBe(400);
  });

  it('returns 409 SLOT_UNAVAILABLE when every eligible engineer is booked', async () => {
    const { book } = setup();
    await book('key-aaaaaaaa', bookingRequest({ jobType: 'boiler_service' }));
    await book('key-bbbbbbbb', bookingRequest({ jobType: 'boiler_service' }));
    const res = await book('key-cccccccc', bookingRequest({ jobType: 'boiler_service' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'SLOT_UNAVAILABLE' });
  });

  it.each([
    ['bad phone', { customer: { name: 'Sam', phone: '123' } }, 400, 'VALIDATION_ERROR'],
    ['missing address', { addressLine1: '' }, 400, 'VALIDATION_ERROR'],
    ['name too long', { customer: { name: 'x'.repeat(81), phone: '07700900123' } }, 400, 'VALIDATION_ERROR'],
    ['bad email', { customer: { name: 'Sam', phone: '07700900123', email: 'nope' } }, 400, 'VALIDATION_ERROR'],
    ['description too long', { problemDescription: 'x'.repeat(1001) }, 400, 'VALIDATION_ERROR'],
    ['out of area', { postcode: 'RH1 1AA' }, 422, 'OUT_OF_AREA'],
    ['past window', { windowStart: '2026-11-03T08:00:00+00:00' }, 422, 'INVALID_WINDOW'],
    ['emergency on tap', { urgency: 'emergency' }, 422, 'NOT_EMERGENCY_ELIGIBLE'],
  ])('%s -> %i %s', async (_name, overrides, status, code) => {
    const res = await setup().book('key-aaaaaaaa', bookingRequest(overrides));
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ code });
  });

  it('accepts a booking without an email', async () => {
    const res = await setup().book('key-aaaaaaaa', bookingRequest({ customer: { name: 'Sam', phone: '+44 20 7946 0000' } }));
    expect(res.status).toBe(201);
  });

  it.each([
    ['malformed JSON', '{bad', { 'Content-Type': 'application/json' }],
    ['an empty body', '', { 'Content-Type': 'application/json' }],
  ])('rejects %s with 400 VALIDATION_ERROR, not a 500', async (_name, body, headers) => {
    const deps = makeDeps();
    const res = await createApp(deps).request('/api/v1/quotes', { method: 'POST', body, headers });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(deps.logs.some((l) => l.includes('"level":"error"'))).toBe(false);
  });

  it('rejects whitespace-only free text with 400 VALIDATION_ERROR', async () => {
    const res = await setup().book('key-aaaaaaaa', bookingRequest({ addressLine1: '   ' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('GET /api/v1/bookings/{reference} and POST .../cancel', () => {
  async function booked(deps?: Parameters<typeof makeDeps>[0]) {
    const ctx = setup(deps);
    const body = (await (await ctx.book('key-aaaaaaaa')).json()) as { reference: string };
    return { ...ctx, reference: body.reference };
  }

  it('returns the booking for a lower-case postcode with no space', async () => {
    const { app, reference } = await booked();
    const res = await app.request(`/api/v1/bookings/${reference}?postcode=sw47aa`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ reference, status: 'confirmed' });
  });

  it('a wrong postcode returns exactly the same 404 as an unknown reference', async () => {
    const { app, reference } = await booked();
    const wrong = await app.request(`/api/v1/bookings/${reference}?postcode=E1%206AN`);
    const unknown = await app.request('/api/v1/bookings/HT-ZZZZZZ?postcode=SW4%207AA');
    expect(wrong.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await wrong.text()).toBe(await unknown.text());
  });

  it('requires a postcode (400) and a valid one (422)', async () => {
    const { app, reference } = await booked();
    expect((await app.request(`/api/v1/bookings/${reference}`)).status).toBe(400);
    expect((await app.request(`/api/v1/bookings/${reference}?postcode=nope`)).status).toBe(422);
  });

  it('cancels, and cancelling again still returns 200 with the cancelled booking', async () => {
    const { post, reference } = await booked();
    const first = await post(`/api/v1/bookings/${reference}/cancel`, { postcode: 'SW4 7AA' });
    const again = await post(`/api/v1/bookings/${reference}/cancel`, { postcode: 'SW4 7AA' });
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: 'cancelled' });
    expect(await again.json()).toMatchObject({ status: 'cancelled' });
  });

  it('cancel with the wrong postcode is 404 and a missing body postcode is 400', async () => {
    const { post, reference } = await booked();
    expect((await post(`/api/v1/bookings/${reference}/cancel`, { postcode: 'E1 6AN' })).status).toBe(404);
    expect((await post(`/api/v1/bookings/${reference}/cancel`, {})).status).toBe(400);
  });

  it('cancel inside 2 hours is 409 TOO_LATE_TO_CANCEL; exactly 2 hours is 200', async () => {
    const clock = { now: new Date('2026-11-04T09:00:00Z') };
    const { post, reference } = await booked({ now: () => clock.now });
    clock.now = new Date('2026-11-09T06:01:00Z');
    const late = await post(`/api/v1/bookings/${reference}/cancel`, { postcode: 'SW4 7AA' });
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ code: 'TOO_LATE_TO_CANCEL' });
    clock.now = new Date('2026-11-09T06:00:00Z');
    expect((await post(`/api/v1/bookings/${reference}/cancel`, { postcode: 'SW4 7AA' })).status).toBe(200);
  });
});

describe('GET /openapi.json', () => {
  it('documents all 8 endpoints (7 capabilities and /health) with their error responses', async () => {
    const res = await createApp(makeDeps()).request('/openapi.json');
    const doc = (await res.json()) as { paths: Record<string, Record<string, { responses: Record<string, unknown> }>> };
    const operations = Object.entries(doc.paths).flatMap(([path, methods]) => Object.entries(methods).map(([method, op]) => ({ key: `${method.toUpperCase()} ${path}`, op })));
    expect(operations.map((o) => o.key).sort()).toEqual([
      'GET /api/v1/availability',
      'GET /api/v1/bookings/{reference}',
      'GET /api/v1/service-area',
      'GET /api/v1/services',
      'POST /api/v1/bookings',
      'POST /api/v1/bookings/{reference}/cancel',
      'POST /api/v1/quotes',
      'GET /health',
    ].sort());
    const statuses = (key: string) => Object.keys(operations.find((o) => o.key === key)!.op.responses).sort();
    expect(statuses('POST /api/v1/bookings')).toEqual(['200', '201', '400', '409', '422', '500', '503']);
    expect(statuses('POST /api/v1/bookings/{reference}/cancel')).toEqual(['200', '400', '404', '409', '422', '500']);
    expect(statuses('GET /api/v1/bookings/{reference}')).toEqual(['200', '400', '404', '422', '500']);
    expect(statuses('POST /api/v1/quotes')).toEqual(['200', '400', '422', '500', '503']);
    expect(statuses('GET /api/v1/availability')).toEqual(['200', '400', '422', '500', '503']);
    const headers = doc.paths['/api/v1/bookings']?.post as unknown as { parameters: Array<{ name: string; in: string; required: boolean }> };
    expect(headers.parameters).toContainEqual(expect.objectContaining({ name: 'idempotency-key', in: 'header', required: true }));
  });
});
