// 잔고/보유 종목 fast-path. KIS inquire_balance 한 번 호출로 요약 + 보유 종목 + 인라인 액션을 제공.

import { InlineKeyboard } from 'grammy';
import { callKisApi } from '../mcp/kis.js';
import { getMarketSession, sessionLabel } from '../scheduler/calendar.js';
import { checkKisOk, fmtKrw, num, outputDict, outputList, parseMcpResult } from './extract.js';
import { cached } from './cache.js';
import { renderBalanceCardPng, type BalanceHolding } from '../charts/balance-card.js';

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

function nowKstShort(): string {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  const HH = String(kst.getUTCHours()).padStart(2, '0');
  const MI = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${HH}:${MI} KST`;
}

export type BalanceView = {
  text: string;
  kb: InlineKeyboard;
  png?: Buffer; // 보유종목 카드 (있으면 텍스트와 함께 전송)
};

export async function buildBalanceView(): Promise<BalanceView> {
  const res = await cached('balance:raw', 20_000, () =>
    callKisApi('domestic_stock', 'inquire_balance', {}),
  );
  const parsed = parseMcpResult(res);
  if (!parsed.success) {
    return {
      text: `❌ 잔고 조회 실패: ${parsed.error ?? '알 수 없는 오류'}`,
      kb: new InlineKeyboard(),
    };
  }
  const kisOk = checkKisOk(parsed);
  if (!kisOk.ok) {
    return {
      text: `❌ 잔고 조회 실패 (KIS)\n${kisOk.message ?? '알 수 없는 오류'}`,
      kb: new InlineKeyboard().text('📊 포지션', 'nav:positions').text('📋 대기', 'nav:orders'),
    };
  }

  const holdings = outputList(parsed, 'output1');
  const summary = outputDict(parsed, 'output2');
  const session = getMarketSession();
  const sLabel = sessionLabel(session);

  const totEvlu = num(summary?.tot_evlu_amt) ?? 0;
  const dnca = num(summary?.dnca_tot_amt) ?? 0;
  const pflsSmt = num(summary?.evlu_pfls_smtl_amt) ?? 0;
  const pflsRt = num(summary?.asst_icdc_erng_rt) ?? 0;

  // 텍스트 — 사용자 요청대로 총평가(=내 돈) + 평가손익만. 예수금은 매수 시 별도 메뉴에서 표시.
  const sign = pflsSmt >= 0 ? '+' : '';
  const lines = [
    `💰 <b>내 자산</b>  ${sLabel.icon} ${sLabel.label}`,
    `총 평가 <b>${fmtKrw(totEvlu)}</b>`,
    `평가손익 <b>${sign}${Math.round(pflsSmt).toLocaleString()}원 (${sign}${pflsRt.toFixed(2)}%)</b>`,
  ];

  const kb = new InlineKeyboard();

  // 카드 이미지용 holdings 변환
  const cardHoldings: BalanceHolding[] = holdings.map((h) => ({
    name: String(h.prdt_name ?? h.pdno ?? ''),
    code: String(h.pdno ?? ''),
    qty: num(h.hldg_qty) ?? 0,
    avg: num(h.pchs_avg_pric) ?? 0,
    cur: num(h.prpr) ?? 0,
    pflsAmt: num(h.evlu_pfls_amt) ?? 0,
    pflsRt: num(h.evlu_pfls_rt) ?? 0,
  }));

  if (cardHoldings.length === 0) {
    lines.push('', '보유 종목 없음');
  } else {
    lines.push('', `📈 보유 종목 ${cardHoldings.length}개 (상세는 ↓ 카드)`);
    for (const h of cardHoldings) {
      kb.text(`📤 매도 ${h.name}`, `bal:sell:${h.code}`).row();
    }
  }

  kb.text('📊 포지션', 'nav:positions').text('📋 대기', 'nav:orders');

  let png: Buffer | undefined;
  if (cardHoldings.length > 0) {
    try {
      png = await renderBalanceCardPng({
        totalEvlu: totEvlu,
        cash: dnca,
        totalPfls: pflsSmt,
        totalPflsRt: pflsRt,
        holdings: cardHoldings,
      });
    } catch (err) {
      console.warn('[balance] card render failed:', (err as Error).message);
    }
  }

  return { text: lines.join('\n'), kb, png };
}

// 하위 호환 — 텍스트만 필요한 곳용
export async function handleBalance(): Promise<string> {
  const v = await buildBalanceView();
  return v.text;
}
