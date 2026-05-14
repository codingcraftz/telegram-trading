// 시가매매 (다음 영업일 시초가 시장가 매수) — 셋업 명령 + 예약 등록.
//
// 사용:
//   /시가매매                          → 현재 셋팅 표시
//   /시가매매 set gap=5 tp=5 sl=3      → 셋팅 갱신 (gap=0=끄기, tp=/sl= 빈값=끄기)
//   "삼성전자 시가매매 10주"            → shares=10
//   "삼성전자 시가매매 150만원"         → amount=1,500,000
//   "삼성전자 시가매매 1500000원"        → amount=1,500,000
//   "삼성전자 시가매매 100%"            → percent=100 (예수금 대비)

import { getConfig } from '../config.js';
import { callKisApi } from '../mcp/kis.js';
import {
  DEFAULT_GAP_GUARD_PCT,
  getMarketOpenSettings,
  insertMarketOpenReservation,
  upsertMarketOpenSettings,
} from '../db/repo.js';
import { firstOutput, fmtTtl, num, parseMcpResult } from './extract.js';
import { resolveSymbol } from './symbol.js';
import { formatKst, nextMarketOpen } from '../scheduler/calendar.js';

export type MarketOpenIntent = {
  sym: string;
  qtyMode: 'shares' | 'amount' | 'percent';
  qtyValue: number;
};

const PATTERN =
  /^(?<sym>[A-Za-z가-힣0-9]+)\s+시가매매\s+(?<qty>\d+(?:[.,]\d+)?)\s*(?<unit>주|만원|원|%)?\s*\??$/;

export function tryMatchMarketOpen(text: string): MarketOpenIntent | null {
  const m = text.trim().match(PATTERN);
  if (!m) return null;
  const sym = m.groups!.sym!;
  const rawQty = Number((m.groups!.qty ?? '0').replace(',', ''));
  const unit = m.groups!.unit ?? '주';
  if (!Number.isFinite(rawQty) || rawQty <= 0) return null;

  if (unit === '%') {
    if (rawQty > 100) return null;
    return { sym, qtyMode: 'percent', qtyValue: rawQty };
  }
  if (unit === '만원') {
    return { sym, qtyMode: 'amount', qtyValue: Math.round(rawQty * 10_000) };
  }
  if (unit === '원') {
    return { sym, qtyMode: 'amount', qtyValue: Math.round(rawQty) };
  }
  // 주
  return { sym, qtyMode: 'shares', qtyValue: Math.floor(rawQty) };
}

// ---------- /시가매매 셋업 ----------

export async function handleMarketOpenCommand(chatId: number, args: string): Promise<string> {
  const arg = args.trim();
  if (!arg) {
    return renderSettings(chatId);
  }
  // set gap=5 tp=5 sl=3
  const setMatch = arg.match(/^set\s+(.+)$/i);
  if (!setMatch) {
    return [
      '사용법:',
      '  /시가매매             — 현재 셋팅 보기',
      '  /시가매매 set gap=5 tp=5 sl=3',
      '    gap=0    → 갭가드 끄기',
      '    tp=, sl= → 빈값으로 두면 해당 항목 끄기',
    ].join('\n');
  }

  const updates: { gapGuardPct?: number | null; tpPct?: number | null; slPct?: number | null } = {};
  const tokens = setMatch[1]!.split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    const kv = tok.match(/^(gap|tp|sl)=(.*)$/i);
    if (!kv) return `알 수 없는 옵션: ${tok}`;
    const key = kv[1]!.toLowerCase();
    const val = kv[2]!;
    let parsed: number | null;
    if (val === '') {
      parsed = null;
    } else {
      const n = Number(val);
      if (!Number.isFinite(n) || n < 0) return `잘못된 숫자: ${tok}`;
      parsed = n;
    }
    if (key === 'gap') updates.gapGuardPct = parsed;
    else if (key === 'tp') updates.tpPct = parsed;
    else if (key === 'sl') updates.slPct = parsed;
  }

  upsertMarketOpenSettings({ chatId, ...updates });
  return '✅ 셋팅 갱신됨\n\n' + renderSettings(chatId);
}

