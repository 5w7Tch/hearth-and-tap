// End-to-end check of a deployed instance: `BASE_URL=https://... npm run smoke`.
// Books, reads and cancels one real visit over MCP, then exits non-zero if anything failed.
import { pathToFileURL } from 'node:url';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

interface SmokeOptions {
  baseUrl: string;
  fetch?: Fetch;
  log?: (line: string) => void;
}

interface JsonRpcReply {
  result?: { tools?: Array<{ name: string }>; isError?: boolean; structuredContent?: Record<string, unknown>; content?: Array<{ text: string }> };
  error?: { message: string };
}

const EXPECTED_TOOLS = ['book_visit', 'cancel_booking', 'check_service_area', 'find_availability', 'get_booking', 'get_quote', 'list_services'];
const POSTCODE = 'SW4 7AA';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function runSmoke({ baseUrl, fetch: doFetch = fetch, log = console.log }: SmokeOptions): Promise<void> {
  let nextId = 1;

  async function rpc(method: string, params: Record<string, unknown>): Promise<NonNullable<JsonRpcReply['result']>> {
    const res = await doFetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    });
    assert(res.ok, `${method}: HTTP ${res.status}`);
    const reply = (await res.json()) as JsonRpcReply;
    assert(!reply.error && reply.result, `${method}: ${reply.error?.message ?? 'no result'}`);
    return reply.result;
  }

  async function tool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = await rpc('tools/call', { name, arguments: args });
    assert(!result.isError, `${name} failed: ${result.content?.[0]?.text ?? 'unknown error'}`);
    assert(result.structuredContent, `${name}: no structuredContent`);
    return result.structuredContent;
  }

  async function step(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      throw new Error(`${name}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    log(`ok   ${name}`);
  }

  await step('GET /health', async () => {
    const res = await doFetch(`${baseUrl}/health`);
    assert(res.ok, `HTTP ${res.status}`);
  });
  await step('initialize', async () => {
    const result = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1.0.0' } });
    assert('serverInfo' in result, 'no serverInfo');
  });
  await step('tools/list has 7 tools', async () => {
    const names = ((await rpc('tools/list', {})).tools ?? []).map((t) => t.name).sort();
    assert(JSON.stringify(names) === JSON.stringify(EXPECTED_TOOLS), `got ${names.join(', ')}`);
  });
  await step('check_service_area', async () => {
    assert((await tool('check_service_area', { postcode: POSTCODE })).covered === true, `${POSTCODE} should be covered`);
  });
  await step('get_quote', async () => {
    const quote = await tool('get_quote', { jobType: 'dripping_tap', postcode: POSTCODE });
    assert(Number.isInteger(quote.totalLowPence), 'totalLowPence should be integer pence');
  });

  let windowStart = '';
  await step('find_availability', async () => {
    const { windows } = (await tool('find_availability', { jobType: 'dripping_tap' })) as { windows: Array<{ start: string }> };
    // The LAST window of the week, not the first: the first can be under 2 hours away, when cancelling is no longer allowed.
    const last = windows.at(-1);
    assert(last, 'no open windows in the next 7 days');
    windowStart = last.start;
  });

  let reference = '';
  await step('book_visit (last window of the week)', async () => {
    const booking = await tool('book_visit', {
      jobType: 'dripping_tap',
      postcode: POSTCODE,
      addressLine1: 'Smoke test, please ignore',
      windowStart,
      customer: { name: 'Smoke Test', phone: '07700 900123' },
      problemDescription: 'Automated smoke test booking. It is cancelled straight away.',
      idempotencyKey: `smoke-${Date.now()}`,
    });
    assert(booking.status === 'confirmed' && typeof booking.reference === 'string', 'booking not confirmed');
    reference = booking.reference;
  });
  try {
    await step('get_booking', async () => {
      assert((await tool('get_booking', { reference, postcode: POSTCODE })).status === 'confirmed', 'booking should be confirmed');
    });
  } finally {
    // Always release the slot, even if the lookup failed.
    await step('cancel_booking', async () => {
      assert((await tool('cancel_booking', { reference, postcode: POSTCODE })).status === 'cancelled', 'booking should be cancelled');
    });
  }
  log(`Smoke test passed against ${baseUrl} (booking ${reference} cancelled).`);
}

// Only run when executed directly (`npm run smoke`), not when imported by the tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const baseUrl = process.env.BASE_URL?.replace(/\/$/, '');
  if (!baseUrl) {
    console.error('BASE_URL is not set, e.g. BASE_URL=https://hearth-and-tap.vercel.app');
    process.exit(1);
  }
  runSmoke({ baseUrl }).catch((err: unknown) => {
    console.error(`FAIL ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
