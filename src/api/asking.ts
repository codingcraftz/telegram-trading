// GET /api/asking?code=005930 — KIS 10단계 호가 + 잔량.

import type { Context } from 'hono';
import { callKisApi } from '../mcp/kis.js';
import { findOutput, num, parseMcpResult } from '../fastpath/extract.js';

export async function handleAsking(c: Context) {
  const code = c.req.query('code')?.trim() ?? '';
  if (!code || !/^\d{6}$/.test(code)) {
    return c.json({ error: 'invalid code' }, 400);
  }

  try {
    const res = await callKisApi('domestic_stock', 'inquire_asking_price_exp_ccn', {
      fid_cond_mrkt_div_code: 'J',
      fid_input_iscd: code,
    });
    const parsed = parseMcpResult(res);
    if (!parsed.success) return c.json({ error: parsed.error ?? 'KIS 오류' }, 502);

    const out = findOutput(parsed, 'output1');
    if (!out || typeof out !== 'object') return c.json({ error: '호가 데이터 없음' }, 502);
    const d = out as Record<string, unknown>;

    const asks: { price: number; qty: number }[] = [];
    const bids: { price: number; qty: number }[] = [];
    for (let i = 1; i <= 10; i++) {
      const ap = num(d[`askp${i}`]) ?? 0;
      const aq = num(d[`askp_rsqn${i}`]) ?? 0;
      if (ap > 0) asks.push({ price: ap, qty: aq });
      const bp = num(d[`bidp${i}`]) ?? 0;
      const bq = num(d[`bidp_rsqn${i}`]) ?? 0;
      if (bp > 0) bids.push({ price: bp, qty: bq });
    }
    const totalAskQty = num(d.total_askp_rsqn) ?? asks.reduce((s, x) => s + x.qty, 0);
    const totalBidQty = num(d.total_bidp_rsqn) ?? bids.reduce((s, x) => s + x.qty, 0);

    return c.json({
      code,
      asks,   // 매도호가 1단계(현재가에 가장 가까운) ~ 10단계(가장 먼)
      bids,   // 매수호가 1단계 ~ 10단계
      totalAskQty,
      totalBidQty,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502);
  }
}
