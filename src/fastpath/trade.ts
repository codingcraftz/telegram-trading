// 거래 흐름 — 매수/매도 다단계 UI.
//   [💼 거래]
//     → [📈 매수] → 종목(관심종목/검색) → 전략(시가매매…) → 금액(%/직접) → 확정 → 시가매매 예약 등록
//     → [📉 매도] → 보유 종목 → 수량(전량/절반/직접) → 확정 → 시장가 매도 (즉시)
//
// callback 데이터 64-byte 한계 회피: 종목명은 마스터에서 lookup, code/strategy/amount 만 인코딩.

import { InlineKeyboard } from 'grammy';
import {
  DEFAULT_GAP_GUARD_PCT,
  getMarketOpenSettings,
  insertMarketOpenReservation,
  listWatchlist,
} from '../db/repo.js';
import { callKisApi, placeOrder } from '../mcp/kis.js';
import { firstOutput, num, outputDict, outputList, parseMcpResult } from './extract.js';
import { resolveSymbol, type ResolvedSymbol } from './symbol.js';
import { formatKst, nextMarketOpen } from '../scheduler/calendar.js';
import { getConfig } from '../config.js';

// ============================================================
// 메인 메뉴
// ============================================================

export function buildTradeMainMenu(): { text: string; kb: InlineKeyboard } {
  const kb = new InlineKeyboard()
    .text('📈 매수', 'tr:buy')
    .text('📉 매도', 'tr:sell');
  return {
    text: '💼 <b>거래</b>\n매수/매도를 선택하세요.',
    kb,
  };
}

// ============================================================
// 매수 흐름
// ============================================================

export function buildBuySymbolMenu(chatId: number): { text: string; kb: InlineKeyboard } {
  const wl = listWatchlist(chatId);
  const kb = new InlineKeyboard();
  for (const w of wl) {
    kb.text(w.symbolName, `tr:bs:${w.symbolCode}`).row();
  }
  kb.text('🔍 검색하기', 'tr:bsearch').row();
  kb.text('⬅️ 뒤로', 'tr:back');
  return {
    text:
      '📈 <b>매수 — 종목 선택</b>\n' +
      (wl.length === 0
        ? '관심종목이 없습니다. [🔍 검색하기]로 종목을 찾으세요.'
        : '관심종목 중 선택하거나 [🔍 검색하기]를 누르세요.'),
    kb,
  };
}

export function buildBuySearchPrompt(): { text: string; kb: InlineKeyboard } {
  return {
    text:
      '🔍 <b>매수 — 종목 검색</b>\n' +
      '검색어를 입력해주세요.\n예: <code>삼성전자</code> · <code>005930</code>',
    kb: new InlineKeyboard().text('⬅️ 뒤로', 'tr:buy'),
  };
}

export function buildBuySearchResults(
  q: string,
  candidates: ResolvedSymbol[],
): { text: string; kb: InlineKeyboard } {
  const kb = new InlineKeyboard();
  for (const c of candidates) {
    kb.text(`${c.name} (${c.code})`, `tr:bs:${c.code}`).row();
  }
  kb.text('⬅️ 뒤로', 'tr:buy');
  return {
    text: `🔍 "${q}" 검색 결과 (${candidates.length}개)`,
    kb,
  };
}

export function buildBuyStrategyMenu(
  code: string,
  name: string,
): { text: string; kb: InlineKeyboard } {
  const kb = new InlineKeyboard()
    .text('⏰ 시가매매', `tr:bstr:${code}:mo`)
    .row()
    .text('⬅️ 뒤로', 'tr:buy');
  return {
    text:
      `📈 <b>매수: ${name}</b> (${code})\n` +
      '<b>전략 선택</b>\n' +
      '⏰ 시가매매 — 다음 영업일 9:00:05 시장가 매수\n' +
      '(추후 다른 전략 추가 예정)',
    kb,
  };
}

const AMOUNT_PERCENTS = [10, 20, 30, 50, 100] as const;

export function buildBuyAmountMenu(
  code: string,
  name: string,
  strategy: string,
): { text: string; kb: InlineKeyboard } {
  const kb = new InlineKeyboard();
  // 10/20/30/50/MAX 5개를 3·2 행으로
  AMOUNT_PERCENTS.forEach((p, i) => {
    const label = p === 100 ? 'MAX' : `${p}%`;
    kb.text(label, `tr:bamt:${code}:${strategy}:p${p}`);
    if (i === 2) kb.row();
  });
  kb.row().text('✏️ 직접 입력', `tr:binput:${code}:${strategy}`);
  kb.row().text('⬅️ 뒤로', `tr:bs:${code}`);
  const stratLabel = strategy === 'mo' ? '시가매매' : strategy;
  return {
    text:
      `📈 <b>매수: ${name}</b> (${code})\n` +
      `전략: <b>${stratLabel}</b>\n\n` +
      '<b>금액</b> 선택 (예수금 대비 비율 또는 직접 입력)',
    kb,
  };
}

