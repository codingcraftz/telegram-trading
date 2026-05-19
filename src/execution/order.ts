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
import { placeOrder, checkFill, cancelKrxOrder, type Market } from '../mcp/kis.js';
import { checkKisOk, parseMcpResult } from '../fastpath/extract.js';
import { fetchPendingOrders } from '../fastpath/pending.js';
import { getMarketSession } from '../scheduler/calendar.js';

type AnyRecord = Record<string, unknown>;

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

// KIS 재조회 — 폴링 끝난 후 실제 체결 상태 확정용.
// inquire_daily_ccld 응답에서 args.orderId와 일치하는 row 찾아 체결/잔여 반환.
async function recheckFillFromKis(orderId: string): Promise<
  | { filled: number; avg: number | null; remaining: number; orgno: string; ordDvsn: string }
  | null
> {
  try {
    const r = await fetchPendingOrders();
    if (!r.ok) return null;
    // 미체결 목록에 우리 orderId가 있으면 잔여 있음.
    const hit = r.items.find((it) => it.odno === orderId);
    if (hit) {
      return {
        filled: hit.filled,
        avg: null, // 부분체결 시 단가는 별도 API 필요. 0으로 두고 호출 측에서 다음 폴
        remaining: hit.remaining,
        orgno: hit.orgno,
        ordDvsn: hit.ordDvsn,
      };
    }
    // 미체결에 없음 → 전부 체결됐거나 취소됨. checkFill로 한 번 더 확인.
    return null;
  } catch (err) {
    console.warn('[recheckFillFromKis] error:', (err as Error).message);
    return null;
  }
}

