import { describe, expect, it } from 'vitest';
import { createGovUkBankHolidays } from '../../src/adapters/bankHolidays.js';

const BODY = {
  division: 'england-and-wales',
  'england-and-wales': { division: 'england-and-wales', events: [{ title: 'Christmas Day', date: '2026-12-25', notes: '', bunting: true }, { title: 'Boxing Day', date: '2026-12-28' }] },
  scotland: { events: [{ date: '2026-11-30' }] },
};

function setup(respond: () => Response | Promise<Response> = () => Response.json(BODY)) {
  const state = { calls: 0, now: new Date('2026-11-04T09:00:00Z'), url: '' };
  const fetchStub = (async (input: string | URL | Request) => {
    state.calls++;
    state.url = String(input);
    return respond();
  }) as typeof fetch;
  const source = createGovUkBankHolidays({ now: () => state.now, fetch: fetchStub });
  return { state, source };
}

describe('createGovUkBankHolidays', () => {
  it('returns the england-and-wales dates only', async () => {
    const { source, state } = setup();
    expect(await source.dates()).toEqual(new Set(['2026-12-25', '2026-12-28']));
    expect(state.url).toBe('https://www.gov.uk/bank-holidays.json');
  });

  it('serves from cache at 11h59m and refetches at 12h', async () => {
    const { source, state } = setup();
    await source.dates();
    state.now = new Date(state.now.getTime() + (12 * 60 - 1) * 60_000);
    await source.dates();
    expect(state.calls).toBe(1);
    state.now = new Date(state.now.getTime() + 60_000);
    await source.dates();
    expect(state.calls).toBe(2);
  });

  it('maps a network error to UPSTREAM_UNAVAILABLE', async () => {
    const source = createGovUkBankHolidays({
      now: () => new Date(),
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    await expect(source.dates()).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', status: 503 });
  });

  it('maps a non-2xx response to UPSTREAM_UNAVAILABLE and does not cache the failure', async () => {
    let ok = false;
    const { source, state } = setup(() => (ok ? Response.json(BODY) : new Response('down', { status: 502 })));
    await expect(source.dates()).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    ok = true;
    await expect(source.dates()).resolves.toHaveProperty('size', 2);
    expect(state.calls).toBe(2);
  });

  it.each([
    ['wrong shape', () => Response.json({ nope: true })],
    ['bad date', () => Response.json({ 'england-and-wales': { events: [{ date: 'Christmas' }] } })],
    ['not JSON', () => new Response('<html>')],
  ])('maps a malformed body (%s) to UPSTREAM_UNAVAILABLE', async (_name, respond) => {
    const { source } = setup(respond);
    await expect(source.dates()).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });
});