export function buildBuyDirectInputPrompt(
  code: string,
  name: string,
  strategy: string,
): { text: string; kb: InlineKeyboard } {
  const stratLabel = strategy === 'mo' ? '시가매매' : strategy;
  return {
    text:
      `✏️ <b>매수 — 금액 직접 입력</b>\n` +
      `종목: ${name} (${code}) · 전략: ${stratLabel}\n\n` +
      '아래 형식 중 하나로 보내주세요:\n' +
      '  <code>10주</code> · <code>150만원</code> · <code>1500000원</code> · <code>20%</code>',
    kb: new InlineKeyboard().text('⬅️ 뒤로', `tr:bs:${code}`),
  };
}

// 금액 확정 화면 + 예약 등록 처리
export type BuyAmountSpec =
  | { mode: 'percent'; value: number }
  | { mode: 'amount'; value: number }
  | { mode: 'shares'; value: number };

export async function buildBuyConfirmAndRegister(args: {
  chatId: number;
  code: string;
  strategy: string;
  amount: BuyAmountSpec;
}): Promise<{ text: string; reservationId: string } | { error: string }> {
  const cfg = getConfig();
  const sym = await resolveSymbol(args.code);
  if (!sym) return { error: `종목 정보 없음 (${args.code})` };

  // 현재가 (참고)
  let curPrice: number | null = null;
  try {
    const res = await callKisApi('domestic_stock', 'inquire_price', {
      fid_cond_mrkt_div_code: 'J',
      fid_input_iscd: args.code,
    });
    const parsed = parseMcpResult(res);
    if (parsed.success) curPrice = num(firstOutput(parsed)?.stck_prpr);
  } catch {}

  // 시가매매 셋팅
  const settings = getMarketOpenSettings(args.chatId);
  const gapGuardPct =
    settings?.gapGuardPct === undefined || settings?.gapGuardPct === null
      ? DEFAULT_GAP_GUARD_PCT
      : settings.gapGuardPct === 0
        ? null
        : settings.gapGuardPct;
  const tpPct = settings?.tpPct ?? null;
  const slPct = settings?.slPct ?? null;

  const fireAt = nextMarketOpen();
  const qtyMode = args.amount.mode;
  const qtyValue = args.amount.value;

  // 예상 수량/금액 표시
  let estimateLine: string;
  if (qtyMode === 'shares') {
    estimateLine =
      curPrice && curPrice > 0
        ? `수량: ${qtyValue}주 (≈${(curPrice * qtyValue).toLocaleString()}원)`
        : `수량: ${qtyValue}주`;
  } else if (qtyMode === 'amount') {
    if (curPrice && curPrice > 0) {
      const q = Math.floor(qtyValue / curPrice);
      estimateLine = `예산: ${qtyValue.toLocaleString()}원 (≈${q}주, 현재가 ${curPrice.toLocaleString()}원)`;
    } else {
      estimateLine = `예산: ${qtyValue.toLocaleString()}원`;
    }
  } else {
    estimateLine = `예수금 ${qtyValue}% (발주 시점 시초가 기준 계산)`;
  }

  const reservationId = insertMarketOpenReservation({
    chatId: args.chatId,
    market: 'KRX',
    symbolCode: sym.code,
    symbolName: sym.name,
    qtyMode,
    qtyValue,
    gapGuardPct,
    tpPct,
    slPct,
    scheduledFor: fireAt.getTime(),
    ttlMin: cfg.INTENT_TTL_MIN,
  });

  const lines = [
    '📝 <b>매수 예약 확인</b>',
    `종목: ${sym.name} (${sym.code})`,
    curPrice && curPrice > 0 ? `현재가: ${curPrice.toLocaleString()}원 (참고)` : '',
    estimateLine,
    `전략: 시가매매 — ${formatKst(fireAt)} 시장가`,
    `갭가드: ${gapGuardPct === null ? '끄기' : `±${gapGuardPct}%`}`,
    `TP: ${tpPct === null ? '끄기' : `+${tpPct}%`}  SL: ${slPct === null ? '끄기' : `-${slPct}%`}`,
    '',
    `<code>/확정 ${reservationId}</code>  또는  <code>/취소 ${reservationId}</code>`,
  ].filter(Boolean);

  return { text: lines.join('\n'), reservationId };
}

// 매수 직접 입력 파서 — 10주 / 150만원 / 1500000원 / 20%
export function parseBuyAmount(input: string): BuyAmountSpec | null {
  const t = input.trim();
  // 주
  let m = t.match(/^(\d+(?:\.\d+)?)\s*주$/);
  if (m) {
    const n = Math.floor(Number(m[1]));
    if (n > 0) return { mode: 'shares', value: n };
  }
  // 만원
  m = t.match(/^(\d+(?:[.,]\d+)?)\s*만\s*원?$/);
  if (m) {
    const n = Math.round(Number(m[1]!.replace(',', '')) * 10_000);
    if (n > 0) return { mode: 'amount', value: n };
  }
  // 원
  m = t.match(/^(\d{4,})\s*원$/);
  if (m) {
    const n = Math.round(Number(m[1]));
    if (n > 0) return { mode: 'amount', value: n };
  }
  // %
  m = t.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (m) {
    const n = Number(m[1]);
    if (n > 0 && n <= 100) return { mode: 'percent', value: n };
  }
  return null;
}

