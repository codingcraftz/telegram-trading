import {
  insertPosition,
  logTrade,
  markPositionFailed,
  markPositionOpen,
  newId,
  setPositionTpSl,
  type OrderSpec,
} from '../db/repo.js';
import { notify } from '../notify/telegram.js';
import { placeOrder, checkFill, type Market } from '../mcp/kis.js';
import { checkKisOk, parseMcpResult } from '../fastpath/extract.js';

type AnyRecord = Record<string, unknown>;

// 문자열이 JSON처럼 보이면 자동 파싱 (KIS MCP 응답이 data 필드를 JSON 문자열로 감싸는 패턴 대응)
function maybeParseJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const trimmed = v.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return v;
  try {
    return JSON.parse(trimmed);
  } catch {
    return v;
  }
}

// 케이스 무시 + 중첩 객체 + JSON 문자열 자동 unwrap.
function extract(obj: unknown, ...candidates: string[]): string | undefined {
  if (!obj) return undefined;
  obj = maybeParseJson(obj);
  if (typeof obj !== 'object') return undefined;
  const lc = candidates.map((c) => c.toLowerCase());
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = extract(item, ...candidates);
      if (r) return r;
    }
    return undefined;
  }
  const o = obj as AnyRecord;
  for (const k of Object.keys(o)) {
    if (lc.includes(k.toLowerCase())) {
      const v = o[k];
      if (typeof v === 'string' && v.trim() !== '') return v;
      if (typeof v === 'number') return String(v);
    }
  }
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v && typeof v === 'object') {
      const r = extract(v, ...candidates);
      if (r) return r;
    } else if (typeof v === 'string') {
      const parsed = maybeParseJson(v);
      if (parsed && typeof parsed === 'object') {
        const r = extract(parsed, ...candidates);
        if (r) return r;
      }
    }
  }
  return undefined;
}

export async function placeBuyOrder(args: {
  chatId: number;
  spec: OrderSpec;
}): Promise<{ positionId: string; orderId: string }> {
  const { spec } = args;
  const positionId = newId();

  const result = await placeOrder({
    market: spec.market as Market,
    side: spec.action,
    code: spec.symbol_code,
    quantity: spec.quantity,
    orderType: spec.order_type,
    price: spec.price,
  });

  // KIS rt_cd 체크 — 거절이면 throw (호출 측 catch에서 사용자에게 메시지)
  const parsed = parseMcpResult(result);
  const kisOk = checkKisOk(parsed);
  if (!kisOk.ok) {
    throw new Error(`KIS 거절: ${kisOk.message ?? '알 수 없는 오류'}`);
  }

  const orderId =
    extract(result, 'ODNO', 'odno', 'ord_no', 'order_id', 'orderId') ??
    `unknown-${Date.now()}`;
  console.log('[order] result orderId=', orderId);

  let tpPrice: number | undefined;
  let slPrice: number | undefined;
  if (spec.action === 'buy' && spec.order_type === 'limit' && spec.price) {
    if (spec.tp_pct) tpPrice = Math.round(spec.price * (1 + spec.tp_pct / 100));
    if (spec.sl_pct) slPrice = Math.round(spec.price * (1 - spec.sl_pct / 100));
  }

  insertPosition({
    id: positionId,
    chatId: args.chatId,
    market: spec.market,
    symbolCode: spec.symbol_code,
    symbolName: spec.symbol_name,
    side: 'buy',
    entryOrderId: orderId,
    quantity: spec.quantity,
    tpPrice: tpPrice ?? null,
    slPrice: slPrice ?? null,
    state: 'pending',
    avgPrice: spec.order_type === 'limit' ? spec.price ?? null : null,
  });
  logTrade({
    chatId: args.chatId,
    positionId,
    kind: 'submitted',
    payload: { orderId, spec, mcpResult: result },
  });

  return { positionId, orderId };
}

export async function pollFill(args: {
  chatId: number;
  positionId: string;
  market: Market;
  orderId: string;
  expectedQty: number;
  // 시장가 체결가 기준 TP/SL 자동 계산 (전략없이 즉시매수 흐름에서 사용)
  tpPct?: number | null;
  slPct?: number | null;
  intervalMs?: number;
  timeoutMs?: number;
}): Promise<{ filled: number; avgPrice: number | null }> {
  const interval = args.intervalMs ?? 2000;
  const timeout = args.timeoutMs ?? 60_000;
  const start = Date.now();
  let filled = 0;
  let avg: number | null = null;

  while (Date.now() - start < timeout) {
    await sleep(interval);
    try {
      const res = await checkFill(args.market, args.orderId);
      filled = Number(extract(res, 'tot_ccld_qty', 'filled_qty', 'ccld_qty') ?? 0);
      const avgStr = extract(res, 'avg_prvs', 'avg_price', 'ccld_unpr');
      avg = avgStr ? Number(avgStr) : null;
      if (filled >= args.expectedQty) break;
    } catch (err) {
      console.warn('[pollFill] error:', (err as Error).message);
    }
  }

  if (filled > 0 && avg) {
    markPositionOpen(args.positionId, avg);
    logTrade({
      chatId: args.chatId,
      positionId: args.positionId,
      kind: 'filled',
      payload: { filled, avg },
    });
    // 시장가 체결가 기준 TP/SL 자동 설정 — 모니터(30초 폴링)가 트리거함
    if (args.tpPct || args.slPct) {
      const tpPrice = args.tpPct ? Math.round(avg * (1 + args.tpPct / 100)) : null;
      const slPrice = args.slPct ? Math.round(avg * (1 - args.slPct / 100)) : null;
      setPositionTpSl(args.positionId, tpPrice, slPrice);
    }
    const parts: string[] = [`✅ 체결: ${avg.toLocaleString()}원 × ${filled}주`];
    if (args.tpPct) parts.push(`🎯 TP +${args.tpPct}% (${Math.round(avg * (1 + args.tpPct / 100)).toLocaleString()}원)`);
    if (args.slPct) parts.push(`🛑 SL -${args.slPct}% (${Math.round(avg * (1 - args.slPct / 100)).toLocaleString()}원)`);
    await notify(args.chatId, parts.join('\n'));
  } else if (filled === 0) {
    markPositionFailed(args.positionId);
    logTrade({
      chatId: args.chatId,
      positionId: args.positionId,
      kind: 'fill_timeout',
      payload: { orderId: args.orderId },
    });
    await notify(args.chatId, `⚠️ 미체결 (타임아웃). 주문번호 ${args.orderId}`);
  }

  return { filled, avgPrice: avg };
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
