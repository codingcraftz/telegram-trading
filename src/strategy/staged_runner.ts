// morning_staged 전략 전용 runner. B3 (1차) + B4 (2차/TP/SL).
//
// 상태 (runtimeJson):
//   phase: 'pending'           — 아직 1차 매수 전
//   phase: 'stage1_filled'     — 1차 체결. 2차 대기 / TP1 / TP2 / SL 감시
//   phase: 'stage2_filled'     — 2차도 체결 (평단 재계산 완료)
//   phase: 'tp1_done'          — TP1 부분매도 완료 (잔량으로 TP2/SL 감시)
//   phase: 'completed'         — 전량 매도 (TP2 또는 SL 도달)
//
// 동시성: runner는 단일 worker 루프에서 직렬 호출되므로 락 불필요.

import { callKisApi } from '../mcp/kis.js';
import { firstOutput, num, parseMcpResult, checkKisOk } from '../fastpath/extract.js';
import { invalidate as invalidateCache } from '../fastpath/cache.js';
import { placeBuyOrder, pollFill } from '../execution/order.js';
import { placeOrder } from '../mcp/kis.js';
import { notify } from '../notify/telegram.js';
import { getMarketSession } from '../scheduler/calendar.js';
import { setPositionTpSl, type OrderSpec } from '../db/repo.js';
import { getStrategyById } from '../db/repo/strategies.js';
import {
  setApplicationRuntime,
  touchLastEvaluated,
  updateApplicationStatus,
} from '../db/repo/strategy_applications.js';
import { createExecution } from '../db/repo/strategy_executions.js';
import { StrategyDefinitionSchema, type StrategyDefinition } from './schema.js';
import type { StrategyApplication } from '../db/schema.js';

export type StagedRuntime = {
  /**
   * stage1_firing / stage2_firing — 발주는 보냈지만 체결 콜백 전 (락 상태).
   * 다음 tick 에서 같은 phase 보이면 idempotent skip.
   */
  phase:
    | 'pending'
    | 'stage1_firing'
    | 'stage1_filled'
    | 'stage2_firing'
    | 'stage2_filled'
    | 'tp1_done'
    | 'completed';
  /** 1차 체결 정보 */
  stage1?: { qty: number; avgPrice: number; orderId: string; positionId: string; filledAt: number };
  /** 2차 체결 정보 (있다면) */
  stage2?: { qty: number; avgPrice: number; orderId: string; positionId: string; filledAt: number };
  /** TP1 부분 매도 정보 */
  tp1Sell?: { qty: number; orderId: string; soldAt: number };
};

function parseRuntime(json: string | null): StagedRuntime {
  if (!json) return { phase: 'pending' };
  try {
    const r = JSON.parse(json);
    if (r && typeof r === 'object' && typeof r.phase === 'string') return r as StagedRuntime;
  } catch {
    // ignore
  }
  return { phase: 'pending' };
}

function parseDefinition(json: string): StrategyDefinition | null {
  try {
    const parsed = JSON.parse(json);
    const validated = StrategyDefinitionSchema.safeParse(parsed);
    return validated.success ? validated.data : null;
  } catch {
    return null;
  }
}

function isStagedDef(def: StrategyDefinition): boolean {
  return def.entry.type === 'morning_staged';
}

function kstHMS(ts: number): { h: number; m: number; s: number } {
  const k = new Date(ts + 9 * 3600 * 1000);
  return { h: k.getUTCHours(), m: k.getUTCMinutes(), s: k.getUTCSeconds() };
}

function inMorningWindow(ts: number): boolean {
  const t = kstHMS(ts);
  return t.h === 9 && t.m === 0 && t.s <= 30;
}

async function fetchPrice(code: string): Promise<{ current: number } | null> {
  try {
    const r = await callKisApi('domestic_stock', 'inquire_price', {
      fid_cond_mrkt_div_code: 'J',
      fid_input_iscd: code,
    });
    const parsed = parseMcpResult(r);
    if (!parsed.success) return null;
    const o = firstOutput(parsed);
    if (!o) return null;
    const current = num(o.stck_prpr);
    if (!current || current <= 0) return null;
    return { current };
  } catch {
    return null;
  }
}

