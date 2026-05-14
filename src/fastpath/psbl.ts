// 예수금 / 매수가능금액 fast-path.
// KIS의 inquire_psbl_order는 종목코드 필수라 단순 예수금 조회엔 부적합.
// 대신 inquire_balance의 output2(계좌 요약)에서 dnca_tot_amt(예수금) 추출.

import { callKisApi } from '../mcp/kis.js';
import { fmtKrw, num, outputDict, parseMcpResult } from './extract.js';

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

export function tryMatchPsbl(text: string): boolean {
  const raw = text.trim();
  if (raw.length > 25) return false;
  const t = normalize(raw);
  return (
    t === '예수금' ||
    t === '가용현금' ||
    t === '매수가능' ||
    t === '매수가능금액' ||
    t === '시드' ||
    t === '내시드' ||
    t === '현금' ||
    t === '주문가능금액'
  );
}

export async function handlePsbl(): Promise<string> {
  const res = await callKisApi('domestic_stock', 'inquire_balance', {});
  const parsed = parseMcpResult(res);
  if (!parsed.success) return `❌ 조회 실패: ${parsed.error ?? '알 수 없는 오류'}`;
  const s = outputDict(parsed, 'output2');
  if (!s) return '❌ 데이터를 못 읽었습니다.';

  const dnca = num(s.dnca_tot_amt); // 예수금 총금액
  const tot = num(s.tot_evlu_amt); // 총평가금액
  const d2 = num(s.nxdy_excc_amt); // D+2 (익일 정산)

  const lines = ['💵 <b>예수금 / 가용 자금</b>'];
  if (dnca !== null) lines.push(`예수금: <b>${fmtKrw(dnca)}</b>`);
  if (d2 !== null) lines.push(`D+2 결제: ${fmtKrw(d2)}`);
  if (tot !== null) lines.push(`총 평가: ${fmtKrw(tot)}`);
  return lines.join('\n');
}
