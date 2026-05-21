// 매매 API:
//   POST /api/trade/buy        — 매수 제안 등록 (시가매매 또는 즉시매수)
//   POST /api/trade/sell       — 매도 제안 등록
//   POST /api/trade/confirm/:id — 실제 발주 (KIS)
//   POST /api/trade/cancel/:id  — 취소
//   POST /api/trade/cancel-kis  — KIS 미체결 취소

import type { Context } from 'hono';
import {
  cancelReservation,
  confirmReservation,
  getReservation,
  loadPendingIntent,
  logTrade,
  markIntentConsumed,
  type OrderSpec,
} from '../db/repo.js';
import {
  buildBuyConfirmAndRegister,
  buildBuyNowConfirmAndRegister,
  buildSellConfirmAndRegister,
  type BuyAmountSpec,
} from '../fastpath/trade.js';
import { cancelKrxOrder, placeOrder, type Market } from '../mcp/kis.js';
import { placeBuyOrder, pollFill } from '../execution/order.js';
import { invalidate as invalidateCache } from '../fastpath/cache.js';
import { checkKisOk, parseMcpResult } from '../fastpath/extract.js';
import { fetchQuickQuote } from '../fastpath/price.js';
import { getDefaultChatId } from './_auth.js';

type BuyBody = {
  code?: string;
  strategy?: 'mo' | 'now';
  amount?: { mode: 'percent' | 'amount' | 'shares'; value: number };
  tp?: number | null; // 즉시매수만
  sl?: number | null;
  /** 지정가 — 있으면 시장가 대신 이 가격으로 매수 (즉시매수만) */
  limitPrice?: number | null;
  /** true면 intent 등록 + 즉시 발주를 한 번에 (1 round-trip) */
  execute?: boolean;
};

export async function handleTradeBuy(c: Context) {
  const chatId = getDefaultChatId();
  if (chatId <= 0) return c.json({ error: 'chat id 미설정 — 설정에서 ALLOWED_CHAT_IDS 입력' }, 400);
  let body: BuyBody = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }
  const code = (body.code ?? '').trim();
  const strategy = body.strategy ?? 'now';
  const amount = body.amount;
  if (!code || !/^\d{6}$/.test(code)) return c.json({ error: 'invalid code' }, 400);
  if (!amount || typeof amount.value !== 'number') {
    return c.json({ error: 'amount {mode, value} required' }, 400);
  }

  if (strategy === 'mo') {
    const r = await buildBuyConfirmAndRegister({
      chatId,
      code,
      strategy: 'mo',
      amount: amount as BuyAmountSpec,
    });
    if ('error' in r) return c.json({ error: r.error }, 400);

    // execute=true → 등록과 동시에 예약 확정 (사용자가 한 번 더 확인 누를 필요 없음)
    if (body.execute) {
      const result = await executeConfirm(chatId, r.reservationId);
      return c.json({
        kind: 'reservation',
        id: r.reservationId,
        text: r.text,
        executed: true,
        result,
      });
    }
    return c.json({ kind: 'reservation', id: r.reservationId, text: r.text });
  }

  // 즉시매수
  const tp = body.tp === null ? 'off' : body.tp !== undefined ? String(body.tp) : 'off';
  const sl = body.sl === null ? 'off' : body.sl !== undefined ? String(body.sl) : 'off';
  const r = await buildBuyNowConfirmAndRegister({
    chatId,
    code,
    tp,
    sl,
    amount: amount as BuyAmountSpec,
    limitPrice: typeof body.limitPrice === 'number' && body.limitPrice > 0 ? body.limitPrice : undefined,
  });
  if ('error' in r) return c.json({ error: r.error }, 400);

  // execute 옵션: intent 등록 + 즉시 발주 한 번에 (1 round-trip)
  if (body.execute) {
    const result = await executeConfirm(chatId, r.intentId);
    return c.json({
      kind: 'pending_intent',
      id: r.intentId,
      text: r.text,
      executed: true,
      result,
    });
  }
  return c.json({ kind: 'pending_intent', id: r.intentId, text: r.text });
}

