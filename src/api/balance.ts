// GET /api/balance — 잔고 + 보유종목 JSON.

import type { Context } from 'hono';
import { callKisApi } from '../mcp/kis.js';
import { cached, invalidate } from '../fastpath/cache.js';
import {
  checkKisOk,
  num,
  outputDict,
  outputList,
  parseMcpResult,
} from '../fastpath/extract.js';
import { getMarketSession, sessionLabel } from '../scheduler/calendar.js';
import { fetchPendingOrders } from '../fastpath/pending.js';
import { listChatPendingIntents } from '../db/repo.js';
import { getDb } from '../db/client.js';
import { strategyApplications } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { getDefaultChatId } from './_auth.js';

export async function handleBalance(c: Context) {
  // 잔고 raw 응답 60초 캐싱 — warmup worker가 30s마다 갱신해 항상 fresh 유지.
  const res = await cached('balance:raw', 60_000, () =>
    callKisApi('domestic_stock', 'inquire_balance', {}),
  );
  const parsed = parseMcpResult(res);
  if (!parsed.success) {
    invalidate('balance:raw');
    return c.json({ error: parsed.error ?? 'parse failed' }, 502);
  }
  const kisOk = checkKisOk(parsed);
  if (!kisOk.ok) {
    invalidate('balance:raw');
    return c.json({ error: 'KIS', message: kisOk.message }, 502);
  }

  const summary = outputDict(parsed, 'output2');
  const holdings = outputList(parsed, 'output1');
  const session = getMarketSession();
  const sLabel = sessionLabel(session);

  // 매수가능 추정치 — 종목 무관. 종목별 정확치는 /api/orderable 사용.
  // prvs_rcdl_excc_amt(가수도정산금액 = 당일 정산 가능 현금)가 가장 보수적·정확.
  // 없으면 dnca_tot_amt(예수금 총액) fallback — D+1/D+2 미정산분도 포함되므로 부풀려질 수 있음.
  const cashOrderable =
    num(summary?.prvs_rcdl_excc_amt) ??
    num(summary?.dnca_tot_amt) ??
    0;

  // KIS 가 ord_psbl_cash 에 대기 중 매수 주문 금액을 즉시 반영하지 않는 경우가
  // 있어서, 백엔드에서 직접 차감해야 사용자가 보는 "거래가능금액" 이 진짜
  // 사용 가능한 금액과 일치. 차감 대상:
  //   1) KIS 미체결 매수 주문 (price × remaining)
  //   2) pendingIntents (사용자 확인 대기 매수)
  //   3) morning_staged 의 status='active' && phase='pending' 인 application
  //      → 다음 09:00 에 발사될 예약. budgetAmount 만큼 사전 차감.
  const chatId = getDefaultChatId();
  let pendingBuyAmount = 0;
  try {
    const kis = await fetchPendingOrders();
    if (kis.ok) {
      for (const it of kis.items) {
        const isBuy = String(it.side).includes('매수') || String(it.side) === '02';
        if (isBuy) pendingBuyAmount += it.price * it.remaining;
      }
    }
  } catch { /* ignore */ }
  try {
    for (const i of listChatPendingIntents(chatId)) {
      try {
        const spec = JSON.parse(i.orderSpecJson) as { action?: string; price?: number; quantity?: number };
        if (spec.action === 'buy') {
          pendingBuyAmount += (spec.price ?? 0) * (spec.quantity ?? 0);
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  try {
    const apps = getDb()
      .select({
        runtimeJson: strategyApplications.runtimeJson,
        budgetAmount: strategyApplications.budgetAmount,
      })
      .from(strategyApplications)
      .where(
        and(
          eq(strategyApplications.chatId, chatId),
          eq(strategyApplications.status, 'active'),
        ),
      )
      .all();
    for (const a of apps) {
      let phase = 'pending';
      try { phase = JSON.parse(a.runtimeJson ?? '{}').phase ?? 'pending'; } catch { /* keep pending */ }
      if (phase === 'pending' && a.budgetAmount && a.budgetAmount > 0) {
        pendingBuyAmount += a.budgetAmount;
      }
    }
  } catch { /* ignore */ }

  const adjustedCash = Math.max(0, cashOrderable - pendingBuyAmount);

  return c.json({
    totalEvlu: num(summary?.tot_evlu_amt) ?? 0,
    cash: adjustedCash,
    cashRaw: cashOrderable,
    cashReservedForPending: pendingBuyAmount,
    totalPfls: num(summary?.evlu_pfls_smtl_amt) ?? 0,
    totalPflsRt: num(summary?.asst_icdc_erng_rt) ?? 0,
    nextDaySettlement: num(summary?.nxdy_excc_amt) ?? 0,
    session: { session, label: sLabel.label, icon: sLabel.icon },
    holdings: holdings.map((h) => ({
      code: String(h.pdno ?? ''),
      name: String(h.prdt_name ?? h.pdno ?? ''),
      qty: num(h.hldg_qty) ?? 0,
      orderable: num(h.ord_psbl_qty) ?? 0,
      avg: num(h.pchs_avg_pric) ?? 0,
      cur: num(h.prpr) ?? 0,
      pflsAmt: num(h.evlu_pfls_amt) ?? 0,
      pflsRt: num(h.evlu_pfls_rt) ?? 0,
    })),
  });
}