async function fetchOrderableCash(code: string, refPrice: number): Promise<number | null> {
  try {
    const r = await callKisApi('domestic_stock', 'inquire_psbl_order', {
      pdno: code,
      ord_unpr: String(Math.round(refPrice)),
      ord_dvsn: '00',
    });
    const parsed = parseMcpResult(r);
    if (!parsed.success) return null;
    const o = firstOutput(parsed);
    if (!o) return null;
    const cash = num(o.ord_psbl_cash);
    return cash && cash > 0 ? cash : null;
  } catch {
    return null;
  }
}

/** budget 결정 우선순위: (1) application.budgetAmount (사용자가 매수 시점 입력) →
 *  (2) strategy.budget — fixed_amount 그대로 / cash_ratio 면 매수가능금액 비율. */
function resolveBudget(
  def: Extract<StrategyDefinition['entry'], { type: 'morning_staged' }>,
  cash: number,
  appOverride: number | null,
): number {
  if (appOverride && appOverride > 0) return appOverride;
  if (def.budget.mode === 'fixed_amount') return def.budget.value;
  return cash * def.budget.value;
}

/** application 1건 처리 — phase 에 따라 분기. */
export async function processStagedApplication(app: StrategyApplication): Promise<void> {
  const strat = getStrategyById(app.strategyId, app.chatId);
  if (!strat || !strat.active) return;
  const def = parseDefinition(strat.definition);
  if (!def || !isStagedDef(def)) return;
  if (def.entry.type !== 'morning_staged') return; // narrowing
  const entry = def.entry;

  const runtime = parseRuntime(app.runtimeJson);
  const now = Date.now();
  const session = getMarketSession();

  switch (runtime.phase) {
    case 'pending':
      // 1차 진입 — 시가 윈도우 안에서만
      if (session !== 'regular' || !inMorningWindow(now)) return;
      await fireStage1(app, strat, entry, def, now);
      return;
    case 'stage1_firing':
    case 'stage2_firing':
      // 발주는 보냈으나 체결 콜백 전 — 중복 발주 방지 락. tick skip.
      return;
    case 'stage1_filled':
      // 2차 트리거 감시 + TP1/SL 감시 (정규장에서만)
      if (session !== 'regular') return;
      await monitorStage1(app, strat, entry, def, runtime, now);
      return;
    case 'stage2_filled':
    case 'tp1_done':
      if (session !== 'regular') return;
      await monitorExit(app, strat, entry, def, runtime, now);
      return;
    case 'completed':
      // 전량 매도 완료 — 응용에서 completed 처리됐어야. 안전망.
      updateApplicationStatus(app.id, app.chatId, 'completed');
      return;
  }
}