type SellBody = {
  code?: string;
  qtyMode?: 'all' | 'half' | 'shares';
  qtyValue?: number;
  execute?: boolean;
};

export async function handleTradeSell(c: Context) {
  const chatId = getDefaultChatId();
  if (chatId <= 0) return c.json({ error: 'chat id 미설정' }, 400);
  let body: SellBody = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }
  const code = (body.code ?? '').trim();
  const qtyMode = body.qtyMode ?? 'all';
  if (!code || !/^\d{6}$/.test(code)) return c.json({ error: 'invalid code' }, 400);

  const r = await buildSellConfirmAndRegister({
    chatId,
    code,
    qtyMode,
    qtyValue: body.qtyValue,
  });
  if (!r.ok) return c.json({ error: r.text }, 400);
  if (body.execute) {
    const result = await executeConfirm(chatId, r.intentId);
    return c.json({
      kind: 'pending_intent',
      id: r.intentId,
      text: r.text,
      executed: true,
      result,
    });
  }
  return c.json({ kind: 'pending_intent', id: r.intentId, text: r.text });
}

// 발주 핵심 로직 — handlers.ts의 runConfirm을 API용으로 추출.
async function executeConfirm(
  chatId: number,
  id: string,
): Promise<{ ok: boolean; message: string; positionId?: string; orderId?: string; diagnostics?: unknown }> {
  // 시가매매 예약 우선
  const reservation = getReservation(id, chatId);
  if (reservation) {
    if (reservation.state === 'awaiting_confirm') {
      if (reservation.expiresAt < Date.now()) return { ok: false, message: '⌛ 만료된 예약' };
      const ok = confirmReservation(id);
      if (!ok) return { ok: false, message: '예약 확정 실패 (이미 처리됨)' };
      return {
        ok: true,
        message: `📅 시가매매 예약 확정 — ${reservation.symbolName}`,
      };
    }
    return { ok: false, message: `예약 상태: ${reservation.state} — 처리 불가` };
  }

  // 즉시 주문 제안 (pendingIntents)
  const intent = loadPendingIntent(id, chatId);
  if (!intent) return { ok: false, message: '해당 제안을 찾을 수 없음' };
  if (intent.consumedAt) return { ok: false, message: '이미 처리된 제안' };
  if (intent.expiresAt < Date.now()) return { ok: false, message: '⌛ 만료' };

  let spec: OrderSpec;
  try {
    spec = JSON.parse(intent.orderSpecJson);
  } catch {
    return { ok: false, message: '제안 파싱 실패' };
  }
  markIntentConsumed(id);

  if (spec.action === 'buy') {
    try {
      const { positionId, orderId } = await placeBuyOrder({ chatId, spec });
      pollFill({
        chatId,
        positionId,
        market: spec.market as Market,
        orderId,
        expectedQty: spec.quantity,
        tpPct: spec.tp_pct ?? null,
        slPct: spec.sl_pct ?? null,
      }).catch((err) => console.error('[pollFill]', err));
      invalidateCache('holdings');
      invalidateCache('balance:raw');
      invalidateCache('pending:raw');
      invalidateCache('filled:'); // 모든 days 키 무효화 (prefix)
      invalidateCache('psbl:'); // percent 매수 캐시도 무효화 — 연속 매수 stale 방지
      return {
        ok: true,
        message: `📨 매수 주문 접수 #${orderId}`,
        positionId,
        orderId,
      };
    } catch (err) {
      logTrade({ chatId, kind: 'order_error', payload: { error: (err as Error).message } });
      return { ok: false, message: `❌ 매수 실패: ${(err as Error).message}` };
    }
  }

  // sell — 시장가 거절 시 지정가(현재가) 자동 재시도
  try {
    let result = await placeOrder({
      market: spec.market as Market,
      side: 'sell',
      code: spec.symbol_code,
      quantity: spec.quantity,
      orderType: spec.order_type,
      price: spec.price,
    });
    let parsed = parseMcpResult(result);
    let kisOk = checkKisOk(parsed);
    let usedFallback = false;

    if (!kisOk.ok && spec.order_type === 'market') {
      try {
        const q = await fetchQuickQuote(spec.symbol_code);
        if (q?.price && q.price > 0) {
          result = await placeOrder({
            market: spec.market as Market,
            side: 'sell',
            code: spec.symbol_code,
            quantity: spec.quantity,
            orderType: 'limit',
            price: q.price,
          });
          parsed = parseMcpResult(result);
          kisOk = checkKisOk(parsed);
          if (kisOk.ok) usedFallback = true;
        }
      } catch (err) {
        console.warn('[trade.sell] fallback failed:', (err as Error).message);
      }
    }

    if (!kisOk.ok) {
      const raw = (parsed.raw ?? {}) as Record<string, unknown>;
      logTrade({ chatId, kind: 'sell_rejected', payload: { spec, raw } });
      return {
        ok: false,
        message: kisOk.message ?? '매도 거절',
        diagnostics: { rt_cd: raw.rt_cd, msg_cd: raw.msg_cd, msg1: raw.msg1, spec },
      };
    }

    const ext = (obj: unknown, key: string): string | undefined => {
      if (!obj || typeof obj !== 'object') return undefined;
      const o = obj as Record<string, unknown>;
      for (const k of Object.keys(o)) {
        if (k.toLowerCase() === key.toLowerCase() && typeof o[k] === 'string') {
          return o[k] as string;
        }
        const v = o[k];
        if (v && typeof v === 'object') {
          const r = ext(v, key);
          if (r) return r;
        }
      }
      return undefined;
    };
    const orderId = ext(result, 'odno') ?? `sell-${Date.now()}`;
    logTrade({ chatId, kind: 'sell_submitted', payload: { orderId, spec, usedFallback } });
    invalidateCache('holdings');
    invalidateCache('balance:raw');
    return {
      ok: true,
      message: `📤 매도 주문 접수 #${orderId}${usedFallback ? ' (시장가 거절 → 지정가 fallback 성공)' : ''}`,
      orderId,
    };
  } catch (err) {
    logTrade({ chatId, kind: 'order_error', payload: { error: (err as Error).message } });
    return { ok: false, message: `❌ 매도 실패: ${(err as Error).message}` };
  }
}