// ============================================================
// 매도 흐름
// ============================================================

type Holding = {
  code: string;
  name: string;
  qty: number;
  avgPrice: number;
  curPrice: number;
  pflsPct: number;
};

async function fetchHoldings(): Promise<Holding[]> {
  const res = await callKisApi('domestic_stock', 'inquire_balance', {});
  const parsed = parseMcpResult(res);
  if (!parsed.success) return [];
  const list = outputList(parsed, 'output1');
  return list
    .map((h) => ({
      code: String(h.pdno ?? ''),
      name: String(h.prdt_name ?? h.pdno ?? ''),
      qty: num(h.hldg_qty) ?? 0,
      avgPrice: num(h.pchs_avg_pric) ?? 0,
      curPrice: num(h.prpr) ?? 0,
      pflsPct: num(h.evlu_pfls_rt) ?? 0,
    }))
    .filter((h) => h.qty > 0);
}

export async function buildSellSymbolMenu(): Promise<{ text: string; kb: InlineKeyboard }> {
  const holdings = await fetchHoldings();
  const kb = new InlineKeyboard();
  for (const h of holdings) {
    const sign = h.pflsPct >= 0 ? '+' : '';
    kb.text(`${h.name} ${h.qty}주 (${sign}${h.pflsPct.toFixed(1)}%)`, `tr:ss:${h.code}`).row();
  }
  kb.text('⬅️ 뒤로', 'tr:back');
  return {
    text:
      holdings.length === 0
        ? '📉 <b>매도</b>\n보유 종목 없음'
        : '📉 <b>매도 — 보유 종목 선택</b>\n매도할 종목을 누르세요.',
    kb,
  };
}

export async function buildSellQtyMenu(
  code: string,
): Promise<{ text: string; kb: InlineKeyboard } | { error: string }> {
  const holdings = await fetchHoldings();
  const h = holdings.find((x) => x.code === code);
  if (!h) return { error: '보유 종목을 못 찾았습니다.' };

  const kb = new InlineKeyboard()
    .text('전량', `tr:sq:${code}:all`)
    .text('절반', `tr:sq:${code}:half`)
    .row()
    .text('✏️ 직접 입력 (수량)', `tr:sinput:${code}`)
    .row()
    .text('⬅️ 뒤로', 'tr:sell');
  return {
    text:
      `📉 <b>매도: ${h.name}</b> (${h.code})\n` +
      `보유: ${h.qty}주 · 평균 ${h.avgPrice.toLocaleString()}원 · 현재 ${h.curPrice.toLocaleString()}원\n\n` +
      '수량 선택',
    kb,
  };
}

export async function executeSell(args: {
  chatId: number;
  code: string;
  qtyMode: 'all' | 'half' | 'shares';
  qtyValue?: number;
}): Promise<{ ok: true; text: string } | { ok: false; text: string }> {
  const holdings = await fetchHoldings();
  const h = holdings.find((x) => x.code === args.code);
  if (!h) return { ok: false, text: '보유 종목 정보 없음 — 매도 실패' };

  let qty: number;
  if (args.qtyMode === 'all') qty = h.qty;
  else if (args.qtyMode === 'half') qty = Math.max(1, Math.floor(h.qty / 2));
  else qty = Math.floor(args.qtyValue ?? 0);

  if (qty <= 0 || qty > h.qty) {
    return { ok: false, text: `❌ 잘못된 수량: ${qty}주 (보유 ${h.qty}주)` };
  }

  try {
    const result = await placeOrder({
      market: 'KRX',
      side: 'sell',
      code: args.code,
      quantity: qty,
      orderType: 'market',
    });
    const ext = (obj: unknown, ...keys: string[]): string | undefined => {
      if (!obj || typeof obj !== 'object') return undefined;
      const o = obj as Record<string, unknown>;
      const lc = keys.map((k) => k.toLowerCase());
      for (const k of Object.keys(o)) {
        if (lc.includes(k.toLowerCase()) && typeof o[k] === 'string') return o[k] as string;
      }
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (v && typeof v === 'object') {
          const r = ext(v, ...keys);
          if (r) return r;
        }
      }
      return undefined;
    };
    const orderId = ext(result, 'ODNO', 'odno', 'ord_no') ?? `sell-${Date.now()}`;
    return {
      ok: true,
      text:
        `📤 <b>매도 주문 접수</b>\n` +
        `${h.name} (${h.code}) ${qty}주 시장가\n` +
        `주문번호: ${orderId}`,
    };
  } catch (err) {
    return { ok: false, text: `❌ 매도 실패: ${(err as Error).message}` };
  }
}
