import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AppError } from '../domain/errors.js';

function textResult(payload: unknown, isError: boolean): CallToolResult {
  return { isError, content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

/**
 * Runs a use case for an MCP tool. Domain errors go back to the model as isError results,
 * using the same codes as REST. Unexpected errors are logged, and the client gets a generic INTERNAL_ERROR.
 */
export async function runTool<T extends Record<string, unknown>>(log: (line: string) => void, fn: () => Promise<T>): Promise<CallToolResult> {
  try {
    const data = await fn();
    return { ...textResult(data, false), structuredContent: data };
  } catch (err) {
    if (err instanceof AppError) {
      return textResult({ code: err.code, message: err.message }, true);
    }
    log(JSON.stringify({ level: 'error', where: 'mcp', message: String(err), stack: err instanceof Error ? err.stack : undefined }));
    return textResult({ code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Please offer the customer a call back.' }, true);
  }
}
