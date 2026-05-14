// 시가매매 예약 발주 스케줄러.
// 60초 간격 폴링: state='pending' AND scheduledFor <= now 인 예약 1회 발주.
// 발주 흐름:
//   1) tryClaimReservation으로 단일 발사 클레임
//   2) 시초가/전일종가 조회 → 갭가드 평가
//   3) 수량 모드별 재계산 (시초가 기준)
//   4) placeBuyOrder + pollFill
//   5) 체결되면 시장가 평균 기준으로 TP/SL 가격 update

import {
  attachPositionToReservation,
  expireOldAwaitingReservations,
  getReservation,
  listDueReservations,
  logTrade,
  rejectReservation,
  setPositionTpSl,
  tryClaimReservation,
  type OrderSpec,
} from '../db/repo.js';
import { callKisApi, type Market } from '../mcp/kis.js';
import { firstOutput, num, parseMcpResult } from '../fastpath/extract.js';
import { fetchNaverDaily, fetchNaverMinuteBars } from '../charts/naver.js';
import { evaluateGap } from './gap-guard.js';
import { placeBuyOrder, pollFill } from '../execution/order.js';
import { notify } from '../notify/telegram.js';

// 5초 폴링 — 9:00:05 정각 발주 보장 (최악 5초 지연).
// 부담은 거의 없음 (DB 쿼리 1건 + 메모리 비교).
const INTERVAL_MS = 5_000;
let _running = false;
let _timer: NodeJS.Timeout | null = null;

async function fetchPriceSnapshot(market: Market, code: string): Promise<{
  current: number | null;
  prevClose: number | null;
  open: number | null;
}> {
  // 국내만 1차 지원. 해외 시가매매는 v2.
  // 1) KIS 우선 — 실전(real) 환경에서 가장 정확
  let current: number | null = null;
  let prevClose: number | null = null;
  let open: number | null = null;
  try {
    const res = await callKisApi('domestic_stock', 'inquire_price', {
      fid_cond_mrkt_div_code: 'J',
      fid_input_iscd: code,
    });
    const parsed = parseMcpResult(res);
    if (parsed.success) {
      const d = firstOutput(parsed) ?? {};
      current = num(d.stck_prpr);
      prevClose = num(d.stck_sdpr);
      open = num(d.stck_oprc);
    }
  } catch (err) {
    console.warn('[scheduler] KIS inquire_price failed:', (err as Error).message);
  }

  // 2) 부족한 필드만 NAVER로 보강 (모의투자에서 일부 종목 데이터 누락 대응)
  if (!current || !open || !prevClose) {
    try {
      if (!open || !current) {
        const minute = await fetchNaverMinuteBars(code, 1, 5);
        if (minute.length > 0) {
          if (!open) open = minute[0]!.open;
          if (!current) current = minute[minute.length - 1]!.close;
        }
      }
      if (!prevClose) {
        const daily = await fetchNaverDaily(code, 5);
        if (daily.length >= 1) {
          // 오늘 봉 포함 가능성 — KST 기준 today MM/DD와 비교해서 직전 봉 사용
          const kst = new Date(Date.now() + 9 * 3600 * 1000);
          const today = `${String(kst.getUTCMonth() + 1).padStart(2, '0')}/${String(kst.getUTCDate()).padStart(2, '0')}`;
          const last = daily[daily.length - 1]!;
          if (last.time === today && daily.length >= 2) {
            prevClose = daily[daily.length - 2]!.close;
          } else {
            prevClose = last.close;
          }
        }
      }
    } catch (err) {
      console.warn('[scheduler] NAVER fallback failed:', (err as Error).message);
    }
  }
  return { current, prevClose, open };
}

// KIS 정확한 매수가능금액 — inquire_psbl_order 사용.
// 종목+가격 기준 ord_psbl_cash(현금) / max_buy_qty(신용 포함 최대 수량) 받음.
// 응답 구조: data 배열의 첫 row에 한도 정보. firstOutput으로 추출.
async function fetchOrderableCash(code: string, refPrice: number): Promise<number | null> {
  try {
    const r = await callKisApi('domestic_stock', 'inquire_psbl_order', {
      pdno: code,
      ord_unpr: String(Math.round(refPrice)),
      ord_dvsn: '00', // 지정가 기준 (한도 계산이 정확)
    });
    const parsed = parseMcpResult(r);
    if (!parsed.success) return null;
    const o = firstOutput(parsed);
    if (!o) return null;
    // ord_psbl_cash = 100% 현금 주문가능. 신용/미수 안 쓰는 보수적 한도.
    const cash = num(o.ord_psbl_cash);
    return cash && cash > 0 ? cash : null;
  } catch (err) {
    console.warn('[psbl] inquire_psbl_order failed:', (err as Error).message);
    return null;
  }
}

