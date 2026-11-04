import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { runSmoke } from '../../scripts/smoke.js';
import { makeDeps } from '../helpers.js';

const BASE = 'http://smoke.test';

/** Routes the smoke script's fetches into the in-process app. */
const appFetch = (deps = makeDeps()) => {
  const app = createApp(deps);
  return (input: string, init?: RequestInit) => Promise.resolve(app.request(input.replace(BASE, ''), init));
};

describe('smoke script', () => {
  it('runs the whole journey against the app and leaves the booking cancelled', async () => {
    const deps = makeDeps();
    const lines: string[] = [];
    await runSmoke({ baseUrl: BASE, fetch: appFetch(deps), log: (l) => lines.push(l) });
    expect(lines).toHaveLength(10);
    expect(lines.at(-1)).toMatch(/Smoke test passed.*HT-/);
    const rows = await deps.db.query<{ status: string }>('select status from bookings');
    expect(rows).toEqual([{ status: 'cancelled' }]);
  });

  it('fails loudly, naming the step, when a call fails', async () => {
    const broken = appFetch();
    const fetchStub = (input: string, init?: RequestInit) =>
      input.endsWith('/mcp') && String(init?.body).includes('tools/list') ? Promise.resolve(new Response('nope', { status: 502 })) : broken(input, init);
    await expect(runSmoke({ baseUrl: BASE, fetch: fetchStub, log: () => {} })).rejects.toThrow(/tools\/list has 7 tools: tools\/list: HTTP 502/);
  });

  it('fails when a tool returns an error result', async () => {
    const deps = makeDeps({ bankHolidays: { dates: async () => { throw new Error('boom'); } } });
    await expect(runSmoke({ baseUrl: BASE, fetch: appFetch(deps), log: () => {} })).rejects.toThrow(/find_availability/);
  });
});
