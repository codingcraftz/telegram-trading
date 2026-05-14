// 잔고/보유 종목 fast-path. LLM 호출 없이 MCP만으로 응답.

import { callKisApi } from '../mcp/kis.js';
import { fmtKrw, fmtNum, num, outputDict, outputList, parseMcpResult } from './extract.js';

// STT 공백 변형 대응을 위해 normalize 후 키워드 매칭
function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

export function tryMatchBalance(text: string): boolean {
  const raw = text.trim();
  if (raw.length > 30) return false;
  const t = normalize(raw);
  return (
    t === '잔고' ||
    t === '내잔고' ||
    t === '보유종목' ||
    t === '보유주식' ||
    t === '내종목' ||
    t === '내주식' ||
    t === '내가가진종목' ||
    t === '내가가진거' ||
    t === '가지고있는거' ||
    t === '가지고있는종목' ||
    t === '보유현황' ||
    t === '내보유종목'
  );
}

export async function handleBalance(): Promise<string> {
  const res = await callKisApi('domestic_stock', 'inquire_balance', {});
  const parsed = parseMcpResult(res);
  if (!parsed.success) {
    return `❌ 잔고 조회 실패: ${parsed.error ?? '알 수 없는 오류'}`;
  }

  const holdings = outputList(parsed, 'output1');
  const summary = outputDict(parsed, 'output2');

  const lines: string[] = [];

  if (summary) {
    const totEvlu = num(summary.tot_evlu_amt); // 총평가
    const dnca = num(summary.dnca_tot_amt); // 예수금
    const pchsSmt = num(summary.pchs_amt_smtl_amt); // 매입금액합계
    const evluSmt = num(summary.evlu_amt_smtl_amt); // 평가금액합계
    const pflsSmt = num(summary.evlu_pfls_smtl_amt); // 평가손익
    const pflsRt = num(summary.asst_icdc_erng_rt); // 자산증감수익률
    const d2 = num(summary.nxdy_excc_amt); // 익일정산금액

    lines.push(`💰 <b>계좌 요약</b>`);
    if (dnca !== null) lines.push(`예수금: ${fmtKrw(dnca)}`);
    if (totEvlu !== null) lines.push(`총 평가: ${fmtKrw(totEvlu)}`);
    if (evluSmt !== null && pchsSmt !== null) {
      lines.push(`주식 평가: ${fmtKrw(evluSmt)} (매입 ${fmtKrw(pchsSmt)})`);
    }
    if (pflsSmt !== null) {
      const sign = pflsSmt >= 0 ? '+' : '';
      const rtTxt = pflsRt !== null ? ` (${sign}${pflsRt.toFixed(2)}%)` : '';
      lines.push(`평가손익: <b>${sign}${Math.round(pflsSmt).toLocaleString()}원</b>${rtTxt}`);
    }
    if (d2 !== null) lines.push(`익일정산: ${fmtKrw(d2)}`);
    lines.push('');
  }

  if (holdings.length === 0) {
    lines.push('보유 종목 없음');
  } else {
    lines.push(`📈 <b>보유 종목 ${holdings.length}개</b>`);
    for (const h of holdings) {
      const code = String(h.pdno ?? '');
      const name = String(h.prdt_name ?? code);
      const qty = num(h.hldg_qty) ?? 0;
      const avg = num(h.pchs_avg_pric) ?? 0;
      const cur = num(h.prpr) ?? 0;
      const pfls = num(h.evlu_pfls_amt) ?? 0;
      const pflsRt = num(h.evlu_pfls_rt) ?? 0;
      const sign = pfls >= 0 ? '+' : '';
      lines.push(
        `• <b>${name}</b> (${code}) ${fmtNum(qty)}주\n` +
          `   매입 ${fmtKrw(avg)} → 현재 ${fmtKrw(cur)}\n` +
          `   손익 ${sign}${Math.round(pfls).toLocaleString()}원 (${sign}${pflsRt.toFixed(2)}%)`,
      );
    }
  }

  return lines.join('\n');
}
