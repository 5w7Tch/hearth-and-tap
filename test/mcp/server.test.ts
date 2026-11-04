import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { Deps } from '../../src/deps.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { makeDeps } from '../helpers.js';

async function connect(deps: Deps): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createMcpServer(deps).connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

function parseText(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  const first = (result.content as Array<{ type: string; text: string }>)[0]!;
  return JSON.parse(first.text);
}

describe('MCP server', () => {
  it('lists check_service_area with an input schema and server instructions', async () => {
    const client = await connect(makeDeps());
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'check_service_area');
    expect(tool?.inputSchema.properties?.postcode).toMatchObject({ type: 'string', description: expect.stringMatching(/postcode/i) });
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(client.getInstructions()).toMatch(/0800 111 999/);
  });

  it('check_service_area returns structured coverage', async () => {
    const client = await connect(makeDeps());
    const result = await client.callTool({ name: 'check_service_area', arguments: { postcode: 'e1 6an' } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ postcode: 'E1 6AN', covered: true, travelFeePence: 1000 });
    expect(parseText(result)).toEqual(result.structuredContent);
  });

  it('check_service_area reports domain errors as isError with the same code', async () => {
    const client = await connect(makeDeps());
    const result = await client.callTool({ name: 'check_service_area', arguments: { postcode: 'nonsense' } });
    expect(result.isError).toBe(true);
    expect(parseText(result)).toMatchObject({ code: 'INVALID_POSTCODE' });
  });

  it('hides unexpected errors from MCP clients and logs them', async () => {
    const deps = makeDeps({
      postcodes: {
        lookup: async () => {
          throw new Error('db password leaked');
        },
      },
    });
    const client = await connect(deps);
    const result = await client.callTool({ name: 'check_service_area', arguments: { postcode: 'SW4 7AA' } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('password');
    expect(parseText(result)).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(deps.logs.some((l) => l.includes('db password leaked'))).toBe(true);
  });
});

describe('POST /mcp (Streamable HTTP, stateless)', () => {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

  it('completes an initialize handshake over HTTP', async () => {
    const res = await createApp(makeDeps()).request('/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'curl', version: '0' } },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { serverInfo: { name: string } } };
    expect(body.result.serverInfo.name).toBe('hearth-and-tap');
  });

  it('calls a tool over HTTP without a session', async () => {
    const res = await createApp(makeDeps()).request('/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'check_service_area', arguments: { postcode: 'BR1 1AA' } } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { structuredContent: { travelFeePence: number } } };
    expect(body.result.structuredContent.travelFeePence).toBe(2000);
  });
});