export async function handleTradeConfirm(c: Context) {
  const chatId = getDefaultChatId();
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'id required' }, 400);
  const r = await executeConfirm(chatId, id);
  return c.json(r, r.ok ? 200 : 400);
}

export function handleTradeCancel(c: Context) {
  const chatId = getDefaultChatId();
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'id required' }, 400);

  const reservation = getReservation(id, chatId);
  if (reservation) {
    if (reservation.state === 'awaiting_confirm' || reservation.state === 'pending') {
      const ok = cancelReservation(id);
      return c.json({ ok, message: ok ? '🗑️ 예약 취소' : '취소 실패' });
    }
    return c.json({ ok: false, message: `상태: ${reservation.state}` });
  }

  const intent = loadPendingIntent(id, chatId);
  if (!intent) return c.json({ ok: false, message: '제안 없음' }, 404);
  if (intent.consumedAt) return c.json({ ok: false, message: '이미 처리됨' });
  markIntentConsumed(id);
  return c.json({ ok: true, message: '🗑️ 제안 취소' });
}

// KIS 미체결 취소
export async function handleCancelKis(c: Context) {
  let body: { orgno?: string; odno?: string; ordDvsn?: string; qty?: number } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }
  const orgno = body.orgno ?? '';
  const odno = body.odno ?? '';
  if (!orgno || !odno) return c.json({ error: 'orgno, odno required' }, 400);
  try {
    const res = await cancelKrxOrder({
      orgno,
      odno,
      qty: body.qty,
      ordDvsn: body.ordDvsn,
    });
    const parsed = parseMcpResult(res);
    const kisOk = checkKisOk(parsed);
    return c.json({
      ok: kisOk.ok,
      message: kisOk.message,
    });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
}
