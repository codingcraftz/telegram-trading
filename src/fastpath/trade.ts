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
  insertPendingIntent,
  listWatchlist,
  type OrderSpec,
} from '../db/repo.js';
import { callKisApi, placeOrder } from '../mcp/kis.js';
import { firstOutput, fmtTtl, num, outputDict, outputList, parseMcpResult } from './extract.js';
import { resolveSymbol, type ResolvedSymbol } from './symbol.js';
import { formatKst, getMarketSession, nextMarketOpen, sessionLabel } from '../scheduler/calendar.js';
import type { OrderType } from '../mcp/kis.js';
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
    .text('⚡ 전략없이 즉시매수', `tr:bstr:${code}:now`)
    .row()
    .text('⏰ 시가매매 (다음 영업일)', `tr:bstr:${code}:mo`)
    .row()
    .text('⬅️ 뒤로', 'tr:buy');
  return {
    text:
      `📈 <b>매수: ${name}</b> (${code})\n` +
      '<b>전략 선택</b>\n' +
      '⚡ 전략없이 즉시매수 — 현재 세션에 맞게 즉시 발주 (TP/SL 옵션)\n' +
      '⏰ 시가매매 — 다음 영업일 9:00:05 시장가 매수',
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

  const ttl = fmtTtl(Date.now() + cfg.INTENT_TTL_MIN * 60 * 1000);
  const lines = [
    '📝 <b>매수 예약 확인</b>',
    `종목: ${sym.name} (${sym.code})`,
    curPrice && curPrice > 0 ? `현재가: ${curPrice.toLocaleString()}원 (참고)` : '',
    estimateLine,
    `전략: 시가매매 — ${formatKst(fireAt)} 시장가`,
    `갭가드: ${gapGuardPct === null ? '끄기' : `±${gapGuardPct}%`}` +
      ` · TP: ${tpPct === null ? '끄기' : `+${tpPct}%`}` +
      ` · SL: ${slPct === null ? '끄기' : `-${slPct}%`}`,
    '',
    `⌛ 확정 만료: ${ttl}`,
    `<code>/확정 ${reservationId}</code>  또는  <code>/취소 ${reservationId}</code>`,
  ].filter(Boolean);

  return { text: lines.join('\n'), reservationId };
}

// ============================================================
// 전략없이 즉시매수 흐름 — TP/SL 옵션 + 즉시 발주
// ============================================================
//
// 단계: 종목 → 전략(now) → TP → SL → 수량 → 확정(pendingIntent) → 발주
//
// 콜백 인코딩:
//   tr:bnow:tp:<code>:<tp>          (tp ∈ {3,5,10,off})
//   tr:bnow:sl:<code>:<tp>:<sl>     (sl ∈ {2,3,5,off})
//   tr:bnow:qty:<code>:<tp>:<sl>:p<pct>   (pct ∈ {10,20,30,50,100})
//   tr:bnow:qty:<code>:<tp>:<sl>:input    (직접 입력 모드 진입)

const TP_OPTIONS = [3, 5, 10] as const;
const SL_OPTIONS = [2, 3, 5] as const;

function pctOrOffLabel(v: string, prefix: '+' | '-'): string {
  return v === 'off' ? '없음' : `${prefix}${v}%`;
}

export function buildBuyNowTpMenu(
  code: string,
  name: string,
): { text: string; kb: InlineKeyboard } {
  const kb = new InlineKeyboard();
  for (const tp of TP_OPTIONS) {
    kb.text(`+${tp}%`, `tr:bnow:tp:${code}:${tp}`);
  }
  kb.row().text('🚫 TP 없음', `tr:bnow:tp:${code}:off`);
  kb.row().text('⬅️ 뒤로', `tr:bs:${code}`);
  return {
    text:
      `⚡ <b>즉시매수: ${name}</b> (${code})\n` +
      '\n<b>1/3 단계 — TP (익절) 설정</b>\n' +
      '체결가 기준 +% 도달 시 자동 청산.\n' +
      'TP 없음을 선택하면 자동 익절 안 함.',
    kb,
  };
}

