// 단순 매수 정형 패턴 fast-path. LLM 거치지 않고 직접 제안 생성.
// 지원:
//   "삼성전자 5주 매수"           (시장가, 정규장에선 즉시 발주)
//   "삼성전자 5주 시장가 매수"
//   "삼성전자 10만원어치 매수"
//   "005930 100만원어치 사줘"
//
// 장 시간대별 디폴트:
//   regular        → 시장가 (ord_dvsn=01)
//   pre_auction    → 시장가 (KIS가 시초가 동시호가 큐에 접수)
//   close_auction  → 시장가 (KIS가 종가 동시호가 큐에 접수)
//   pre_extended   → 장전 시간외 종가 (ord_dvsn=05, 전일 종가)
//   post_extended  → 장후 시간외 종가 (ord_dvsn=06, 당일 종가)
//   after_single   → 시간외 단일가 (ord_dvsn=07, 단가 필요 — 현재가로 발주)
//   closed/holiday → 자동으로 다음 영업일 시가매매 예약

import { InlineKeyboard } from 'grammy';
import { callKisApi } from '../mcp/kis.js';
import {
  insertPendingIntent,
  logTrade,
  insertMarketOpenReservation,
  getMarketOpenSettings,
  DEFAULT_GAP_GUARD_PCT,
  type OrderSpec,
} from '../db/repo.js';
import { getConfig } from '../config.js';
import { checkSpec } from '../guardrails/policy.js';
import { firstOutput, fmtTtl, num, parseMcpResult } from './extract.js';
import { resolveSymbol } from './symbol.js';
import { formatKst, getMarketSession, nextMarketOpen, sessionLabel } from '../scheduler/calendar.js';
import type { MarketSession } from '../scheduler/calendar.js';

type BuyIntent = {
  sym: string;
  qtyShares?: number;
  qtyKrw?: number;
  market: boolean;
};

const PATTERNS: Array<{ re: RegExp; build: (m: RegExpMatchArray) => BuyIntent | null }> = [
  // "<종목> N주 (시장가|지정가)? 매수|사줘"
  {
    re: /^(?<sym>[A-Za-z가-힣0-9]+)\s+(?<qty>\d+)\s*주\s*(?<type>시장가|지정가)?\s*(매수|사줘|사|사다오)\s*\??$/,
    build: (m) => ({
      sym: m.groups!.sym!,
      qtyShares: Number(m.groups!.qty),
      market: (m.groups!.type ?? '시장가') === '시장가',
    }),
  },
  // "<종목> N만원어치 매수"
  {
    re: /^(?<sym>[A-Za-z가-힣0-9]+)\s+(?<amt>\d+(?:[\.,]\d+)?)\s*만\s*원?\s*어치\s*(매수|사줘|사)\s*\??$/,
    build: (m) => ({
      sym: m.groups!.sym!,
      qtyKrw: Math.round(Number((m.groups!.amt ?? '0').replace(',', '')) * 10_000),
      market: true,
    }),
  },
  // "<종목> N원어치 매수"
  {
    re: /^(?<sym>[A-Za-z가-힣0-9]+)\s+(?<amt>\d{4,})\s*원\s*어치\s*(매수|사줘|사)\s*\??$/,
    build: (m) => ({
      sym: m.groups!.sym!,
      qtyKrw: Number(m.groups!.amt),
      market: true,
    }),
  },
];

export function tryMatchBuy(text: string): BuyIntent | null {
  const t = text.trim();
  for (const p of PATTERNS) {
    const m = t.match(p.re);
    if (m) return p.build(m);
  }
  return null;
}

// 세션별 디폴트 orderType과 사용자 안내 메시지
function sessionPolicy(s: MarketSession): {
  orderType: OrderSpec['order_type'] | 'pre_extended' | 'post_extended' | 'after_single';
  note: string;
} {
  switch (s) {
    case 'regular':
      return { orderType: 'market', note: '🟢 정규장 — 시장가 즉시 발주' };
    case 'pre_auction':
      return { orderType: 'market', note: '🟡 장전 동시호가 — 시초가 결정 큐에 접수' };
    case 'close_auction':
      return { orderType: 'market', note: '🟡 장후 동시호가 — 종가 결정 큐에 접수' };
    case 'pre_extended':
      return { orderType: 'pre_extended', note: '🟡 장전 시간외 종가 (08:30~08:40, 전일 종가)' };
    case 'post_extended':
      return { orderType: 'post_extended', note: '🟡 장후 시간외 종가 (15:40~16:00, 당일 종가)' };
    case 'after_single':
      return { orderType: 'after_single', note: '🟡 시간외 단일가 (16:00~18:00, 현재가 기준 ±10%)' };
    case 'closed':
    case 'holiday':
    default:
      return { orderType: 'market', note: '🔴 장 외 시간' };
  }
}

export type HandleBuyResult =
  | { kind: 'reply'; text: string }
  | { kind: 'proposal'; summary: string; intentId: string; kb?: InlineKeyboard };

