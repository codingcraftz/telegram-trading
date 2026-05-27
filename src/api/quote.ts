// GET /api/quote?code=005930 — 종목 시세 JSON.

import type { Context } from 'hono';
import { callKisApi } from '../mcp/kis.js';
import { cached } from '../fastpath/cache.js';
import { checkKisOk, firstOutput, num, parseMcpResult } from '../fastpath/extract.js';
import { fetchQuickQuote } from '../fastpath/price.js';
import { resolveSymbol, searchSymbolCandidates } from '../fastpath/symbol.js';

export async function handleQuote(c: Context) {
  const code = c.req.query('code')?.trim() ?? '';
  if (!code || !/^\d{6}$/.test(code)) {
    return c.json({ error: 'invalid code (6 digit required)' }, 400);
  }

  const sym = await resolveSymbol(code);
  const res = await cached(`inquire_price:${code}`, 10_000, () =>
    callKisApi('domestic_stock', 'inquire_price', {
      fid_cond_mrkt_div_code: 'J',
      fid_input_iscd: code,
    }),
  );
  const parsed = parseMcpResult(res);
  if (!parsed.success) return c.json({ error: parsed.error ?? 'parse failed' }, 502);
  const kisOk = checkKisOk(parsed);
  if (!kisOk.ok) return c.json({ error: 'KIS', message: kisOk.message }, 502);
  const d = firstOutput(parsed);
  if (!d) return c.json({ error: 'no output' }, 502);

  const sign = String(d.prdy_vrss_sign ?? '3');
  const signLabel =
    sign === '1' || sign === '2' ? '▲' : sign === '4' || sign === '5' ? '▼' : '–';
  // KIS prdy_vrss/prdy_ctrt 는 음수로 올 수도 있음 — 절대값 후 sign 기준 부호 적용.
  const absChange = Math.abs(num(d.prdy_vrss) ?? 0);
  const change = sign === '4' || sign === '5' ? -absChange : absChange;
  const absRate = Math.abs(num(d.prdy_ctrt) ?? 0);
  const changeRate = sign === '4' || sign === '5' ? -absRate : absRate;

  return c.json({
    code,
    name: sym?.name ?? String(d.hts_kor_isnm ?? code),
    industry: String(d.bstp_kor_isnm ?? ''),
    price: num(d.stck_prpr) ?? 0,
    open: num(d.stck_oprc) ?? 0,
    high: num(d.stck_hgpr) ?? 0,
    low: num(d.stck_lwpr) ?? 0,
    change,
    changeRate,
    signLabel,
    volume: num(d.acml_vol) ?? 0,
    tradeAmount: num(d.acml_tr_pbmn) ?? 0,
    week52High: num(d.w52_hgpr) ?? 0,
    week52Low: num(d.w52_lwpr) ?? 0,
    per: d.per ?? null,
    pbr: d.pbr ?? null,
    eps: d.eps ?? null,
    bps: d.bps ?? null,
    foreignerRatio: num(d.hts_frgn_ehrt) ?? 0,
  });
}

// GET /api/quotes?codes=A,B,C — N종목 시세 한 번에 (병렬 호출 + 봇 캐시 활용)
export async function handleQuotes(c: Context) {
  const raw = c.req.query('codes')?.trim() ?? '';
  if (!raw) return c.json({ items: [] });
  const codes = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{6}$/.test(s))
    .slice(0, 30); // 안전 한계
  const sym = await Promise.all(codes.map((code) => resolveSymbol(code)));
  const quotes = await Promise.all(
    codes.map(async (code) => {
      try {
        const q = await fetchQuickQuote(code);
        return q ? { code, ...q } : null;
      } catch {
        return null;
      }
    }),
  );
  return c.json({
    items: codes.map((code, i) => {
      const q = quotes[i];
      const s = sym[i];
      return {
        code,
        name: s?.name ?? code,
        ok: !!q,
        price: q?.price ?? 0,
        changePct: q?.changePct ?? 0,
        signLabel: q?.signLabel ?? '–',
      };
    }),
  });
}

// GET /api/search?q=삼성 — 종목명/코드 자동완성
export function handleSearch(c: Context) {
  const q = c.req.query('q')?.trim() ?? '';
  if (!q) return c.json({ items: [] });
  const candidates = searchSymbolCandidates(q, 10);
  return c.json({
    items: candidates.map((s) => ({ code: s.code, name: s.name })),
  });
}
