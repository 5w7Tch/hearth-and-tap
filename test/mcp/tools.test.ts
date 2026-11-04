import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { Deps } from '../../src/deps.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { bookingRequest, makeDeps } from '../helpers.js';

async function connect(deps: Deps): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createMcpServer(deps).connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

type ToolResult = Awaited<ReturnType<Client['callTool']>>;
const errorBody = (result: ToolResult) => JSON.parse((result.content as Array<{ text: string }>)[0]!.text) as { code: string; message: string };

const KEY = 'key-aaaaaaaa';
const booking = (overrides: Record<string, unknown> = {}) => ({ ...bookingRequest(overrides), idempotencyKey: KEY });

describe('MCP tool catalogue', () => {
  it('exposes exactly the 7 capabilities', async () => {
    const { tools } = await (await connect(makeDeps())).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['book_visit', 'cancel_booking', 'check_service_area', 'find_availability', 'get_booking', 'get_quote', 'list_services'],
    );
  });

  it('annotates reads as read-only, book_visit as idempotent non-destructive, cancel_booking as destructive and idempotent', async () => {
    const { tools } = await (await connect(makeDeps())).listTools();
    const annotations = (name: string) => tools.find((t) => t.name === name)?.annotations;
    for (const name of ['list_services', 'check_service_area', 'get_quote', 'find_availability', 'get_booking']) {
      expect(annotations(name)?.readOnlyHint).toBe(true);
    }
    expect(annotations('book_visit')).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    expect(annotations('cancel_booking')).toMatchObject({ destructiveHint: true, idempotentHint: true });
  });

  it('describes every tool for an LLM: when to call it, units and what to do on failure', async () => {
    const { tools } = await (await connect(makeDeps())).listTools();
    const description = (name: string) => tools.find((t) => t.name === name)?.description ?? '';
    expect(description('get_quote')).toMatch(/pence/);
    expect(description('get_quote')).toMatch(/OUT_OF_AREA/);
    expect(description('find_availability')).toMatch(/never offer a time that is not in the result/i);
    expect(description('book_visit')).toMatch(/explicitly said yes/);
    expect(description('book_visit')).toMatch(/SLOT_UNAVAILABLE/);
    expect(description('book_visit')).toMatch(/0800 111 999/);
    expect(description('cancel_booking')).toMatch(/TOO_LATE_TO_CANCEL/);
    expect(description('get_booking')).toMatch(/NOT_FOUND/);
    expect(description('list_services')).toMatch(/safety/i);
  });

  it('gives every argument a description and marks the right ones required', async () => {
    const { tools } = await (await connect(makeDeps())).listTools();
    for (const tool of tools) {
      for (const [name, schema] of Object.entries(tool.inputSchema.properties ?? {})) {
        expect((schema as { description?: string }).description, `${tool.name}.${name}`).toBeTruthy();
      }
    }
    const book = tools.find((t) => t.name === 'book_visit')!;
    expect(book.inputSchema.required).toEqual(expect.arrayContaining(['jobType', 'postcode', 'addressLine1', 'windowStart', 'customer', 'problemDescription', 'idempotencyKey']));
    const availability = tools.find((t) => t.name === 'find_availability')!;
    expect(availability.inputSchema.required).toEqual(['jobType']);
  });
});

