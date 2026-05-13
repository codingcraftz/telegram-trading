import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { getConfig } from '../config.js';

export type McpTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

let _client: Client | null = null;
let _tools: McpTool[] = [];

export async function connectMcp(): Promise<Client> {
  if (_client) return _client;
  const cfg = getConfig();
  const transport = new SSEClientTransport(new URL(cfg.KIS_MCP_URL));
  const client = new Client(
    { name: 'telegram-trading', version: '0.1.0' },
    { capabilities: {} },
  );
  await client.connect(transport);
  _client = client;
  const list = await client.listTools();
  _tools = list.tools as McpTool[];
  return client;
}

export function getAllTools(): McpTool[] {
  return _tools;
}

export async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!_client) throw new Error('MCP not connected');
  const res = await _client.callTool({ name, arguments: args });
  return res;
}

export async function closeMcp() {
  await _client?.close();
  _client = null;
  _tools = [];
}
