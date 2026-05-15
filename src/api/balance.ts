// GET /api/balance — 잔고 + 보유종목 JSON.

import type { Context } from 'hono';
import { callKisApi } from '../mcp/kis.js';
import { cached } from '../fastpath/cache.js';
import {
  checkKisOk,
  num,
  outputDict,
  outputList,
  parseMcpResult,
} from '../fastpath/extract.js';
import { getMarketSession, sessionLabel } from '../scheduler/calendar.js';

export async function handleBalance(c: Context) {
  // 잔고 raw 응답 20초 캐싱 (텔레그램 봇과 같은 캐시 키)
  const res = await cached('balance:raw', 20_000, () =>
    callKisApi('domestic_stock', 'inquire_balance', {}),
  );
  const parsed = parseMcpResult(res);
  if (!parsed.success) {
    return c.json({ error: parsed.error ?? 'parse failed' }, 502);
  }
  const kisOk = checkKisOk(parsed);
  if (!kisOk.ok) {
    return c.json({ error: 'KIS', message: kisOk.message }, 502);
  }

  const summary = outputDict(parsed, 'output2');
  const holdings = outputList(parsed, 'output1');
  const session = getMarketSession();
  const sLabel = sessionLabel(session);

  return c.json({
    totalEvlu: num(summary?.tot_evlu_amt) ?? 0,
    cash: num(summary?.dnca_tot_amt) ?? 0,
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