export async function pollFill(args: {
  chatId: number;
  positionId: string;
  market: Market;
  orderId: string;
  expectedQty: number;
  tpPct?: number | null;
  slPct?: number | null;
  intervalMs?: number;
  timeoutMs?: number;
}): Promise<{ filled: number; avgPrice: number | null }> {
  const interval = args.intervalMs ?? 2000;

  // 장전 발주(08:30~09:00 KST) 시 폴링 윈도우를 09:00:30 KST까지 동적 연장.
  // 시초가 동시호가 큐에 적재된 주문은 09:00 개장 후에야 체결되므로 60s 기본은 부족.
  const baseTimeout = args.timeoutMs ?? 60_000;
  const session = getMarketSession();
  let timeout = baseTimeout;
  if (session === 'pre_extended' || session === 'pre_auction') {
    const now = Date.now();
    // KST 09:00:30 = UTC 00:00:30. ms 변환.
    const today = new Date(now + 9 * 3600 * 1000); // KST shift
    today.setUTCHours(9, 0, 30, 0);
    const targetKstMs = today.getTime() - 9 * 3600 * 1000; // UTC ms 환산
    const untilOpen = Math.max(baseTimeout, targetKstMs - now);
    timeout = untilOpen;
    console.log(`[pollFill] pre-session detected — extending timeout to ${Math.round(timeout / 1000)}s`);
  }

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
    // 정상 체결
    markPositionOpen(args.positionId, avg);
    logTrade({ chatId: args.chatId, positionId: args.positionId, kind: 'filled', payload: { filled, avg } });
    if (args.tpPct || args.slPct) {
      const tpPrice = args.tpPct ? Math.round(avg * (1 + args.tpPct / 100)) : null;
      const slPrice = args.slPct ? Math.round(avg * (1 - args.slPct / 100)) : null;
      setPositionTpSl(args.positionId, tpPrice, slPrice);
    }
    const parts: string[] = [`✅ 체결: ${avg.toLocaleString()}원 × ${filled}주`];
    if (args.tpPct) parts.push(`🎯 TP +${args.tpPct}% (${Math.round(avg * (1 + args.tpPct / 100)).toLocaleString()}원)`);
    if (args.slPct) parts.push(`🛑 SL -${args.slPct}% (${Math.round(avg * (1 - args.slPct / 100)).toLocaleString()}원)`);
    await notify(args.chatId, parts.join('\n'));
    return { filled, avgPrice: avg };
  }

  // 타임아웃 또는 체결 정보 부족 — KIS에 직접 재조회해서 안전 처리
  const recheck = await recheckFillFromKis(args.orderId);
  if (recheck) {
    // 잔여가 있음 — 아직 호가창에 살아있는 주문. **이중 매수 방지를 위해 자동 취소.**
    try {
      await cancelKrxOrder({
        orgno: recheck.orgno,
        odno: args.orderId,
        ordDvsn: recheck.ordDvsn,
      });
      logTrade({
        chatId: args.chatId,
        positionId: args.positionId,
        kind: 'order_auto_canceled',
        payload: { orderId: args.orderId, partialFilled: recheck.filled, remaining: recheck.remaining },
      });
      markPositionFailed(args.positionId);
      const lines = [
        `⚠️ 체결 안 됨 → 자동 취소 완료`,
        `주문번호 ${args.orderId}`,
      ];
      if (recheck.filled > 0) lines.push(`부분 체결 ${recheck.filled}주 발생 — 잔량 ${recheck.remaining}주 취소`);
      await notify(args.chatId, lines.join('\n'));
    } catch (err) {
      // 취소 실패 — 사용자가 직접 처리 필요. 가장 위험한 케이스.
      logTrade({
        chatId: args.chatId,
        positionId: args.positionId,
        kind: 'order_cancel_failed',
        payload: { orderId: args.orderId, error: (err as Error).message },
      });
      markPositionFailed(args.positionId);
      await notify(
        args.chatId,
        [
          `🚨 미체결 + 자동 취소 실패`,
          `주문번호 ${args.orderId}`,
          `KIS에 주문이 살아있을 수 있어요. 주문/대기 화면에서 직접 확인해주세요.`,
          `사유: ${(err as Error).message}`,
        ].join('\n'),
      );
    }
    return { filled: recheck.filled, avgPrice: null };
  }

  // 재조회 결과: 미체결 목록에도 없음 → 전부 체결됐거나 이미 취소됨/거절됨.
  // checkFill로 다시 한 번 확인.
  try {
    const res = await checkFill(args.market, args.orderId);
    const finalFilled = Number(extract(res, 'tot_ccld_qty', 'filled_qty', 'ccld_qty') ?? 0);
    const avgStr = extract(res, 'avg_prvs', 'avg_price', 'ccld_unpr');
    const finalAvg = avgStr ? Number(avgStr) : null;
    if (finalFilled > 0 && finalAvg) {
      // 폴링 중에 못 잡았는데 사실 체결됐음
      markPositionOpen(args.positionId, finalAvg);
      logTrade({ chatId: args.chatId, positionId: args.positionId, kind: 'filled_late', payload: { filled: finalFilled, avg: finalAvg } });
      if (args.tpPct || args.slPct) {
        const tpPrice = args.tpPct ? Math.round(finalAvg * (1 + args.tpPct / 100)) : null;
        const slPrice = args.slPct ? Math.round(finalAvg * (1 - args.slPct / 100)) : null;
        setPositionTpSl(args.positionId, tpPrice, slPrice);
      }
      await notify(
        args.chatId,
        `✅ 체결 확인 (지연): ${finalAvg.toLocaleString()}원 × ${finalFilled}주`,
      );
      return { filled: finalFilled, avgPrice: finalAvg };
    }
  } catch {}

  // 진짜 미체결 + 호가에도 없음 (이미 취소되었거나 KIS 거절)
  markPositionFailed(args.positionId);
  logTrade({ chatId: args.chatId, positionId: args.positionId, kind: 'fill_timeout', payload: { orderId: args.orderId } });
  await notify(
    args.chatId,
    `⚠️ 체결 없음. 주문번호 ${args.orderId}\nKIS 호가창에도 없어 자동 정리됐을 가능성이 높습니다.`,
  );
  return { filled: 0, avgPrice: null };
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