async function fireStage1(
  app: StrategyApplication,
  strat: { id: string; name: string },
  entry: Extract<StrategyDefinition['entry'], { type: 'morning_staged' }>,
  def: StrategyDefinition,
  now: number,
): Promise<void> {
  const price = await fetchPrice(app.stockCode);
  if (!price) return;

  // 매수가능금액 → 예산 → 1차 비율 적용 → 수량
  const cash = (await fetchOrderableCash(app.stockCode, price.current)) ?? 0;
  if (cash <= 0) {
    updateApplicationStatus(app.id, app.chatId, 'failed');
    return;
  }
  const budget = Math.min(resolveBudget(entry, cash, app.budgetAmount), cash);
  const stage1Pct = entry.stages[0]!.entryPct;
  const stage1Budget = (budget * stage1Pct) / 100;
  const qty = Math.floor(stage1Budget / price.current);
  if (qty < 1) {
    updateApplicationStatus(app.id, app.chatId, 'failed');
    return;
  }

  const spec: OrderSpec = {
    action: 'buy',
    market: 'KRX',
    symbol_code: app.stockCode,
    symbol_name: app.stockCode,
    order_type: 'market',
    quantity: qty,
    tp_pct: null, // staged 는 TP/SL 가격을 평단 기준으로 별도 계산. 여기선 null.
    sl_pct: null,
  };

  // 락 — 다음 tick(5초 후)이 같은 'pending' 으로 보고 또 발주하지 못하도록.
  // 발주 실패 시 'failed' 로 마킹해 그날 재시도 차단 (다음날 사용자가 수동 활성화 필요).
  setApplicationRuntime(app.id, app.chatId, { phase: 'stage1_firing' } satisfies StagedRuntime);

  let positionId: string;
  let orderId: string;
  try {
    const out = await placeBuyOrder({ chatId: app.chatId, spec });
    positionId = out.positionId;
    orderId = out.orderId;
  } catch (err) {
    const msg = (err as Error).message;
    createExecution({
      strategyId: strat.id,
      applicationId: app.id,
      chatId: app.chatId,
      stockCode: app.stockCode,
      action: 'buy',
      result: 'failure',
      errorMessage: msg,
      payload: { stage: 1, qty },
    });
    updateApplicationStatus(app.id, app.chatId, 'failed');
    return;
  }

  // 체결 알림은 pollFill 내부의 매수 체결 알림이 자동 송신
  pollFill({
    chatId: app.chatId,
    positionId,
    market: 'KRX',
    orderId,
    expectedQty: qty,
    symbolName: app.stockCode,
    note: `[전략 ${strat.name}] 1차`,
  })
    .then((fill) => {
      if (!fill.avgPrice || fill.filled <= 0) {
        updateApplicationStatus(app.id, app.chatId, 'failed');
        return;
      }
      const actualQty = fill.filled;
      const rt: StagedRuntime = {
        phase: 'stage1_filled',
        stage1: { qty: actualQty, avgPrice: fill.avgPrice, orderId, positionId, filledAt: Date.now() },
      };
      setApplicationRuntime(app.id, app.chatId, rt);
      touchLastEvaluated(app.id, app.chatId, Date.now());
      createExecution({
        strategyId: strat.id,
        applicationId: app.id,
        chatId: app.chatId,
        stockCode: app.stockCode,
        action: 'buy',
        result: 'success',
        payload: { stage: 1, requestedQty: qty, actualQty, avgPrice: fill.avgPrice, orderId },
      });
    })
    .catch((err) => console.error('[staged] pollFill stage1 failed', err));
}

