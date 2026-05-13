import {
  GoogleGenAI,
  Type,
  type Content,
  type FunctionDeclaration,
  type Part,
  type Schema,
} from '@google/genai';
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

const SUBMIT_PROPOSAL: FunctionDeclaration = {
  name: 'submit_proposal',
  description:
    '매매 제안을 최종 확정. 호출하면 시스템이 사용자에게 /confirm을 요청한다. 정보 조회만 응답하려면 호출하지 말고 텍스트로 답하라.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      action: { type: Type.STRING, enum: ['buy', 'sell'] },
      market: {
        type: Type.STRING,
        enum: ['KRX', 'NASDAQ', 'NYSE', 'AMEX', 'TSE', 'HKEX', 'SSE', 'SZSE', 'HNX', 'HSX'],
      },
      symbol_code: { type: Type.STRING },
      symbol_name: { type: Type.STRING },
      order_type: { type: Type.STRING, enum: ['limit', 'market'] },
      price: { type: Type.INTEGER, description: '지정가일 때 주문 가격 (정수)' },
      quantity: { type: Type.INTEGER },
      tp_pct: { type: Type.NUMBER, nullable: true },
      sl_pct: { type: Type.NUMBER, nullable: true },
      summary_message: { type: Type.STRING },
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

// JSON Schema → Gemini Schema 변환. Gemini는 자체 Type enum을 쓰지만
// 문자열 'object'/'string'도 대체로 받아들임. 안전하게 매핑.
function normalizeSchema(s: unknown): Schema | undefined {
  if (!s || typeof s !== 'object') return undefined;
  const src = s as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  // type
  const t = src.type;
  if (typeof t === 'string') {
    const map: Record<string, Type> = {
      string: Type.STRING,
      number: Type.NUMBER,
      integer: Type.INTEGER,
      boolean: Type.BOOLEAN,
      object: Type.OBJECT,
      array: Type.ARRAY,
    };
    out.type = map[t.toLowerCase()] ?? Type.OBJECT;
  } else if (Array.isArray(t)) {
    // 첫 비-null 타입
    const first = (t as unknown[]).find((x) => x !== 'null') as string | undefined;
    out.type = first ? normalizeSchema({ type: first })?.type : Type.STRING;
  } else {
    out.type = Type.OBJECT;
  }

  if (typeof src.description === 'string') out.description = src.description;
  if (Array.isArray(src.enum)) out.enum = src.enum;
  if (Array.isArray(src.required)) out.required = src.required;

  // nullable
  if (Array.isArray(src.type) && (src.type as unknown[]).includes('null')) {
    out.nullable = true;
  }

  // properties
  if (src.properties && typeof src.properties === 'object') {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src.properties as Record<string, unknown>)) {
      const n = normalizeSchema(v);
      if (n) props[k] = n;
    }
    out.properties = props;
  }

  // items
  if (src.items) out.items = normalizeSchema(src.items);

  return out as Schema;
}

function mcpToolToDeclaration(t: {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}): FunctionDeclaration {
  return {
    name: t.name,
    description: (t.description ?? '').slice(0, 1024),
    parameters: normalizeSchema(t.inputSchema) ?? { type: Type.OBJECT, properties: {} },
  };
}

const FORBIDDEN_API_TYPE = /^(order|order_cash|order_credit|order_rvsecncl|order_resv|daytime_order)/i;

const MAX_TOOL_ITERATIONS = 12;

export async function runAgent(userText: string): Promise<LlmOutput> {
  const cfg = getConfig();
  const ai = new GoogleGenAI({ apiKey: cfg.GEMINI_API_KEY });

  const declarations: FunctionDeclaration[] = [
    SUBMIT_PROPOSAL,
    ...getAllTools().map(mcpToolToDeclaration),
  ];

  const systemInstruction = buildSystemPrompt();

  const contents: Content[] = [
    { role: 'user', parts: [{ text: userText }] },
  ];

  let textAccumulator = '';

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const resp = await ai.models.generateContent({
      model: cfg.GEMINI_MODEL,
      contents,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: declarations }],
      },
    });

    const candidate = resp.candidates?.[0];
    const parts: Part[] = candidate?.content?.parts ?? [];

    for (const p of parts) {
      if ('text' in p && typeof p.text === 'string' && p.text) {
        textAccumulator += p.text + '\n';
      }
    }

    const functionCalls = parts.filter(
      (p): p is Part & { functionCall: { name: string; args: Record<string, unknown> } } =>
        'functionCall' in p && !!p.functionCall,
    );

    if (functionCalls.length === 0) {
      return { kind: 'text', text: textAccumulator.trim() || '(응답 비어있음)' };
    }

    // submit_proposal 발견 시 종료
    const proposal = functionCalls.find((p) => p.functionCall.name === 'submit_proposal');
    if (proposal) {
      return {
        kind: 'proposal',
        proposal: proposal.functionCall.args as unknown as ProposalArgs,
        rawText: textAccumulator.trim(),
      };
    }

    // 일반 MCP 도구 실행
    const responseParts: Part[] = [];
    for (const fc of functionCalls) {
      const { name, args } = fc.functionCall;
      const apiType = typeof args.api_type === 'string' ? args.api_type : '';
      if (apiType && FORBIDDEN_API_TYPE.test(apiType)) {
        responseParts.push({
          functionResponse: {
            name,
            response: {
              error:
                '주문 관련 api_type(order_*)은 LLM이 직접 호출할 수 없습니다. submit_proposal로 제안만 작성하세요.',
            },
          },
        });
        continue;
      }
      try {
        const result = await callTool(name, args);
        responseParts.push({
          functionResponse: {
            name,
            response: { result: JSON.stringify(result).slice(0, 50_000) },
          },
        });
      } catch (err) {
        responseParts.push({
          functionResponse: {
            name,
            response: { error: (err as Error).message },
          },
        });
      }
    }

    // 이전 model turn + 새 tool 결과를 contents에 누적
    contents.push({ role: 'model', parts });
    contents.push({ role: 'user', parts: responseParts });
  }

  return { kind: 'text', text: '도구 호출 횟수 초과. 요청을 단순화해서 다시 시도해 주세요.' };
}
