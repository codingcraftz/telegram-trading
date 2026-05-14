// 호가 조회 fast-path.

import { callKisApi } from '../mcp/kis.js';
import { firstOutput, fmtKrw, num, parseMcpResult } from './extract.js';
import { resolveSymbol } from './symbol.js';

const ASKING_RE =
  /^(?<sym>[A-Za-z가-힣0-9\s]+?)\s*(?:의|이|가)?\s*호가\??\s*$/;

export function tryMatchAsking(text: string): { sym: string } | null {
  const m = text.trim().match(ASKING_RE);
  if (!m?.groups?.sym) return null;
  return { sym: m.groups.sym.trim() };
}

export async function handleAskingQuery(symbolInput: string): Promise<string> {
  const sym = await resolveSymbol(symbolInput);
  if (!sym) return `❓ 종목을 찾지 못했습니다: "${symbolInput}"`;

  const res = await callKisApi('domestic_stock', 'inquire_asking_price_exp_ccn', {
    fid_cond_mrkt_div_code: 'J',
    fid_input_iscd: sym.code,
  });
  const parsed = parseMcpResult(res);
  if (!parsed.success) return `❌ 호가 조회 실패: ${parsed.error ?? '알 수 없는 오류'}`;

  const d = firstOutput(parsed);
  if (!d) return `❌ 호가 데이터를 못 읽었습니다.`;

  // 매도/매수 호가 1~10단계
  const lines: string[] = [`📊 <b>${sym.name} (${sym.code}) 10단계 호가</b>`];
  for (let i = 10; i >= 1; i--) {
    const askP = num(d[`askp${i}`]);
    const askR = num(d[`askp_rsqn${i}`]); // 매도잔량
    if (askP) lines.push(`매도 ${i.toString().padStart(2)}: ${fmtKrw(askP)} (잔 ${askR ?? 0})`);
  }
  lines.push('');
  for (let i = 1; i <= 10; i++) {
    const bidP = num(d[`bidp${i}`]);
    const bidR = num(d[`bidp_rsqn${i}`]);
    if (bidP) lines.push(`매수 ${i.toString().padStart(2)}: ${fmtKrw(bidP)} (잔 ${bidR ?? 0})`);
  }
  return lines.join('\n');
}