export function buildBuyNowSlMenu(
  code: string,
  name: string,
  tp: string,
): { text: string; kb: InlineKeyboard } {
  const kb = new InlineKeyboard();
  for (const sl of SL_OPTIONS) {
    kb.text(`-${sl}%`, `tr:bnow:sl:${code}:${tp}:${sl}`);
  }
  kb.row().text('🚫 SL 없음', `tr:bnow:sl:${code}:${tp}:off`);
  kb.row().text('⬅️ 뒤로', `tr:bstr:${code}:now`);
  return {
    text:
      `⚡ <b>즉시매수: ${name}</b> (${code})\n` +
      `TP: <b>${pctOrOffLabel(tp, '+')}</b>\n` +
      '\n<b>2/3 단계 — SL (손절) 설정</b>\n' +
      '체결가 기준 -% 도달 시 자동 청산.\n' +
      'SL 없음을 선택하면 자동 손절 안 함.',
    kb,
  };
}

export function buildBuyNowQtyMenu(
  code: string,
  name: string,
  tp: string,
  sl: string,
): { text: string; kb: InlineKeyboard } {
  const kb = new InlineKeyboard();
  AMOUNT_PERCENTS.forEach((p, i) => {
    const label = p === 100 ? 'MAX' : `${p}%`;
    kb.text(label, `tr:bnow:qty:${code}:${tp}:${sl}:p${p}`);
    if (i === 2) kb.row();
  });
  kb.row().text('✏️ 직접 입력', `tr:bnow:qty:${code}:${tp}:${sl}:input`);
  kb.row().text('⬅️ 뒤로', `tr:bnow:tp:${code}:${tp}`); // TP는 그대로 유지하고 SL만 다시 고르려면 한 단계 위
  return {
    text:
      `⚡ <b>즉시매수: ${name}</b> (${code})\n` +
      `TP: <b>${pctOrOffLabel(tp, '+')}</b>  ·  SL: <b>${pctOrOffLabel(sl, '-')}</b>\n` +
      '\n<b>3/3 단계 — 수량 / 금액</b>\n' +
      '예수금 대비 비율 또는 [✏️ 직접 입력]으로 주식수/금액 지정.',
    kb,
  };
}

