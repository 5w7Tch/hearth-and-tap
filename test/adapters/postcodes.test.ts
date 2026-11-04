import { describe, expect, it } from 'vitest';
import { createPostcodesIo } from '../../src/adapters/postcodes.js';

function stubFetch(respond: (url: string) => Response | Promise<Response>): typeof fetch {
  return (async (input: string | URL | Request) => respond(String(input))) as typeof fetch;
}

const OK_BODY = {
  status: 200,
  result: { postcode: 'SW4 7AA', region: 'London', admin_district: 'Lambeth', latitude: 51.461518, longitude: -0.137855, eastings: 1 },
};

describe('createPostcodesIo', () => {
  it('maps a postcodes.io record to a PostcodeLocation', async () => {
    let calledUrl = '';
    const client = createPostcodesIo({
      fetch: stubFetch((url) => {
        calledUrl = url;
        return Response.json(OK_BODY);
      }),
    });
    await expect(client.lookup('SW4 7AA')).resolves.toEqual({
      postcode: 'SW4 7AA',
      region: 'London',
      borough: 'Lambeth',
      latitude: 51.461518,
      longitude: -0.137855,
    });
    expect(calledUrl).toBe('https://api.postcodes.io/postcodes/SW4%207AA');
  });

  it('turns a 404 into INVALID_POSTCODE', async () => {
    const client = createPostcodesIo({ fetch: stubFetch(() => Response.json({ status: 404, error: 'Invalid postcode' }, { status: 404 })) });
    await expect(client.lookup('ZZ1 1ZZ')).rejects.toMatchObject({ code: 'INVALID_POSTCODE' });
  });

  it('turns a 5xx into UPSTREAM_UNAVAILABLE', async () => {
    const client = createPostcodesIo({ fetch: stubFetch(() => new Response('boom', { status: 502 })) });
    await expect(client.lookup('SW4 7AA')).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', status: 503 });
  });

  it('turns a network failure into UPSTREAM_UNAVAILABLE', async () => {
    const client = createPostcodesIo({
      fetch: stubFetch(() => {
        throw new TypeError('fetch failed');
      }),
    });
    await expect(client.lookup('SW4 7AA')).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });

  it('rejects a malformed upstream body as UPSTREAM_UNAVAILABLE', async () => {
    const client = createPostcodesIo({ fetch: stubFetch(() => Response.json({ status: 200, result: { postcode: 42 } })) });
    await expect(client.lookup('SW4 7AA')).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });

  it('turns a non-JSON 200 (e.g. an HTML error page) into UPSTREAM_UNAVAILABLE', async () => {
    const client = createPostcodesIo({ fetch: stubFetch(() => new Response('<html>maintenance</html>', { status: 200 })) });
    await expect(client.lookup('SW4 7AA')).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });

  it('treats a postcode with no coordinates as INVALID_POSTCODE', async () => {
    const body = { status: 200, result: { ...OK_BODY.result, latitude: null, longitude: null } };
    const client = createPostcodesIo({ fetch: stubFetch(() => Response.json(body)) });
    await expect(client.lookup('SW4 7AA')).rejects.toMatchObject({ code: 'INVALID_POSTCODE' });
  });
});
