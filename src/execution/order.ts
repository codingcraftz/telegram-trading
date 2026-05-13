import {
  insertPosition,
  logTrade,
  markPositionFailed,
  markPositionOpen,
  newId,
  type OrderSpec,
} from '../db/repo.js';
import { notify } from '../notify/telegram.js';
import { placeOrder, checkFill, type Market } from '../mcp/kis.js';

type AnyRecord = Record<string, unknown>;

function extract(obj: unknown, ...candidates: string[]): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of candidates) {
    const v = (obj as AnyRecord)[key];
    if (typeof v === 'string' && v.trim() !== '') return v;
    if (typeof v === 'number') return String(v);
  }
  for (const k of Object.keys(obj as AnyRecord)) {
    const v = (obj as AnyRecord)[k];
    if (v && typeof v === 'object') {
      const found = extract(v, ...candidates);
      if (found) return found;
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

  const orderId =
    extract(result, 'odno', 'ord_no', 'order_id', 'orderId', 'KRX_FWDG_ORD_ORGNO') ??
    `unknown-${Date.now()}`;

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
    await notify(args.chatId, `✅ 체결: ${avg.toLocaleString()}원 × ${filled}주`);
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
