// 시가매매 예약 발주 스케줄러.
// 60초 간격 폴링: state='pending' AND scheduledFor <= now 인 예약 1회 발주.
// 발주 흐름:
//   1) tryClaimReservation으로 단일 발사 클레임
//   2) 시초가 조회 (없으면 현재가) — 수량 계산용
//   3) 수량 모드별 재계산
//   4) placeBuyOrder + pollFill
//   5) 체결되면 시장가 평균 기준으로 TP/SL 가격 update

import {
  attachPositionToReservation,
  expireOldAwaitingReservations,
  getReservation,
  listDueReservations,
  listPendingPositions,
  logTrade,
  markPositionFailed,
  rejectReservation,
  rescheduleReservation,
  setPositionTpSl,
  tryClaimReservation,
  type OrderSpec,
} from '../db/repo.js';
import { callKisApi, type Market } from '../mcp/kis.js';
import { firstOutput, num, parseMcpResult } from '../fastpath/extract.js';
import { fetchNaverDaily, fetchNaverMinuteBars } from '../charts/naver.js';
import { placeBuyOrder, pollFill } from '../execution/order.js';
import { nextMarketOpen } from './calendar.js';
import { isHoliday, prefetchHolidays } from './holidays.js';
import { evaluateAndFireStrategies } from '../strategy/runner.js';
import { getMarketSession } from './calendar.js';
import {
  listAllActiveApplications,
  updateApplicationStatus,
} from '../db/repo/strategy_applications.js';
import { createExecution } from '../db/repo/strategy_executions.js';
import { runAndSave as collectHotStocks } from '../jobs/hot-stocks.js';

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
    return;
  }

  let snapshot;
  try {
    snapshot = await fetchPriceSnapshot(market, r.symbolCode);
  } catch (err) {
    const msg = (err as Error).message;
    rejectReservation(r.id, `price_fetch:${msg}`);
    return;
  }
  const ref = snapshot.open ?? snapshot.current;
  if (!ref || ref <= 0) {
    rejectReservation(r.id, 'no_price');
    return;
  }

  // 갭가드 제거됨 — 시초가가 크게 벌어져도 그대로 발주 (사용자 요청)

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
      return;
    }
    const budget = (cash * r.qtyValue) / 100;
    qty = Math.floor(budget / ref);
  }

  if (!qty || qty <= 0) {
    rejectReservation(r.id, 'qty_zero');
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
    // KIS가 "휴장" / "거래정지" / "장 종료" 등으로 거부한 경우 자동으로 다음 영업일로 연기
    if (/휴장|거래정지|거래 정지|장.*종료|장.*마감/.test(msg)) {
      const next = nextMarketOpen(new Date());
      const ok = rescheduleReservation(r.id, next.getTime());
      logTrade({ chatId: r.chatId, kind: 'mo_rescheduled', payload: { id: r.id, reason: 'kis_reject_holiday', error: msg, newScheduledFor: next.getTime() } });
      if (ok > 0) return;
    }
    rejectReservation(r.id, `order_failed:${msg}`);
    logTrade({ chatId: r.chatId, kind: 'mo_order_error', payload: { id: r.id, error: msg } });
    return;
  }
  attachPositionToReservation(r.id, positionId);

  // 체결 확인 + 체결가 기준 TP/SL 채우기 (background)
  // 알림은 pollFill 내부의 매수 체결 알림이 자동 송신 (사용자 정책: 체결만)
  pollFill({
    chatId: r.chatId,
    positionId,
    market: 'KRX',
    orderId,
    expectedQty: qty,
    symbolName: r.symbolName,
    note: '시가매매',
  })
    .then((fill) => {
      if (!fill.avgPrice) return;
      const avg = fill.avgPrice;
      const tpPrice = r.tpPct ? Math.round(avg * (1 + r.tpPct / 100)) : null;
      const slPrice = r.slPct ? Math.round(avg * (1 - r.slPct / 100)) : null;
      if (tpPrice !== null || slPrice !== null) {
        setPositionTpSl(positionId, tpPrice, slPrice);
      }
    })
    .catch((err) => console.error('[scheduler] pollFill failed', err));
}

// 매일 KST 03:00 휴장일 재 prefetch — 마지막 실행이 24h 이상 전이고 현재 KST 03:00~03:05이면 트리거
let _lastHolidayPrefetch = Date.now();
async function maybePrefetchHolidays() {
  const now = Date.now();
  if (now - _lastHolidayPrefetch < 23 * 3600 * 1000) return;
  const KST = new Date(now + 9 * 3600 * 1000);
  const h = KST.getUTCHours();
  const m = KST.getUTCMinutes();
  if (h === 3 && m < 5) {
    _lastHolidayPrefetch = now;
    console.log('[scheduler] daily holiday prefetch');
    await prefetchHolidays(60).catch((err) =>
      console.warn('[scheduler] holiday prefetch failed:', (err as Error).message),
    );
  }
}

