import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../config.js';
import { callTool, getAllTools } from '../mcp/client.js';
import { buildSystemPrompt } from './prompt.js';

export type ProposalArgs = {
  action: 'buy' | 'sell';
  market:
    | 'KRX'
    | 'NASDAQ'
    | 'NYSE'
    | 'AMEX'
    | 'TSE'
    | 'HKEX'
    | 'SSE'
    | 'SZSE'
    | 'HNX'
    | 'HSX';
  symbol_code: string;
  symbol_name: string;
  order_type: 'limit' | 'market';
  price?: number;
  quantity: number;
  tp_pct?: number | null;
  sl_pct?: number | null;
  summary_message: string;
};

export type LlmOutput =
  | { kind: 'proposal'; proposal: ProposalArgs; rawText: string }
  | { kind: 'text'; text: string };

const SUBMIT_PROPOSAL_TOOL: Anthropic.Tool = {
  name: 'submit_proposal',
  description:
    '매매 제안을 최종 확정. 호출하면 시스템이 사용자에게 /confirm을 요청한다. 정보 조회만 응답하려면 호출하지 말고 텍스트로 답하라.',
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['buy', 'sell'] },
      market: {
        type: 'string',
        enum: ['KRX', 'NASDAQ', 'NYSE', 'AMEX', 'TSE', 'HKEX', 'SSE', 'SZSE', 'HNX', 'HSX'],
      },
      symbol_code: { type: 'string' },
      symbol_name: { type: 'string' },
      order_type: { type: 'string', enum: ['limit', 'market'] },
      price: { type: 'integer', description: '지정가일 때 주문 가격 (정수)' },
      quantity: { type: 'integer' },
      tp_pct: { type: ['number', 'null'] },
      sl_pct: { type: ['number', 'null'] },
      summary_message: { type: 'string' },
    },
    required: [
      'action',
      'market',
      'symbol_code',
      'symbol_name',
      'order_type',
      'quantity',
      'summary_message',
    ],
  },
};

function mcpToClaudeTool(t: {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}): Anthropic.Tool {
  return {
    name: t.name,
    description: t.description ?? '',
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  };
}

// LLM이 호출 못 하게 막을 api_type 패턴.
// KIS Trading MCP는 카테고리(domestic_stock, overseas_stock 등)를 한 도구로 등록하고
// api_type 파라미터로 실제 API를 식별하므로, 도구 단위 화이트리스트가 안 되고
// 실행 시점에 api_type 단위로 가로채야 함.
const FORBIDDEN_API_TYPE = /^(order|order_cash|order_credit|order_rvsecncl|order_resv|daytime_order)/i;

const MAX_TOOL_ITERATIONS = 12;

export async function runAgent(userText: string): Promise<LlmOutput> {
  const cfg = getConfig();
  const anthropic = new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY });

  const tools: Anthropic.Tool[] = [
    SUBMIT_PROPOSAL_TOOL,
    ...getAllTools().map(mcpToClaudeTool),
  ];

  const system: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: buildSystemPrompt(),
      cache_control: { type: 'ephemeral' },
    },
  ];

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userText },
  ];

  let textAccumulator = '';

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const resp = await anthropic.messages.create({
      model: cfg.ANTHROPIC_MODEL,
      max_tokens: 2048,
      system,
      tools,
      messages,
    });

    for (const b of resp.content) {
      if (b.type === 'text') textAccumulator += b.text + '\n';
    }

    if (resp.stop_reason === 'end_turn') {
      return { kind: 'text', text: textAccumulator.trim() || '(응답 비어있음)' };
    }

    if (resp.stop_reason === 'tool_use') {
      const toolUses = resp.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );

      const proposal = toolUses.find((t) => t.name === 'submit_proposal');
      if (proposal) {
        return {
          kind: 'proposal',
          proposal: proposal.input as ProposalArgs,
          rawText: textAccumulator.trim(),
        };
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const input = tu.input as Record<string, unknown>;
        const apiType = typeof input.api_type === 'string' ? input.api_type : '';

        // 주문류 api_type 차단 (defense in depth)
        if (apiType && FORBIDDEN_API_TYPE.test(apiType)) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content:
              '주문 관련 api_type(order_*)은 LLM이 직접 호출할 수 없습니다. submit_proposal로 제안만 작성하세요.',
            is_error: true,
          });
          continue;
        }

        try {
          const result = await callTool(tu.name, input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify(result).slice(0, 50_000),
          });
        } catch (err) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: `ERROR: ${(err as Error).message}`,
            is_error: true,
          });
        }
      }

      messages.push({ role: 'assistant', content: resp.content });
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    return { kind: 'text', text: textAccumulator.trim() || '응답 처리 실패' };
  }

  return { kind: 'text', text: '도구 호출 횟수 초과. 요청을 단순화해서 다시 시도해 주세요.' };
}