// 즉시매수 확정 메시지 생성 + pendingIntent 등록 (이후 confirm 콜백에서 발주)
export async function buildBuyNowConfirmAndRegister(args: {
  chatId: number;
  code: string;
  tp: string; // 'off' or '3' '5' '10'
  sl: string;
  amount: BuyAmountSpec;
}): Promise<{ text: string; intentId: string } | { error: string }> {
  const cfg = getConfig();
  const sym = await resolveSymbol(args.code);
  if (!sym) return { error: `종목 정보 없음 (${args.code})` };

  // 현재가 + 매수가능금액
  let curPrice = 0;
  let cash = 0;
  try {
    const pRes = await callKisApi('domestic_stock', 'inquire_price', {
      fid_cond_mrkt_div_code: 'J',
      fid_input_iscd: args.code,
    });
    const pParsed = parseMcpResult(pRes);
    if (pParsed.success) curPrice = num(firstOutput(pParsed)?.stck_prpr) ?? 0;
  } catch {}
  if (curPrice <= 0) return { error: '현재가 조회 실패' };

  try {
    const balRes = await callKisApi('domestic_stock', 'inquire_balance', {});
    const balParsed = parseMcpResult(balRes);
    if (balParsed.success) {
      const summary = outputDict(balParsed, 'output2');
      cash = num(summary?.dnca_tot_amt) ?? 0;
    }
  } catch {}

  // 수량 계산
  let qty = 0;
  if (args.amount.mode === 'shares') {
    qty = Math.floor(args.amount.value);
  } else if (args.amount.mode === 'amount') {
    qty = Math.floor(args.amount.value / curPrice);
  } else {
    if (cash <= 0) return { error: '예수금 조회 실패 — 비율 계산 불가' };
    const budget = (cash * args.amount.value) / 100;
    qty = Math.floor(budget / curPrice);
  }
  if (qty <= 0) return { error: `매수 수량 0주 (현재가 ${curPrice.toLocaleString()}원)` };

  const tpPct = args.tp === 'off' ? null : Number(args.tp);
  const slPct = args.sl === 'off' ? null : Number(args.sl);

  // 세션 분기 — 즉시매수이므로 closed/holiday면 거부, 시간외면 ord_dvsn 자동 매핑
  const session = getMarketSession();
  const sLabel = sessionLabel(session);
  if (session === 'closed' || session === 'holiday') {
    return {
      error:
        '🔴 장 외/휴장 시간 — 즉시매수 불가. 다음 영업일 시가매매로 예약하거나 정규장 시간에 시도해 주세요.',
    };
  }
  let orderType: OrderType = 'market';
  let price: number | undefined;
  if (session === 'pre_extended') orderType = 'pre_extended';
  else if (session === 'post_extended') orderType = 'post_extended';
  else if (session === 'after_single') {
    orderType = 'after_single';
    price = curPrice;
  }

  const spec: OrderSpec = {
    action: 'buy',
    market: 'KRX',
    symbol_code: sym.code,
    symbol_name: sym.name,
    order_type: orderType,
    price,
    quantity: qty,
    tp_pct: tpPct,
    sl_pct: slPct,
  };

  const intentId = insertPendingIntent({
    chatId: args.chatId,
    llmProposal: '',
    orderSpec: spec,
    ttlMin: cfg.INTENT_TTL_MIN,
  });

  const ttl = fmtTtl(Date.now() + cfg.INTENT_TTL_MIN * 60 * 1000);
  const lines = [
    `⚡ <b>즉시매수 확인</b>  ${sLabel.icon} ${sLabel.label}`,
    `종목: <b>${sym.name}</b> (${sym.code})`,
    `현재가: ${curPrice.toLocaleString()}원`,
    `수량: ${qty}주 (≈${(curPrice * qty).toLocaleString()}원)`,
    `TP: ${tpPct === null ? '없음' : `+${tpPct}%`}  ·  SL: ${slPct === null ? '없음' : `-${slPct}%`}`,
    '',
    `⌛ 확정 만료: ${ttl}`,
    `<code>/확정 ${intentId}</code>  또는  <code>/취소 ${intentId}</code>`,
  ];

  return { text: lines.join('\n'), intentId };
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

  // 세션별 ord_dvsn 결정 — 정규장 외엔 시간외 단가 매핑
  const session = getMarketSession();
  const sLabel = sessionLabel(session);
  if (session === 'closed' || session === 'holiday') {
    return {
      ok: false,
      text:
        `🔴 ${sLabel.label} — 매도 불가\n` +
        `${h.name} ${qty}주 매도는 정규장/시간외 거래 시간에 다시 시도해 주세요.`,
    };
  }
  let orderType: OrderType = 'market';
  let price: number | undefined;
  let typeLabel = '시장가';
  if (session === 'pre_extended') {
    orderType = 'pre_extended';
    typeLabel = '장전 시간외 종가';
  } else if (session === 'post_extended') {
    orderType = 'post_extended';
    typeLabel = '장후 시간외 종가';
  } else if (session === 'after_single') {
    orderType = 'after_single';
    price = h.curPrice;
    typeLabel = '시간외 단일가 (현재가)';
  }

  try {
    const result = await placeOrder({
      market: 'KRX',
      side: 'sell',
      code: args.code,
      quantity: qty,
      orderType,
      price,
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
        `📤 <b>매도 주문 접수</b> ${sLabel.icon} ${sLabel.label}\n` +
        `${h.name} (${h.code}) ${qty}주 ${typeLabel}\n` +
        `주문번호: ${orderId}`,
    };
  } catch (err) {
    return { ok: false, text: `❌ 매도 실패: ${(err as Error).message}` };
  }
}
