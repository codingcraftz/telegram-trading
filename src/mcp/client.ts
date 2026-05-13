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

  // 재시도: compose에서 kis-mcp가 떠 있어도 SSE 핸들러 준비까지 몇 초 걸릴 수 있음
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      const transport = new SSEClientTransport(new URL(cfg.KIS_MCP_URL));
      const client = new Client(
        { name: 'telegram-trading', version: '0.1.0' },
        { capabilities: {} },
      );
      await client.connect(transport);
      _client = client;
      const list = await client.listTools();
      _tools = list.tools as McpTool[];
      console.log(
        `[mcp] connected, ${_tools.length} tools available: ${_tools
          .map((t) => t.name)
          .join(', ')}`,
      );
      return client;
    } catch (err) {
      lastErr = err;
      console.warn(
        `[mcp] connect attempt ${attempt}/30 failed: ${(err as Error).message}`,
      );
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error(
    `MCP connection failed after 30 attempts: ${(lastErr as Error)?.message}`,
  );
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
