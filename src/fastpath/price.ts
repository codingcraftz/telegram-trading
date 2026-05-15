// 현재가/시세 fast-path. KIS 응답을 10초 캐싱해 같은 종목 반복 조회 시 API rate limit 회피.

import { callKisApi } from '../mcp/kis.js';
import { firstOutput, fmtKrw, fmtNum, fmtPct, num, parseMcpResult } from './extract.js';
import { resolveSymbol } from './symbol.js';
import { cached } from './cache.js';

// 매칭 패턴: "[종목명/코드] (현재가|시세|주가|가격|얼마|...조회)"
const PRICE_RE =
  /^(?<sym>[A-Za-z가-힣0-9\s]+?)\s*(?:의|이|가)?\s*(?:현재가|시세|시세조회|주가|주가조회|가격|가격조회|얼마|얼만지)(?:\s*(?:조회|봐|봐줘|알려줘))?\??\s*$/;

export function tryMatchPrice(text: string): { sym: string } | null {
  const m = text.trim().match(PRICE_RE);
  if (!m?.groups?.sym) return null;
  return { sym: m.groups.sym.trim() };
}

// 현재가만 빠르게 추출 — 관심종목/차트/시세조회 inline 표시용. 캐시 공유.
export async function fetchQuickQuote(
  code: string,
): Promise<{ price: number; changePct: number; signLabel: string } | null> {
  try {
    const res = await fetchPriceRaw(code);
    const parsed = parseMcpResult(res);
    if (!parsed.success) return null;
    const d = firstOutput(parsed);
    if (!d) return null;
    const price = num(d.stck_prpr);
    if (!price || price <= 0) return null;
    const changePct = num(d.prdy_ctrt) ?? 0;
    const sign = String(d.prdy_vrss_sign ?? '3');
    const signLabel =
      sign === '1' || sign === '2' ? '▲' : sign === '4' || sign === '5' ? '▼' : '–';
    return { price, changePct, signLabel };
  } catch {
    return null;
  }
}

// inquire_price raw 응답을 2.5초 캐싱 — 1~3초 PWA 폴링과 잘 맞춤.
// 같은 종목에 동시 다발 호출이면 한 번만 KIS, 나머지는 캐시 hit.
async function fetchPriceRaw(code: string): Promise<unknown> {
  return cached(`inquire_price:${code}`, 2_500, () =>
    callKisApi('domestic_stock', 'inquire_price', {
      fid_cond_mrkt_div_code: 'J',
      fid_input_iscd: code,
    }),
  );
}

export async function handlePriceQuery(symbolInput: string): Promise<string> {
  const sym = await resolveSymbol(symbolInput);
  if (!sym) {
    return `❓ 종목을 찾지 못했습니다: "${symbolInput}"`;
  }

  const res = await fetchPriceRaw(sym.code);
  const parsed = parseMcpResult(res);
  if (!parsed.success) {
    return `❌ 시세 조회 실패: ${parsed.error ?? '알 수 없는 오류'}`;
  }
  const d = firstOutput(parsed);
  if (!d) {
    return `❌ 시세 데이터를 못 읽었습니다.`;
  }

  return formatPrice(sym, d);
}

function formatPrice(sym: { code: string; name: string }, d: Record<string, unknown>): string {
  const price = num(d.stck_prpr);
  const change = num(d.prdy_vrss);
  const changeSign = String(d.prdy_vrss_sign ?? ''); // 1상한,2상승,3보합,4하한,5하락
  const changePct = num(d.prdy_ctrt);
  const open = num(d.stck_oprc);
  const high = num(d.stck_hgpr);
  const low = num(d.stck_lwpr);
  const vol = num(d.acml_vol);
  const tr = num(d.acml_tr_pbmn); // 단위: 백만원
  const per = d.per;
  const pbr = d.pbr;
  const eps = d.eps;
  const bps = d.bps;
  const frgn = d.hts_frgn_ehrt;
  const w52h = num(d.w52_hgpr);
  const w52l = num(d.w52_lwpr);
  const industry = d.bstp_kor_isnm;
  const name = (d.hts_kor_isnm as string | undefined) ?? sym.name;

  const arrow =
    changeSign === '1' || changeSign === '2'
      ? '▲'
      : changeSign === '4' || changeSign === '5'
        ? '▼'
        : '–';
  const signedChange =
    change !== null
      ? `${changeSign === '4' || changeSign === '5' ? '-' : '+'}${Math.abs(change).toLocaleString()}원 (${arrow}${Math.abs(changePct ?? 0).toFixed(2)}%)`
      : '-';

  // 거래대금 단위: 원 → 억원
  const trBillion = tr !== null ? (tr / 100_000_000).toFixed(0) + '억원' : '-';

  const lines = [
    `<b>${name} (${sym.code})</b>${industry ? ` · ${industry}` : ''}`,
    `현재가: <b>${fmtKrw(price)}</b>`,
    `전일 대비: ${signedChange}`,
    ``,
    `시 ${fmtKrw(open)} / 고 ${fmtKrw(high)} / 저 ${fmtKrw(low)}`,
    `거래량 ${fmtNum(vol)}주 / 거래대금 ${trBillion}`,
  ];

  if (w52h && w52l) {
    lines.push(`52주 ${fmtKrw(w52l)} ~ ${fmtKrw(w52h)}`);
  }

  const fund: string[] = [];
  if (per) fund.push(`PER ${per}`);
  if (pbr) fund.push(`PBR ${pbr}`);
  if (eps) fund.push(`EPS ${fmtNum(eps)}`);
  if (bps) fund.push(`BPS ${fmtNum(bps)}`);
  if (fund.length) lines.push(fund.join(' / '));

  if (frgn) lines.push(`외인 보유 ${fmtPct(frgn)}`);

  return lines.join('\n');
}
