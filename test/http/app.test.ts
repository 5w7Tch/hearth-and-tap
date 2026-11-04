import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { AppError } from '../../src/domain/errors.js';
import { makeDeps } from '../helpers.js';

describe('HTTP app', () => {
  it('GET /health is ok', async () => {
    const res = await createApp(makeDeps()).request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('GET / shows the demo-business banner and links to the docs', async () => {
    const res = await createApp(makeDeps()).request('/');
    const html = await res.text();
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(html).toMatch(/demo business/i);
    expect(html).toContain('/docs');
    expect(html).toContain('/mcp');
  });

  it('serves an OpenAPI 3.1 document listing the service-area path', async () => {
    const res = await createApp(makeDeps()).request('/openapi.json');
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths).toHaveProperty('/api/v1/service-area');
  });

  it('serves Swagger UI at /docs', async () => {
    const res = await createApp(makeDeps()).request('/docs');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('swagger');
  });

  it('returns problem+json for unknown routes', async () => {
    const res = await createApp(makeDeps()).request('/nope');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(await res.json()).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('rejects bodies over 16 KB with 413 problem+json before any handler runs', async () => {
    const res = await createApp(makeDeps()).request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', padding: 'x'.repeat(20_000) }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('allows cross-origin calls from the agent', async () => {
    const res = await createApp(makeDeps()).request('/api/v1/service-area?postcode=SW47AA', {
      headers: { Origin: 'https://example.agentplace.io' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('logs one structured line per request without the query string', async () => {
    const deps = makeDeps();
    await createApp(deps).request('/api/v1/service-area?postcode=SW47AA');
    expect(deps.logs).toHaveLength(1);
    const line = JSON.parse(deps.logs[0]!) as Record<string, unknown>;
    expect(line).toMatchObject({ method: 'GET', path: '/api/v1/service-area', status: 200 });
    expect(typeof line.ms).toBe('number');
    expect(deps.logs[0]).not.toMatch(/SW4/i);
  });

  it('hides unexpected errors behind a generic 500 and logs them', async () => {
    const deps = makeDeps({
      postcodes: {
        lookup: async () => {
          throw new Error('secret internal detail');
        },
      },
    });
    const res = await createApp(deps).request('/api/v1/service-area?postcode=SW47AA');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string; detail: string };
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.detail).not.toContain('secret');
    expect(deps.logs.some((l) => l.includes('secret internal detail'))).toBe(true);
  });
});

describe('GET /api/v1/service-area', () => {
  it('returns coverage for a valid postcode in any casing', async () => {
    const res = await createApp(makeDeps()).request('/api/v1/service-area?postcode=se10%209nf');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      postcode: 'SE10 9NF',
      covered: true,
      borough: 'Greenwich',
      distanceMiles: 5.8,
      travelFeePence: 1000,
      reason: null,
    });
  });

  it('returns covered:false (not an error) outside London', async () => {
    const res = await createApp(makeDeps()).request('/api/v1/service-area?postcode=RH11AA');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ covered: false, reason: 'outside_london' });
  });

  it('rejects a malformed postcode with 422 problem+json', async () => {
    const res = await createApp(makeDeps()).request('/api/v1/service-area?postcode=hello');
    expect(res.status).toBe(422);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(await res.json()).toMatchObject({ code: 'INVALID_POSTCODE', status: 422 });
  });

  it('rejects a missing postcode with 400 VALIDATION_ERROR', async () => {
    const res = await createApp(makeDeps()).request('/api/v1/service-area');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('passes UPSTREAM_UNAVAILABLE through as 503', async () => {
    const deps = makeDeps({
      postcodes: {
        lookup: async () => {
          throw new AppError('UPSTREAM_UNAVAILABLE', 'The postcode service is not responding.');
        },
      },
    });
    const res = await createApp(deps).request('/api/v1/service-area?postcode=SW47AA');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });
});
