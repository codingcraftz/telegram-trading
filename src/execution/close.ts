import {
  addDailyPnl,
  getPosition,
  logTrade,
  markPositionClosed,
  markPositionClosing,
  setCooldown,
} from '../db/repo.js';
import { notify } from '../notify/telegram.js';
import { getConfig } from '../config.js';
import { placeOrder, checkFill, type Market } from '../mcp/kis.js';

function maybeParseJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return v;
  try {
    return JSON.parse(t);
  } catch {
    return v;
  }
}

function extract(obj: unknown, ...candidates: string[]): string | undefined {
  if (!obj) return undefined;
  obj = maybeParseJson(obj);
  if (typeof obj !== 'object') return undefined;
  const lc = candidates.map((c) => c.toLowerCase());
  if (Array.isArray(obj)) {
    for (const it of obj) {
      const r = extract(it, ...candidates);
      if (r) return r;
    }
    return undefined;
  }
  const o = obj as Record<string, unknown>;
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

export async function closePosition(args: {
  positionId: string;
  reason: 'tp' | 'sl' | 'manual';
}): Promise<void> {
  const pos = getPosition(args.positionId);
  if (!pos) {
    console.warn('[close] position not found', args.positionId);
    return;
  }
  if (pos.state !== 'open' && pos.state !== 'closing') {
    console.warn('[close] position not in closeable state', pos.state);
    return;
  }

  const market = (pos.market || 'KRX') as Market;

  let exitOrderId = '';
  try {
    // 국내는 시장가 가능. 해외는 보통 지정가만 받으니 마지막 체결가 근처로 보내야 하나 v1은 시도.
    const res = await placeOrder({
      market,
      side: 'sell',
      code: pos.symbolCode,
      quantity: pos.quantity,
      orderType: market === 'KRX' ? 'market' : 'limit',
      price: pos.avgPrice ?? undefined,
    });
    exitOrderId =
      extract(res, 'ODNO', 'odno', 'ord_no', 'order_id', 'orderId') ??
      `exit-${Date.now()}`;
  } catch (err) {
    logTrade({
      chatId: pos.chatId,
      positionId: pos.id,
      kind: 'close_error',
      payload: { error: (err as Error).message },
    });
    await notify(pos.chatId, `❌ 청산 실패: ${(err as Error).message}`);
    return;
  }

  markPositionClosing(pos.id, exitOrderId);
  logTrade({
    chatId: pos.chatId,
    positionId: pos.id,
    kind: args.reason === 'tp' ? 'tp_fire' : args.reason === 'sl' ? 'sl_fire' : 'manual_close',
    payload: { exitOrderId },
  });

  await pollClose({
    chatId: pos.chatId,
    positionId: pos.id,
    market,
    orderId: exitOrderId,
    qty: pos.quantity,
    entryAvg: pos.avgPrice ?? 0,
    reason: args.reason,
  });
}

async function pollClose(args: {
  chatId: number;
  positionId: string;
  market: Market;
  orderId: string;
  qty: number;
  entryAvg: number;
  reason: 'tp' | 'sl' | 'manual';
}) {
  const cfg = getConfig();
  const interval = 2000;
  const timeout = 60_000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, interval));
    try {
      const res = await checkFill(args.market, args.orderId);
      const filled = Number(extract(res, 'tot_ccld_qty', 'filled_qty', 'ccld_qty') ?? 0);
      const avgStr = extract(res, 'avg_prvs', 'avg_price', 'ccld_unpr');
      const avg = avgStr ? Number(avgStr) : 0;
      if (filled >= args.qty && avg > 0) {
        const pnl = (avg - args.entryAvg) * args.qty;
        markPositionClosed(args.positionId, pnl);
        addDailyPnl(pnl);
        const pos = getPosition(args.positionId);
        if (pos) setCooldown(pos.symbolCode, Date.now() + cfg.COOLDOWN_SEC * 1000);
        logTrade({
          chatId: args.chatId,
          positionId: args.positionId,
          kind: 'closed',
          payload: { filled, avg, pnl, reason: args.reason },
        });
        const tag = args.reason === 'tp' ? '🎯 TP' : args.reason === 'sl' ? '🛑 SL' : '✋ 수동';
        await notify(
          args.chatId,
          `${tag} 청산: ${avg.toLocaleString()} × ${filled}, 실현 ${pnl >= 0 ? '+' : ''}${Math.round(pnl).toLocaleString()}`,
        );
        return;
      }
    } catch (err) {
      console.warn('[pollClose] error', (err as Error).message);
    }
  }
  await notify(args.chatId, `⚠️ 청산 주문 체결 확인 타임아웃: ${args.orderId}`);
}