// ====== 매도 발주 (시장가 단일 helper) ======
// 시장가 매도는 99% 즉시 체결되므로 체결 폴링 생략, 발주 성공만 확인.
async function placeMarketSell(code: string, qty: number): Promise<{ ok: true; orderId: string } | { ok: false; error: string }> {
  try {
    const r = await placeOrder({ market: 'KRX', side: 'sell', code, quantity: qty, orderType: 'market' });
    const parsed = parseMcpResult(r);
    const kisOk = checkKisOk(parsed);
    if (!kisOk.ok) return { ok: false, error: kisOk.message ?? 'KIS 거절' };
    const out = firstOutput(parsed);
    const orderId = String(out?.ODNO ?? out?.odno ?? `unknown-${Date.now()}`);
    // 매도 발주 시점 캐시 무효화 — 클라이언트 다음 폴링이 fresh 받음.
    // (시장가는 즉시 체결 가정 — pending/filled/balance 모두 영향)
    invalidateCache('pending:raw');
    invalidateCache('filled:');
    invalidateCache('balance:raw');
    invalidateCache('holdings');
    return { ok: true, orderId };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// 1차 체결 후: SL > TP1 > stage2 trigger 우선순위로 감시.
async function monitorStage1(
  app: StrategyApplication,
  strat: { id: string; name: string },
  entry: Extract<StrategyDefinition['entry'], { type: 'morning_staged' }>,
  _def: StrategyDefinition,
  runtime: StagedRuntime,
  now: number,
): Promise<void> {
  if (!runtime.stage1) return;
  const s1 = runtime.stage1;

  const price = await fetchPrice(app.stockCode);
  if (!price) return;
  const cur = price.current;
  const avg1 = s1.avgPrice;

  // SL — 평단(여기선 1차 평단만 있음) 기준
  if (entry.stopLoss?.enabled && cur <= avg1 * (1 - entry.stopLoss.atPct / 100)) {
    const r = await placeMarketSell(app.stockCode, s1.qty);
    if (!r.ok) {
      console.warn('[staged] SL sell failed', r.error);
      return;
    }
    createExecution({
      strategyId: strat.id, applicationId: app.id, chatId: app.chatId,
      stockCode: app.stockCode, action: 'sell', result: 'success',
      payload: { reason: 'SL', qty: s1.qty, price: cur, orderId: r.orderId },
    });
    await notify(
      app.chatId,
      `✅ <b>매도 체결</b> ${app.stockCode} 🛑 SL\n${cur.toLocaleString()}원 × ${s1.qty}주\n[전략 ${strat.name}]`,
    );
    setApplicationRuntime(app.id, app.chatId, { ...runtime, phase: 'completed' } satisfies StagedRuntime);
    updateApplicationStatus(app.id, app.chatId, 'completed');
    return;
  }

  // TP1 — 평단 대비 +atPct → sellPct 부분매도. 2차는 자동 캔슬 (= 트리거 무시)
  const tp1 = entry.takeProfit?.tp1;
  if (tp1?.enabled && cur >= avg1 * (1 + tp1.atPct / 100)) {
    const sellQty = Math.max(1, Math.floor((s1.qty * tp1.sellPct) / 100));
    const r = await placeMarketSell(app.stockCode, sellQty);
    if (!r.ok) {
      console.warn('[staged] TP1 sell failed', r.error);
      return;
    }
    createExecution({
      strategyId: strat.id, applicationId: app.id, chatId: app.chatId,
      stockCode: app.stockCode, action: 'sell', result: 'success',
      payload: { reason: 'TP1', qty: sellQty, price: cur, orderId: r.orderId },
    });
    await notify(
      app.chatId,
      `✅ <b>매도 체결</b> ${app.stockCode} 💰 TP1\n${cur.toLocaleString()}원 × ${sellQty}주\n[전략 ${strat.name}] 2차 진입 캔슬`,
    );
    const nextRuntime: StagedRuntime = {
      ...runtime,
      phase: 'tp1_done',
      tp1Sell: { qty: sellQty, orderId: r.orderId, soldAt: now },
    };
    setApplicationRuntime(app.id, app.chatId, nextRuntime);

    // TP2 미설정이거나 sellPct=100 이면 전량 매도 완료
    const remaining = s1.qty - sellQty;
    if (!entry.takeProfit?.tp2?.enabled || remaining <= 0) {
      setApplicationRuntime(app.id, app.chatId, { ...nextRuntime, phase: 'completed' } satisfies StagedRuntime);
      updateApplicationStatus(app.id, app.chatId, 'completed');
    }
    return;
  }

  // stage2 트리거 — 2단계 정의되어 있고 현재가가 (1차 평단 - triggerDropPct%) 이하면 추가 매수
  const stage2 = entry.stages[1];
  if (stage2 && stage2.triggerDropPct) {
    const trigPrice = avg1 * (1 - stage2.triggerDropPct / 100);
    if (cur <= trigPrice) {
      await fireStage2(app, strat, entry, runtime, cur);
    }
  }
}

async function fireStage2(
  app: StrategyApplication,
  strat: { id: string; name: string },
  entry: Extract<StrategyDefinition['entry'], { type: 'morning_staged' }>,
  runtime: StagedRuntime,
  currentPrice: number,
): Promise<void> {
  if (!runtime.stage1) return;

  // 2차 예산 — budget × stage2.entryPct / 100. 매수가능금액으로 제한.
  const cash = (await fetchOrderableCash(app.stockCode, currentPrice)) ?? 0;
  if (cash <= 0) return;
  const baseBudget = Math.min(resolveBudget(entry, cash, app.budgetAmount), cash);
  const stage2Pct = entry.stages[1]!.entryPct;
  const budget = (baseBudget * stage2Pct) / 100;
  const qty = Math.floor(budget / currentPrice);
  if (qty < 1) return;

  const spec: OrderSpec = {
    action: 'buy', market: 'KRX',
    symbol_code: app.stockCode, symbol_name: app.stockCode,
    order_type: 'market', quantity: qty, tp_pct: null, sl_pct: null,
  };

  // 락 — stage1_filled 채로 다음 tick 또 fireStage2 트리거하지 않도록.
  // 발주 실패 시 stage1_filled 로 복귀 (잠시 후 자동 재시도 — trigger 조건 여전히 충족)
  setApplicationRuntime(app.id, app.chatId, { ...runtime, phase: 'stage2_firing' } satisfies StagedRuntime);

  let positionId: string;
  let orderId: string;
  try {
    const out = await placeBuyOrder({ chatId: app.chatId, spec });
    positionId = out.positionId;
    orderId = out.orderId;
  } catch (err) {
    console.warn('[staged] stage2 order error', (err as Error).message);
    setApplicationRuntime(app.id, app.chatId, runtime); // 락 해제 → 다음 tick 재시도
    return;
  }

  // 체결 알림은 pollFill 내부의 매수 체결 알림이 자동 송신
  pollFill({
    chatId: app.chatId,
    positionId,
    market: 'KRX',
    orderId,
    expectedQty: qty,
    symbolName: app.stockCode,
    note: `[전략 ${strat.name}] 2차`,
  })
    .then((fill) => {
      if (!fill.avgPrice || fill.filled <= 0) {
        // 2차 체결 실패 — stage1_filled 로 되돌리고 trigger 재평가
        setApplicationRuntime(app.id, app.chatId, runtime);
        return;
      }
      const actualQty = fill.filled;
      const next: StagedRuntime = {
        ...runtime,
        phase: 'stage2_filled',
        stage2: { qty: actualQty, avgPrice: fill.avgPrice, orderId, positionId, filledAt: Date.now() },
      };
      setApplicationRuntime(app.id, app.chatId, next);
      createExecution({
        strategyId: strat.id, applicationId: app.id, chatId: app.chatId,
        stockCode: app.stockCode, action: 'buy', result: 'success',
        payload: { stage: 2, requestedQty: qty, actualQty, avgPrice: fill.avgPrice, orderId },
      });
    })
    .catch((err) => console.error('[staged] pollFill stage2 failed', err));
}

// stage2_filled / tp1_done 공통: 잔량 기준 TP/SL 감시.
async function monitorExit(
  app: StrategyApplication,
  strat: { id: string; name: string },
  entry: Extract<StrategyDefinition['entry'], { type: 'morning_staged' }>,
  _def: StrategyDefinition,
  runtime: StagedRuntime,
  now: number,
): Promise<void> {
  if (!runtime.stage1) return;
  const s1 = runtime.stage1;
  const s2 = runtime.stage2;
  const totalBoughtQty = s1.qty + (s2?.qty ?? 0);
  const totalBoughtCost = s1.qty * s1.avgPrice + (s2 ? s2.qty * s2.avgPrice : 0);
  const avg = totalBoughtCost / totalBoughtQty;
  const soldQty = runtime.tp1Sell?.qty ?? 0;
  const remaining = totalBoughtQty - soldQty;
  if (remaining <= 0) {
    setApplicationRuntime(app.id, app.chatId, { ...runtime, phase: 'completed' } satisfies StagedRuntime);
    updateApplicationStatus(app.id, app.chatId, 'completed');
    return;
  }

  const price = await fetchPrice(app.stockCode);
  if (!price) return;
  const cur = price.current;

  // SL — 평단 기준
  if (entry.stopLoss?.enabled && cur <= avg * (1 - entry.stopLoss.atPct / 100)) {
    const r = await placeMarketSell(app.stockCode, remaining);
    if (!r.ok) { console.warn('[staged] SL exit fail', r.error); return; }
    createExecution({
      strategyId: strat.id, applicationId: app.id, chatId: app.chatId,
      stockCode: app.stockCode, action: 'sell', result: 'success',
      payload: { reason: 'SL_exit', qty: remaining, price: cur, orderId: r.orderId, avg },
    });
    await notify(
      app.chatId,
      `✅ <b>매도 체결</b> ${app.stockCode} 🛑 SL\n${cur.toLocaleString()}원 × ${remaining}주\n[전략 ${strat.name}] 평단 ${Math.round(avg).toLocaleString()}원`,
    );
    setApplicationRuntime(app.id, app.chatId, { ...runtime, phase: 'completed' } satisfies StagedRuntime);
    updateApplicationStatus(app.id, app.chatId, 'completed');
    return;
  }

  // TP2 — 잔량 전량 매도
  const tp2 = entry.takeProfit?.tp2;
  if (tp2?.enabled && cur >= avg * (1 + tp2.atPct / 100)) {
    const r = await placeMarketSell(app.stockCode, remaining);
    if (!r.ok) { console.warn('[staged] TP2 sell fail', r.error); return; }
    createExecution({
      strategyId: strat.id, applicationId: app.id, chatId: app.chatId,
      stockCode: app.stockCode, action: 'sell', result: 'success',
      payload: { reason: 'TP2', qty: remaining, price: cur, orderId: r.orderId, avg },
    });
    await notify(
      app.chatId,
      `✅ <b>매도 체결</b> ${app.stockCode} 💰 TP2\n${cur.toLocaleString()}원 × ${remaining}주\n[전략 ${strat.name}]`,
    );
    setApplicationRuntime(app.id, app.chatId, { ...runtime, phase: 'completed' } satisfies StagedRuntime);
    updateApplicationStatus(app.id, app.chatId, 'completed');
    return;
  }

  // tp1_done이 아니고 stage2_filled 상태에서 TP1 도달 (1차 체결 직후엔 못 도달하다가 2차 체결 후 평단 변동으로 새로 닿는 경우)
  if (runtime.phase === 'stage2_filled' && entry.takeProfit?.tp1?.enabled) {
    const tp1 = entry.takeProfit.tp1;
    if (cur >= avg * (1 + tp1.atPct / 100)) {
      const sellQty = Math.max(1, Math.floor((remaining * tp1.sellPct) / 100));
      const r = await placeMarketSell(app.stockCode, sellQty);
      if (!r.ok) { console.warn('[staged] TP1 (post-stage2) sell fail', r.error); return; }
      createExecution({
        strategyId: strat.id, applicationId: app.id, chatId: app.chatId,
        stockCode: app.stockCode, action: 'sell', result: 'success',
        payload: { reason: 'TP1_post_stage2', qty: sellQty, price: cur, orderId: r.orderId, avg },
      });
      await notify(
        app.chatId,
        `✅ <b>매도 체결</b> ${app.stockCode} 💰 TP1\n${cur.toLocaleString()}원 × ${sellQty}주\n[전략 ${strat.name}]`,
      );
      const next: StagedRuntime = {
        ...runtime,
        phase: 'tp1_done',
        tp1Sell: { qty: sellQty, orderId: r.orderId, soldAt: now },
      };
      setApplicationRuntime(app.id, app.chatId, next);
      // TP2 비활성이거나 잔량 0이면 완료
      if (!tp2?.enabled || (remaining - sellQty) <= 0) {
        setApplicationRuntime(app.id, app.chatId, { ...next, phase: 'completed' } satisfies StagedRuntime);
        updateApplicationStatus(app.id, app.chatId, 'completed');
      }
    }
  }
}