async function fireReservation(rId: string): Promise<void> {
  // 단일 발사 클레임 — 동시 tick에서 중복 발주 방지
  if (!tryClaimReservation(rId)) return;

  // 클레임 후 최신 상태 다시 읽기 (state는 'fired'로 update된 상태)
  const r = getReservation(rId);
  if (!r) return;

  const market = (r.market || 'KRX') as Market;
  if (market !== 'KRX') {
    rejectReservation(r.id, '해외 시가매매 미지원 (v1)');
    await notify(r.chatId, `⚠️ 시가매매 미지원: ${r.symbolName} (해외)`);
    return;
  }

  let snapshot;
  try {
    snapshot = await fetchPriceSnapshot(market, r.symbolCode);
  } catch (err) {
    const msg = (err as Error).message;
    rejectReservation(r.id, `price_fetch:${msg}`);
    await notify(r.chatId, `❌ 시가매매 발주 실패 — 시세 조회 오류: ${msg}`);
    return;
  }
  // 시초가 우선, 없으면 현재가 (개장 직후 시초가 미결정 케이스 대비)
  const ref = snapshot.open ?? snapshot.current;
  if (!ref || ref <= 0) {
    rejectReservation(r.id, 'no_price');
    await notify(r.chatId, `❌ ${r.symbolName} 시초가/현재가 정보 없음 — 발주 취소`);
    return;
  }

  // 갭가드
  if (snapshot.prevClose && snapshot.prevClose > 0) {
    const gap = evaluateGap({
      prevClose: snapshot.prevClose,
      openPrice: ref,
      thresholdPct: r.gapGuardPct,
    });
    if (!gap.ok) {
      rejectReservation(r.id, `gap_guard:${gap.reason}`);
      await notify(
        r.chatId,
        `⚠️ <b>시가매매 취소</b>\n${r.symbolName} (${r.symbolCode})\n전일 종가 ${snapshot.prevClose.toLocaleString()} → 시초가 ${ref.toLocaleString()}\n${gap.reason}`,
      );
      return;
    }
  } // prevClose 없으면 갭가드 패스

  // 수량 재계산
  let qty: number;
  if (r.qtyMode === 'shares') {
    qty = Math.floor(r.qtyValue);
  } else if (r.qtyMode === 'amount') {
    qty = Math.floor(r.qtyValue / ref);
  } else {
    // percent — KIS의 매수가능금액(ord_psbl_cash) 기반
    let cash: number | null = null;
    try {
      cash = await fetchOrderableCash(r.symbolCode, ref);
    } catch (err) {
      console.warn('[scheduler] cash fetch error:', (err as Error).message);
    }
    if (!cash || cash <= 0) {
      rejectReservation(r.id, 'no_cash_info');
      await notify(r.chatId, `❌ ${r.symbolName} — 매수가능금액 0. 발주 취소.`);
      return;
    }
    const budget = (cash * r.qtyValue) / 100;
    qty = Math.floor(budget / ref);
  }

  if (!qty || qty <= 0) {
    rejectReservation(r.id, 'qty_zero');
    await notify(
      r.chatId,
      `❌ ${r.symbolName} 계산 수량 0주 — 발주 취소 (시초가 ${ref.toLocaleString()}원)`,
    );
    return;
  }

  // 발주
  const spec: OrderSpec = {
    action: 'buy',
    market: 'KRX',
    symbol_code: r.symbolCode,
    symbol_name: r.symbolName,
    order_type: 'market',
    quantity: qty,
    tp_pct: r.tpPct,
    sl_pct: r.slPct,
  };

  let positionId: string;
  let orderId: string;
  try {
    const out = await placeBuyOrder({ chatId: r.chatId, spec });
    positionId = out.positionId;
    orderId = out.orderId;
  } catch (err) {
    const msg = (err as Error).message;
    rejectReservation(r.id, `order_failed:${msg}`);
    logTrade({ chatId: r.chatId, kind: 'mo_order_error', payload: { id: r.id, error: msg } });
    await notify(r.chatId, `❌ 시가매매 발주 실패 — ${r.symbolName}: ${msg}`);
    return;
  }
  attachPositionToReservation(r.id, positionId);

  await notify(
    r.chatId,
    `📌 <b>시가매매 발주</b>\n${r.symbolName} (${r.symbolCode})\n시초가 ${ref.toLocaleString()}원 · 수량 ${qty}주\n주문번호 ${orderId} · 체결 확인 중…`,
  );

  // 체결 확인 + 체결가 기준 TP/SL 채우기 (background)
  pollFill({
    chatId: r.chatId,
    positionId,
    market: 'KRX',
    orderId,
    expectedQty: qty,
  })
    .then((fill) => {
      if (!fill.avgPrice) return;
      const avg = fill.avgPrice;
      const tpPrice = r.tpPct ? Math.round(avg * (1 + r.tpPct / 100)) : null;
      const slPrice = r.slPct ? Math.round(avg * (1 - r.slPct / 100)) : null;
      if (tpPrice !== null || slPrice !== null) {
        setPositionTpSl(positionId, tpPrice, slPrice);
        const parts: string[] = [];
        if (tpPrice !== null) parts.push(`TP ${tpPrice.toLocaleString()}원 (+${r.tpPct}%)`);
        if (slPrice !== null) parts.push(`SL ${slPrice.toLocaleString()}원 (-${r.slPct}%)`);
        notify(
          r.chatId,
          `🎯 ${r.symbolName} TP/SL 설정: ${parts.join(' / ')} (체결가 ${avg.toLocaleString()}원 기준)`,
        ).catch(() => {});
      }
    })
    .catch((err) => console.error('[scheduler] pollFill failed', err));
}

async function tick() {
  // awaiting_confirm TTL 만료 처리
  expireOldAwaitingReservations();

  const due = listDueReservations(Date.now());
  if (due.length === 0) return;
  console.log('[scheduler] due reservations:', due.length);
  for (const r of due) {
    try {
      await fireReservation(r.id);
    } catch (err) {
      console.error('[scheduler] fireReservation error', err);
    }
  }
}

export function startScheduler() {
  if (_running) return;
  _running = true;
  console.log('[scheduler] starting polling every', INTERVAL_MS / 1000, 's');
  _timer = setInterval(() => {
    tick().catch((err) => console.error('[scheduler] tick failed', err));
  }, INTERVAL_MS);
}

export function stopScheduler() {
  _running = false;
  if (_timer) clearInterval(_timer);
  _timer = null;
}