function renderSettings(chatId: number): string {
  const s = getMarketOpenSettings(chatId);
  const gap = s?.gapGuardPct;
  const tp = s?.tpPct;
  const sl = s?.slPct;
  const gapStr =
    gap === null || gap === undefined
      ? `${DEFAULT_GAP_GUARD_PCT}% (기본)`
      : gap === 0
        ? '끄기'
        : `±${gap}%`;
  const tpStr = tp === null || tp === undefined ? '끄기' : `+${tp}%`;
  const slStr = sl === null || sl === undefined ? '끄기' : `-${sl}%`;
  return [
    '⚙️ <b>시가매매 셋팅</b>',
    `  갭가드: ${gapStr}`,
    `  TP: ${tpStr}`,
    `  SL: ${slStr}`,
    '',
    '갱신: <code>/시가매매 set gap=5 tp=5 sl=3</code>',
    '예약: <code>삼성전자 시가매매 10주</code> / <code>150만원</code> / <code>100%</code>',
  ].join('\n');
}

function effectiveGapGuard(stored: number | null | undefined): number | null {
  if (stored === undefined || stored === null) return DEFAULT_GAP_GUARD_PCT;
  if (stored === 0) return null; // 끄기
  return stored;
}

// ---------- 예약 등록 ----------

export type ReserveResult =
  | { kind: 'reply'; text: string }
  | { kind: 'proposal'; summary: string; intentId: string };

export async function handleMarketOpenReserve(
  chatId: number,
  intent: MarketOpenIntent,
): Promise<ReserveResult> {
  const cfg = getConfig();
  const sym = await resolveSymbol(intent.sym);
  if (!sym) return { kind: 'reply', text: `❓ 종목을 찾지 못했습니다: ${intent.sym}` };

  // 현재가 (참고용 — 발주 시점에 시초가 기준 재계산)
  const priceRes = await callKisApi('domestic_stock', 'inquire_price', {
    fid_cond_mrkt_div_code: 'J',
    fid_input_iscd: sym.code,
  });
  const priceParsed = parseMcpResult(priceRes);
  if (!priceParsed.success)
    return { kind: 'reply', text: `❌ 현재가 조회 실패: ${priceParsed.error}` };
  const priceData = firstOutput(priceParsed);
  const curPrice = num(priceData?.stck_prpr);

  // 셋팅 로드
  const settings = getMarketOpenSettings(chatId);
  const gapGuardPct = effectiveGapGuard(settings?.gapGuardPct);
  const tpPct = settings?.tpPct ?? null;
  const slPct = settings?.slPct ?? null;

  // 예상 수량 표시 (현재가 기준)
  let estQtyText = '';
  if (curPrice && curPrice > 0) {
    if (intent.qtyMode === 'shares') {
      estQtyText = `${intent.qtyValue}주 (≈${(curPrice * intent.qtyValue).toLocaleString()}원)`;
    } else if (intent.qtyMode === 'amount') {
      const qty = Math.floor(intent.qtyValue / curPrice);
      estQtyText = `약 ${qty}주 (예산 ${intent.qtyValue.toLocaleString()}원, 현재가 ${curPrice.toLocaleString()}원)`;
    } else {
      estQtyText = `예수금 ${intent.qtyValue}% (발주 시점 시초가 기준 계산)`;
    }
  } else {
    estQtyText =
      intent.qtyMode === 'shares'
        ? `${intent.qtyValue}주`
        : intent.qtyMode === 'amount'
          ? `예산 ${intent.qtyValue.toLocaleString()}원`
          : `예수금 ${intent.qtyValue}%`;
  }

  const fireAt = nextMarketOpen();
  const reservationId = insertMarketOpenReservation({
    chatId,
    market: 'KRX',
    symbolCode: sym.code,
    symbolName: sym.name,
    qtyMode: intent.qtyMode,
    qtyValue: intent.qtyValue,
    gapGuardPct,
    tpPct,
    slPct,
    scheduledFor: fireAt.getTime(),
    ttlMin: cfg.INTENT_TTL_MIN,
  });

  const ttl = fmtTtl(Date.now() + cfg.INTENT_TTL_MIN * 60 * 1000);
  const lines = [
    '📝 <b>시가매매 예약 확인</b>',
    `종목: ${sym.name} (KRX/${sym.code})`,
    curPrice && curPrice > 0 ? `현재가: ${curPrice.toLocaleString()}원 (참고)` : '',
    `수량: ${estQtyText}`,
    `발주: ${formatKst(fireAt)} 시장가`,
    `갭가드: ${gapGuardPct === null ? '끄기' : `±${gapGuardPct}%`}` +
      ` · TP: ${tpPct === null ? '끄기' : `+${tpPct}%`}` +
      ` · SL: ${slPct === null ? '끄기' : `-${slPct}%`}`,
    '',
    `⌛ 확정 만료: ${ttl}`,
    `<code>/확정 ${reservationId}</code>  또는  <code>/취소 ${reservationId}</code>`,
  ].filter(Boolean);

  return { kind: 'proposal', summary: lines.join('\n'), intentId: reservationId };
}