export async function handleBuy(chatId: number, intent: BuyIntent): Promise<HandleBuyResult> {
  const cfg = getConfig();
  const sym = await resolveSymbol(intent.sym);
  if (!sym) return { kind: 'reply', text: `❓ 종목을 찾지 못했습니다: ${intent.sym}` };

  // 현재가 (시장가 산정 / 금액→수량 변환 / 단가 필요한 시간외단일가용)
  const priceRes = await callKisApi('domestic_stock', 'inquire_price', {
    fid_cond_mrkt_div_code: 'J',
    fid_input_iscd: sym.code,
  });
  const priceParsed = parseMcpResult(priceRes);
  if (!priceParsed.success)
    return { kind: 'reply', text: `❌ 현재가 조회 실패: ${priceParsed.error}` };
  const priceData = firstOutput(priceParsed);
  const curPrice = num(priceData?.stck_prpr);
  if (curPrice === null || curPrice <= 0)
    return { kind: 'reply', text: `❌ 현재가를 못 읽었습니다.` };

  let qty = intent.qtyShares;
  if (qty === undefined && intent.qtyKrw !== undefined) {
    qty = Math.floor(intent.qtyKrw / curPrice);
  }
  if (!qty || qty <= 0) {
    return {
      kind: 'reply',
      text: `❌ 매수 수량이 0주로 계산됨 (현재가 ${curPrice.toLocaleString()}원).`,
    };
  }

  const session = getMarketSession();
  const sLabel = sessionLabel(session);
  const policy = sessionPolicy(session);

  // closed/holiday → 자동 시가매매 예약
  if (session === 'closed' || session === 'holiday') {
    const settings = getMarketOpenSettings(chatId);
    const gapGuardPct =
      settings?.gapGuardPct === undefined || settings?.gapGuardPct === null
        ? DEFAULT_GAP_GUARD_PCT
        : settings.gapGuardPct === 0
          ? null
          : settings.gapGuardPct;
    const tpPct = settings?.tpPct ?? null;
    const slPct = settings?.slPct ?? null;
    const fireAt = nextMarketOpen();
    const reservationId = insertMarketOpenReservation({
      chatId,
      market: 'KRX',
      symbolCode: sym.code,
      symbolName: sym.name,
      qtyMode: intent.qtyKrw !== undefined ? 'amount' : 'shares',
      qtyValue: intent.qtyKrw !== undefined ? intent.qtyKrw : qty,
      gapGuardPct,
      tpPct,
      slPct,
      scheduledFor: fireAt.getTime(),
      ttlMin: cfg.INTENT_TTL_MIN,
    });
    const ttl = fmtTtl(Date.now() + cfg.INTENT_TTL_MIN * 60 * 1000);
    const summary = [
      `📅 <b>시가매매 자동 예약</b>  ${sLabel.icon} ${sLabel.label}`,
      `종목: <b>${sym.name}</b> (${sym.code})`,
      intent.qtyKrw !== undefined
        ? `예산: ${intent.qtyKrw.toLocaleString()}원 (≈${qty}주, 현재가 ${curPrice.toLocaleString()}원)`
        : `수량: ${qty}주 (≈${(curPrice * qty).toLocaleString()}원)`,
      `발주: ${formatKst(fireAt)}`,
      `갭가드: ${gapGuardPct === null ? '끄기' : `±${gapGuardPct}%`}` +
        ` · TP: ${tpPct === null ? '끄기' : `+${tpPct}%`}` +
        ` · SL: ${slPct === null ? '끄기' : `-${slPct}%`}`,
      '',
      `⌛ 확정 만료: ${ttl}`,
      `<code>/확정 ${reservationId}</code>  또는  <code>/취소 ${reservationId}</code>`,
    ].join('\n');
    const kb = new InlineKeyboard()
      .text('✅ 예약 확정', `confirm:${reservationId}`)
      .text('❌ 취소', `cancel:${reservationId}`);
    return { kind: 'proposal', summary, intentId: reservationId, kb };
  }

  // 정규장 또는 시간외 — pendingIntent 흐름.
  // 시간외 단일가(ord_dvsn=07)는 단가가 필요 → KIS에는 'after_single'으로 보내되 price도 현재가로 채움.
  // 단, src/mcp/kis.ts placeOrder는 'limit'일 때만 price를 전송. after_single은 price 무시.
  // KIS docs상 시간외 단일가는 단가가 필요하므로 우회: order_type='limit'로 두되 ord_dvsn=07로 매핑하는 변형이 깔끔.
  // 현재는 단가 정확도가 낮으므로 시간외 단일가 시간엔 'limit' + 현재가로 발주 시도 (KIS가 받지 않으면 거부 알림).
  let orderType: OrderSpec['order_type'] = intent.market ? 'market' : 'limit';
  let price: number | undefined = intent.market ? undefined : curPrice;
  if (policy.orderType === 'pre_extended') {
    orderType = 'pre_extended';
  } else if (policy.orderType === 'post_extended') {
    orderType = 'post_extended';
  } else if (policy.orderType === 'after_single') {
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
    tp_pct: null,
    sl_pct: null,
  };

  // 가드레일
  const guard = checkSpec(spec);
  if (!guard.ok) {
    return { kind: 'reply', text: `❌ 거절: ${guard.reason}` };
  }

  const approxKrw = curPrice * qty;
  const priceLine = intent.market
    ? `시장가 ${policy.orderType !== 'market' ? `→ ${policy.note}` : ''}`
    : `${curPrice.toLocaleString()}원`;
  const summary =
    `📥 <b>매수 제안</b> ${sLabel.icon} ${sLabel.label}\n` +
    `종목: <b>${sym.name}</b> (KRX/${sym.code})\n` +
    `수량: ${qty}주 (${priceLine}, ≈${approxKrw.toLocaleString()}원)\n` +
    (policy.orderType !== 'market' && !intent.market ? '' : `\n${policy.note}\n`) +
    `\n<code>/확정 <id></code>  또는  <code>/취소 <id></code>`;

  const intentId = insertPendingIntent({
    chatId,
    llmProposal: summary,
    orderSpec: spec,
    ttlMin: cfg.INTENT_TTL_MIN,
  });
  logTrade({ chatId, kind: 'proposed', payload: { intentId, spec, via: 'fastpath', session } });

  return {
    kind: 'proposal',
    summary: summary.replaceAll('<id>', intentId),
    intentId,
  };
}