async function tick() {
  // 매일 03:00 KST 휴장일 재 prefetch
  await maybePrefetchHolidays();

  // awaiting_confirm TTL 만료 처리
  expireOldAwaitingReservations();

  const due = listDueReservations(Date.now());
  if (due.length === 0) return;

  // 오늘이 휴장일이면 due 예약을 일괄로 다음 영업일로 재예약 (발사 없음)
  const now = new Date();
  if (isHoliday(now)) {
    const nextOpen = nextMarketOpen(now);
    for (const r of due) {
      const ok = rescheduleReservation(r.id, nextOpen.getTime());
      if (ok > 0) {
        logTrade({
          chatId: r.chatId,
          kind: 'mo_rescheduled',
          payload: { id: r.id, reason: 'holiday', newScheduledFor: nextOpen.getTime() },
        });
      }
    }
    return;
  }

  console.log('[scheduler] due reservations:', due.length);
  for (const r of due) {
    try {
      await fireReservation(r.id);
    } catch (err) {
      console.error('[scheduler] fireReservation error', err);
    }
  }
}

// ━━━ 장마감 전략 폐기 ━━━
// 15:30 이후(close_auction/post_extended/closed) active 전략 전부 completed 처리.
// 보유 종목은 건드리지 않음 — 매도는 사용자 수동.
// 하루 1회만 실행 (날짜 기록).
let _lastCleanupDate = '';

function maybeCleanupStrategies() {
  const session = getMarketSession();
  if (session !== 'close_auction' && session !== 'post_extended' && session !== 'after_single' && session !== 'closed') return;

  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const today = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`;
  // 장 시작 전 closed(새벽)에는 실행 안 함 — 15시 이후만
  if (kst.getUTCHours() < 15) return;
  if (_lastCleanupDate === today) return;
  _lastCleanupDate = today;

  // HOT 종목 수집 (비동기, 전략 유무와 무관하게 매일 실행)
  collectHotStocks().catch(err => console.error('[scheduler] hot-stocks collect failed:', err));

  // 미체결 지정가 주문 정리 — 장마감 시 pending 포지션 전부 failed 처리
  const pendings = listPendingPositions();
  for (const p of pendings) {
    markPositionFailed(p.id);
    logTrade({ chatId: p.chatId, positionId: p.id, kind: 'limit_market_close', payload: { date: today } });
  }
  if (pendings.length > 0) {
    console.log(`[scheduler] market close — ${pendings.length} pending limit orders → failed`);
  }

  const apps = listAllActiveApplications();
  if (apps.length === 0) return;

  console.log(`[scheduler] market close cleanup — ${apps.length} active strategies → completed`);

  for (const app of apps) {
    try {
      createExecution({
        strategyId: app.strategyId,
        applicationId: app.id,
        chatId: app.chatId,
        stockCode: app.stockCode,
        action: 'buy',
        result: 'failure',
        errorMessage: '장마감 — 전략 자동 폐기 (보유 종목 유지)',
        payload: { reason: 'market_close_cleanup', date: today },
      });
      updateApplicationStatus(app.id, app.chatId, 'completed');
    } catch (err) {
      console.error('[scheduler] cleanup error', app.id, err);
    }
  }
}

// tick 마다 reservation 처리 후 추가로 strategy_applications 평가.
// runner 가 실패해도 reservation 흐름은 영향 없음.
// MUTEX: 이전 tick 이 끝나기 전(KIS API 지연 등) 다음 tick 이 시작하면
// 같은 application 의 fireStage1 가 동시 진입해 매수 중복 발주가 가능.
// 한 번에 하나만 실행되도록 in-flight flag 로 락.
let _strategyTickInFlight = false;
async function tickStrategies() {
  if (_strategyTickInFlight) return;
  _strategyTickInFlight = true;
  try {
    await evaluateAndFireStrategies();
  } catch (err) {
    console.error('[scheduler] strategy runner error', err);
  } finally {
    _strategyTickInFlight = false;
  }
}

// reservation tick 도 동일 락 적용.
let _reservationTickInFlight = false;
async function tickReservationsLocked() {
  if (_reservationTickInFlight) return;
  _reservationTickInFlight = true;
  try {
    await tick();
  } catch (err) {
    console.error('[scheduler] reservation tick failed', err);
  } finally {
    _reservationTickInFlight = false;
  }
}

export function startScheduler() {
  if (_running) return;
  _running = true;
  console.log('[scheduler] starting polling every', INTERVAL_MS / 1000, 's');
  _timer = setInterval(() => {
    tickReservationsLocked();
    tickStrategies();
    maybeCleanupStrategies();
  }, INTERVAL_MS);
}

export function stopScheduler() {
  _running = false;
  if (_timer) clearInterval(_timer);
  _timer = null;
}
