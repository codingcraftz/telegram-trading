// GET /api/orderable?code=X&price=Y — 종목+가격 기준 정확한 매수가능금액.
// KIS inquire_psbl_order → ord_psbl_cash. 15초 캐시.

import type { Context } from 'hono';
import { callKisApi } from '../mcp/kis.js';
import { cached } from '../fastpath/cache.js';
import { firstOutput, num, parseMcpResult } from '../fastpath/extract.js';

export async function handleOrderable(c: Context) {
  const code = c.req.query('code')?.trim();
  const priceRaw = c.req.query('price');
  if (!code || !/^\d{6}$/.test(code)) {
    return c.json({ error: 'invalid code', cash: null }, 400);
  }
  const price = priceRaw ? Number(priceRaw) : 0;
  if (!Number.isFinite(price) || price <= 0) {
    return c.json({ error: 'invalid price', cash: null }, 400);
  }

  // 100원 단위로 묶어 캐시 키 안정화 (호가 변동에 매번 KIS 호출 회피)
  const bucket = Math.round(price / 100) * 100;
  const key = `orderable:${code}:${bucket}`;

  try {
    const result = await cached(key, 15_000, async () => {
      const r = await callKisApi('domestic_stock', 'inquire_psbl_order', {
        pdno: code,
        ord_unpr: String(Math.round(price)),
        ord_dvsn: '00', // 지정가 기준
      });
      const parsed = parseMcpResult(r);
      if (!parsed.success) return { cash: null as number | null, qty: null as number | null };
      const o = firstOutput(parsed);
      if (!o) return { cash: null, qty: null };
      const cash = num(o.ord_psbl_cash);
      const qty = num(o.max_buy_qty) ?? num(o.ord_psbl_qty);
      return {
        cash: cash && cash > 0 ? cash : null,
        qty: qty && qty > 0 ? qty : null,
      };
    });

    if (result.cash === null) {
      return c.json({ error: 'unavailable', cash: null, qty: result.qty });
    }
    return c.json({ cash: result.cash, qty: result.qty });
  } catch (err) {
    return c.json({ error: (err as Error).message, cash: null }, 502);
  }
}
