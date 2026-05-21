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
import { getDefaultChatId } from './_auth.js';
import { fetchPendingBuyAmount } from '../fastpath/pending_cash.js';

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

  // 진짜 사용 가능한 cash = KIS cash - (KIS 미체결 매수 + pendingIntents
  //                                + morning_staged 의 pending budget + stage1_filled 의 stage2 예약)
  const chatId = getDefaultChatId();
  const pendingBuyAmount = await fetchPendingBuyAmount(chatId);
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