describe('MCP tool behaviour', () => {
  it('runs the whole journey: quote, availability, book, get, cancel', async () => {
    const client = await connect(makeDeps());
    const availability = await client.callTool({ name: 'find_availability', arguments: { jobType: 'dripping_tap', from: '2026-11-09', days: 1 } });
    const first = (availability.structuredContent as { windows: Array<{ start: string }> }).windows[0]!;
    const quote = await client.callTool({ name: 'get_quote', arguments: { jobType: 'dripping_tap', postcode: 'SW4 7AA', windowStart: first.start } });
    expect(quote.structuredContent).toMatchObject({ totalLowPence: 9600 });
    const booked = await client.callTool({ name: 'book_visit', arguments: booking({ windowStart: first.start }) });
    expect(booked.isError).toBeFalsy();
    const { reference } = booked.structuredContent as { reference: string };
    const got = await client.callTool({ name: 'get_booking', arguments: { reference, postcode: 'sw4 7aa' } });
    expect(got.structuredContent).toMatchObject({ reference, status: 'confirmed' });
    const cancelled = await client.callTool({ name: 'cancel_booking', arguments: { reference, postcode: 'SW4 7AA' } });
    expect(cancelled.structuredContent).toMatchObject({ reference, status: 'cancelled' });
  });

  it('reports domain errors with the same codes as REST', async () => {
    const client = await connect(makeDeps());
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['get_quote', { jobType: 'dripping_tap', postcode: 'RH1 1AA' }, 'OUT_OF_AREA'],
      ['get_quote', { jobType: 'dripping_tap', postcode: 'SW4 7AA', urgency: 'emergency' }, 'NOT_EMERGENCY_ELIGIBLE'],
      ['find_availability', { jobType: 'dripping_tap', urgency: 'emergency' }, 'NOT_EMERGENCY_ELIGIBLE'],
      ['book_visit', booking({ windowStart: '2026-11-09T08:30:00+00:00' }), 'INVALID_WINDOW'],
      ['book_visit', booking({ customer: { name: 'Sam', phone: '123' } }), 'VALIDATION_ERROR'],
      ['get_booking', { reference: 'HT-ZZZZZZ', postcode: 'SW4 7AA' }, 'NOT_FOUND'],
      ['cancel_booking', { reference: 'HT-ZZZZZZ', postcode: 'SW4 7AA' }, 'NOT_FOUND'],
    ];
    for (const [name, args, code] of cases) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, name).toBe(true);
      expect(errorBody(result), name).toMatchObject({ code });
    }
  });

  it('rejects schema-invalid arguments with a readable input-validation error, as the server instructions describe', async () => {
    const client = await connect(makeDeps());
    const result = await client.callTool({ name: 'find_availability', arguments: { jobType: 'dripping_tap', days: 99 } });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]!.text).toMatch(/Input validation error[\s\S]*days/);
    expect(client.getInstructions()).toMatch(/Input validation error/);
  });

  it('book_visit returns SLOT_UNAVAILABLE for a full window and TOO_LATE_TO_CANCEL inside 2 hours', async () => {
    const clock = { now: new Date('2026-11-04T09:00:00Z') };
    const client = await connect(makeDeps({ now: () => clock.now }));
    const gas = (key: string) => ({ ...booking({ jobType: 'boiler_service' }), idempotencyKey: key });
    const one = await client.callTool({ name: 'book_visit', arguments: gas('key-aaaaaaaa') });
    await client.callTool({ name: 'book_visit', arguments: gas('key-bbbbbbbb') });
    const full = await client.callTool({ name: 'book_visit', arguments: gas('key-cccccccc') });
    expect(errorBody(full)).toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    clock.now = new Date('2026-11-09T06:30:00Z');
    const late = await client.callTool({ name: 'cancel_booking', arguments: { reference: (one.structuredContent as { reference: string }).reference, postcode: 'SW4 7AA' } });
    expect(errorBody(late)).toMatchObject({ code: 'TOO_LATE_TO_CANCEL' });
  });
});

describe('REST/MCP parity', () => {
  it('returns the same JSON from REST and MCP structuredContent for all 7 capabilities', async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const client = await connect(deps);
    const rest = async (path: string, init?: RequestInit) => (await app.request(path, init)).json() as Promise<unknown>;
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      rest(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const mcp = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent;

    expect(await rest('/api/v1/services')).toEqual(await mcp('list_services', {}));
    expect(await rest('/api/v1/service-area?postcode=SE10%209NF')).toEqual(await mcp('check_service_area', { postcode: 'SE10 9NF' }));
    expect(await post('/api/v1/quotes', { jobType: 'burst_pipe', postcode: 'SW4 7AA', urgency: 'emergency', windowStart: '2026-11-09T18:00:00+00:00' })).toEqual(
      await mcp('get_quote', { jobType: 'burst_pipe', postcode: 'SW4 7AA', urgency: 'emergency', windowStart: '2026-11-09T18:00:00+00:00' }),
    );
    expect(await rest('/api/v1/availability?jobType=burst_pipe&urgency=emergency&from=2026-11-08&days=3')).toEqual(
      await mcp('find_availability', { jobType: 'burst_pipe', urgency: 'emergency', from: '2026-11-08', days: 3 }),
    );
    expect(await rest('/api/v1/availability?jobType=dripping_tap')).toEqual(await mcp('find_availability', { jobType: 'dripping_tap' }));

    const booked = (await post('/api/v1/bookings', bookingRequest(), { 'Idempotency-Key': KEY })) as { reference: string };
    expect(booked).toEqual(await mcp('book_visit', booking()));
    const { reference } = booked;
    expect(await rest(`/api/v1/bookings/${reference}?postcode=SW4%207AA`)).toEqual(await mcp('get_booking', { reference, postcode: 'SW4 7AA' }));
    const cancelled = await post(`/api/v1/bookings/${reference}/cancel`, { postcode: 'SW4 7AA' });
    expect(cancelled).toMatchObject({ status: 'cancelled' });
    expect(cancelled).toEqual(await mcp('cancel_booking', { reference, postcode: 'SW4 7AA' }));
  });
});
