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
import { firstOutput, num, outputDict, outputList, parseMcpResult, checkKisOk } from '../fastpath/extract.js';
import { cached, invalidate as invalidateCache } from '../fastpath/cache.js';
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
import { fetchInternalPendingBuyAmount, fetchPendingBuyAmount } from '../fastpath/pending_cash.js';
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
  /** apply 시점에 미리 계산된 수량 — 있으면 09:00에 시세/잔고 조회 없이 바로 발주. */
  precomputedQty?: { stage1: number; stage2?: number };
  /** 1차 체결 정보 */
  stage1?: { qty: number; avgPrice: number; orderId: string; positionId: string; filledAt: number };
  /** 2차 체결 정보 (있다면) */
  stage2?: { qty: number; avgPrice: number; orderId: string; positionId: string; filledAt: number };
  /** TP1 부분 매도 정보 */
  tp1Sell?: { qty: number; orderId: string; soldAt: number };
  /** phantom holding 검사에서 KIS 가 0 답한 연속 횟수. N회 누적 시 진짜 phantom. */
  phantomMisses?: number;
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
  // QA/리허설 용 — STAGED_WINDOW_OVERRIDE=HH:MM 설정 시 그 시각 ±30초 사용.
  // 평소엔 09:00:00 ~ 09:00:30 (정규 시가 윈도우).
  const override = process.env.STAGED_WINDOW_OVERRIDE;
  if (override) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(override.trim());
    if (m) {
      const oh = Number(m[1]);
      const om = Number(m[2]);
      return t.h === oh && t.m === om && t.s <= 30;
    }
  }
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

async function fetchOrderableCash(code: string, refPrice: number, chatId: number): Promise<number | null> {
  let rawCash: number | null = null;
  let usedPsblOrder = false;
  // 1차: 종목+가격 기준 inquire_psbl_order. refPrice=0이면 skip (balance 직행).
  if (refPrice > 0) {
    try {
      const r = await callKisApi('domestic_stock', 'inquire_psbl_order', {
        pdno: code,
        ord_unpr: String(Math.round(refPrice)),
        ord_dvsn: '00',
      });
      const parsed = parseMcpResult(r);
      if (parsed.success) {
        const o = firstOutput(parsed);
        const cash = num(o?.ord_psbl_cash);
        if (cash && cash > 0) {
          rawCash = cash;
          usedPsblOrder = true;
        }
      }
    } catch { /* fall through to balance fallback */ }
  }
  // 2차 fallback: warmup이 30초마다 갱신하는 balance:raw 캐시 활용 (추가 API 호출 없음).
  // 캐시 miss 시에만 fresh 호출.
  if (!rawCash) {
    try {
      const r = await cached('balance:raw', 60_000, () =>
        callKisApi('domestic_stock', 'inquire_balance', {}),
      );
      const parsed = parseMcpResult(r);
      if (!parsed.success) return null;
      const summary = outputDict(parsed, 'output2');
      rawCash = num(summary?.prvs_rcdl_excc_amt) ?? num(summary?.dnca_tot_amt) ?? null;
    } catch { return null; }
  }
  if (!rawCash || rawCash <= 0) return null;
  // inquire_psbl_order 는 KIS 미체결 주문을 이미 차감 → 내부 예약만 빼면 됨.
  // inquire_balance fallback 은 pending 미반영 → 전체(KIS pending + 내부 예약) 차감.
  if (usedPsblOrder) {
    const pending = fetchInternalPendingBuyAmount(chatId);
    if (pending > 0) rawCash = Math.max(0, rawCash - pending);
  } else {
    const pending = await fetchPendingBuyAmount(chatId);
    if (pending > 0) rawCash = Math.max(0, rawCash - pending);
  }
  return rawCash > 0 ? rawCash : null;
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

/** 동시호가 중 예상체결가로 precomputedQty 갱신 — 5초 tick마다 호출되지만
 *  KIS rate limit 보호를 위해 종목별 마지막 갱신 후 30초 이내면 skip. */
const _refreshTsMap = new Map<string, number>();
async function refreshPrecomputedQty(
  app: StrategyApplication,
  entry: Extract<StrategyDefinition['entry'], { type: 'morning_staged' }>,
  runtime: StagedRuntime,
): Promise<void> {
  const now = Date.now();
  if (now - (_refreshTsMap.get(app.id) ?? 0) < 30_000) return;
  _refreshTsMap.set(app.id, now);

  const price = await fetchPrice(app.stockCode);
  if (!price) return;

  const budget = app.budgetAmount!;
  const stages = entry.stages;
  const s1Pct = stages[0]?.entryPct ?? 100;
  const s2Pct = stages[1]?.entryPct ?? 0;
  const newQty: StagedRuntime['precomputedQty'] = {
    stage1: Math.floor((budget * s1Pct) / 100 / price.current),
    ...(s2Pct > 0 ? { stage2: Math.floor((budget * s2Pct) / 100 / price.current) } : {}),
  };

  const old = runtime.precomputedQty;
  if (old && old.stage1 === newQty.stage1 && (old.stage2 ?? 0) === (newQty.stage2 ?? 0)) return;

  setApplicationRuntime(app.id, app.chatId, { ...runtime, precomputedQty: newQty });
  console.log(`[staged] refreshed qty ${app.stockCode}: s1=${newQty.stage1} s2=${newQty.stage2 ?? '-'} (price=${price.current})`);
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
      if (entry.triggerMode === 'immediate') return;
      // 동시호가(08:40~09:00) — 예상체결가로 precomputedQty 갱신
      if (session === 'pre_auction' && runtime.precomputedQty && app.budgetAmount) {
        await refreshPrecomputedQty(app, entry, runtime);
        return;
      }
      // morning 모드 — 시가 윈도우(09:00:00~30)에서 1차 진입
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
  const runtime = parseRuntime(app.runtimeJson);

  // ━━━ 수량 결정 ━━━
  // 우선순위: precomputedQty (apply 시점 확정) > budgetAmount+시세 > cash_ratio+시세+잔고
  let qty: number;

  if (runtime.precomputedQty?.stage1) {
    // ⚡ 최속 경로: apply 시점에 이미 수량 확정. API 호출 0.
    qty = runtime.precomputedQty.stage1;
  } else if (app.budgetAmount && app.budgetAmount > 0) {
    // 시세만 조회 (API 1회)
    const price = await fetchPrice(app.stockCode);
    if (!price) return;
    const budget = app.budgetAmount;
    const stage1Pct = entry.stages[0]!.entryPct;
    qty = Math.floor((budget * stage1Pct) / 100 / price.current);
  } else {
    // 잔고 + 시세 조회 (cash_ratio 전략, API 2회 병렬)
    const [price, cashResult] = await Promise.all([
      fetchPrice(app.stockCode),
      fetchOrderableCash(app.stockCode, 0, app.chatId),
    ]);
    if (!price) return;
    const cash = cashResult ?? 0;
    if (cash <= 0) {
      console.warn(`[staged] fireStage1 cash=0 (transient?) — skip tick`, app.id, app.stockCode);
      return;
    }
    const budget = Math.min(resolveBudget(entry, cash, null), cash);
    const stage1Pct = entry.stages[0]!.entryPct;
    qty = Math.floor((budget * stage1Pct) / 100 / price.current);
  }

  if (qty < 1) {
    createExecution({
      strategyId: strat.id, applicationId: app.id, chatId: app.chatId,
      stockCode: app.stockCode, action: 'buy', result: 'failure',
      errorMessage: `1차 수량 < 1주`,
      payload: { stage: 1, phase: 'pre_order', qty },
    });
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
    // 잔고부족 거절 → 현재 시세로 수량 재계산 후 재발주 (갭 대응)
    if (app.budgetAmount && app.budgetAmount > 0 && isInsufficientFundsError(msg)) {
      console.warn(`[staged] stage1 insufficient funds (qty=${qty}), retrying with live price`);
      const livePrice = await fetchPrice(app.stockCode);
      if (livePrice) {
        const stage1Pct = entry.stages[0]!.entryPct;
        const retryQty = Math.floor((app.budgetAmount * stage1Pct) / 100 / livePrice.current);
        if (retryQty >= 1 && retryQty < qty) {
          spec.quantity = retryQty;
          try {
            const out2 = await placeBuyOrder({ chatId: app.chatId, spec });
            positionId = out2.positionId;
            orderId = out2.orderId;
            qty = retryQty;
            // 재발주 성공 — 아래 pollFill 로 진행
          } catch (retryErr) {
            createExecution({
              strategyId: strat.id, applicationId: app.id, chatId: app.chatId,
              stockCode: app.stockCode, action: 'buy', result: 'failure',
              errorMessage: `재발주 실패: ${(retryErr as Error).message}`,
              payload: { stage: 1, originalQty: qty, retryQty },
            });
            updateApplicationStatus(app.id, app.chatId, 'failed');
            return;
          }
        } else {
          createExecution({
            strategyId: strat.id, applicationId: app.id, chatId: app.chatId,
            stockCode: app.stockCode, action: 'buy', result: 'failure',
            errorMessage: `재계산 수량 부족 (retryQty=${retryQty})`,
            payload: { stage: 1, originalQty: qty, retryQty, livePrice: livePrice.current },
          });
          updateApplicationStatus(app.id, app.chatId, 'failed');
          return;
        }
      } else {
        createExecution({
          strategyId: strat.id, applicationId: app.id, chatId: app.chatId,
          stockCode: app.stockCode, action: 'buy', result: 'failure',
          errorMessage: msg, payload: { stage: 1, qty, retryFailed: 'no_price' },
        });
        updateApplicationStatus(app.id, app.chatId, 'failed');
        return;
      }
    } else {
      createExecution({
        strategyId: strat.id, applicationId: app.id, chatId: app.chatId,
        stockCode: app.stockCode, action: 'buy', result: 'failure',
        errorMessage: msg, payload: { stage: 1, qty },
      });
      updateApplicationStatus(app.id, app.chatId, 'failed');
      return;
    }
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

// KIS 가 매도 거절 시 "잔고 없음" 류 메시지를 돌려주면 application 이 phantom
// (예: immediate 전략 매수가 미체결로 끝났는데 클라가 보낸 stage1Snapshot 으로
// runtime 에 stage1_filled 가 새겨진 케이스) — 무한 SL 재시도 방지용 판정.
function isPhantomHoldingError(err: string): boolean {
  return /잔고.*없|보유.*없|미보유|hldg.*qty.*0|매도.*가능.*수량.*없/i.test(err);
}

function isInsufficientFundsError(err: string): boolean {
  return /잔고.*부족|예수금.*부족|주문가능금액.*초과|매수.*가능.*금액|ord_psbl|insufficient/i.test(err);
}

// 종목 보유 수량을 KIS inquire_balance 로 확인 — phantom 검출용.
// balance.ts 와 동일한 'balance:raw' 캐시(60s) 활용 — warmup worker 가 30s
// 마다 갱신.
// 반환값:
//   null  → 검사 불가 (KIS 응답 누락/페이지 없음 등). phantom 검사 skip.
//   0     → 응답 list 에 종목이 있어야 정상이지만 빠짐. 진짜 미보유 후보.
//   N>=1  → 정상 보유.
async function fetchActualHoldingQty(code: string): Promise<number | null> {
  try {
    const r = await cached('balance:raw', 60_000, () =>
      callKisApi('domestic_stock', 'inquire_balance', {}),
    );
    const parsed = parseMcpResult(r);
    if (!parsed.success) return null;
    const list = outputList(parsed, 'output1');
    // KIS paper 가 종종 output1 을 빈 list 로 답함. 이 경우는 KIS 응답 이상으로
    // 보고 검사 skip (null). 사용자가 실제로 보유 0건이면 application 자체가
    // 안 만들어졌을 것이므로 빈 list 는 거의 항상 KIS 측 일시 누락.
    if (list.length === 0) return null;
    const hit = list.find((it) => String(it.pdno ?? '') === code);
    if (!hit) return 0;
    return num(hit.hldg_qty) ?? 0;
  } catch {
    return null;
  }
}

// phantom 으로 확정 마킹하기 전 필요한 연속 0 응답 횟수. KIS 응답 변동성
// 보호 — 단일 누락 응답으로 false positive 발생하지 않게. tick 5s × 5 = 25s
// 동안 일관되게 종목 누락이 있어야 진짜 phantom 으로 판정.
const PHANTOM_CONFIRM_THRESHOLD = 5;
const PHANTOM_GRACE_MS = 60_000;

// monitorStage1/monitorExit 공통 phantom 처리.
// 반환값:
//   true  → application 처리 종료 (skip 또는 completed). 호출자는 즉시 return.
//   false → phantom 의심 없음. 호출자는 normal monitor 진행.
async function handlePhantomCheck(
  app: StrategyApplication,
  strat: { id: string; name: string },
  runtime: StagedRuntime,
  now: number,
): Promise<boolean> {
  const s1 = runtime.stage1;
  if (!s1) return false;
  // stage1 이 외부 매수 (immediate 흐름) 인 경우만 검사. 봇이 직접 발주한 경우는
  // pollFill 결과로 stage1.qty 가 정확.
  if (s1.orderId !== 'external' && s1.positionId !== 'external') return false;

  // grace baseline — stage2 체결됐으면 그 시점, 아니면 stage1 시점.
  const baselineFilledAt = runtime.stage2?.filledAt ?? s1.filledAt ?? 0;
  if (now - baselineFilledAt < PHANTOM_GRACE_MS) return false;

  const actualQty = await fetchActualHoldingQty(app.stockCode);
  if (actualQty === null) return false; // KIS 응답 누락/오류 → 검사 skip

  if (actualQty < 1) {
    const misses = (runtime.phantomMisses ?? 0) + 1;
    if (misses < PHANTOM_CONFIRM_THRESHOLD) {
      setApplicationRuntime(
        app.id, app.chatId,
        { ...runtime, phantomMisses: misses } satisfies StagedRuntime,
      );
      return true; // 아직 확정 안 함, 다음 tick 까지 대기
    }
    createExecution({
      strategyId: strat.id, applicationId: app.id, chatId: app.chatId,
      stockCode: app.stockCode, action: 'sell', result: 'failure',
      errorMessage: `phantom_holding: KIS 잔고에 ${app.stockCode} 보유 없음 (snapshot qty=${s1.qty}, ${PHANTOM_CONFIRM_THRESHOLD}회 연속 누락).`,
      payload: { reason: 'phantom_holding', snapshotQty: s1.qty, actualQty, misses, phase: runtime.phase },
    });
    setApplicationRuntime(app.id, app.chatId, { ...runtime, phase: 'completed' } satisfies StagedRuntime);
    updateApplicationStatus(app.id, app.chatId, 'completed');
    return true;
  }

  // 정상 보유 — 카운터 리셋
  if ((runtime.phantomMisses ?? 0) > 0) {
    setApplicationRuntime(
      app.id, app.chatId,
      { ...runtime, phantomMisses: 0 } satisfies StagedRuntime,
    );
  }
  return false;
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

  // phantom 검사 (immediate 외부 매수 흐름 보호용)
  if (await handlePhantomCheck(app, strat, runtime, now)) return;

  const price = await fetchPrice(app.stockCode);
  if (!price) return;
  const cur = price.current;
  const avg1 = s1.avgPrice;

  // SL — 평단(여기선 1차 평단만 있음) 기준
  if (entry.stopLoss?.enabled && cur <= avg1 * (1 - entry.stopLoss.atPct / 100)) {
    const r = await placeMarketSell(app.stockCode, s1.qty);
    if (!r.ok) {
      if (isPhantomHoldingError(r.error)) {
        createExecution({
          strategyId: strat.id, applicationId: app.id, chatId: app.chatId,
          stockCode: app.stockCode, action: 'sell', result: 'failure',
          errorMessage: `phantom_holding (SL): ${r.error}`,
          payload: { reason: 'phantom_holding_on_sell', stage: 'SL' },
        });
        setApplicationRuntime(app.id, app.chatId, { ...runtime, phase: 'completed' } satisfies StagedRuntime);
        updateApplicationStatus(app.id, app.chatId, 'completed');
        return;
      }
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
      if (isPhantomHoldingError(r.error)) {
        createExecution({
          strategyId: strat.id, applicationId: app.id, chatId: app.chatId,
          stockCode: app.stockCode, action: 'sell', result: 'failure',
          errorMessage: `phantom_holding (TP1): ${r.error}`,
          payload: { reason: 'phantom_holding_on_sell', stage: 'TP1' },
        });
        setApplicationRuntime(app.id, app.chatId, { ...runtime, phase: 'completed' } satisfies StagedRuntime);
        updateApplicationStatus(app.id, app.chatId, 'completed');
        return;
      }
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

  // ━━━ 2차 수량 결정 ━━━
  let qty: number;
  if (runtime.precomputedQty?.stage2 && runtime.precomputedQty.stage2 > 0) {
    // ⚡ apply 시점 확정 수량 — API 호출 0
    qty = runtime.precomputedQty.stage2;
  } else if (app.budgetAmount && app.budgetAmount > 0) {
    const stage2Pct = entry.stages[1]!.entryPct;
    qty = Math.floor((app.budgetAmount * stage2Pct) / 100 / currentPrice);
  } else {
    const cash = (await fetchOrderableCash(app.stockCode, currentPrice, app.chatId)) ?? 0;
    if (cash <= 0) return;
    const baseBudget = Math.min(resolveBudget(entry, cash, null), cash);
    const stage2Pct = entry.stages[1]!.entryPct;
    qty = Math.floor((baseBudget * stage2Pct) / 100 / currentPrice);
  }
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
  // phantom 검사 (stage2_filled/tp1_done 단계에서도 KIS 응답 누락 보호)
  if (await handlePhantomCheck(app, strat, runtime, now)) return;
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
    if (!r.ok) {
      if (isPhantomHoldingError(r.error)) {
        createExecution({
          strategyId: strat.id, applicationId: app.id, chatId: app.chatId,
          stockCode: app.stockCode, action: 'sell', result: 'failure',
          errorMessage: `phantom_holding (SL exit): ${r.error}`,
          payload: { reason: 'phantom_holding_on_sell', stage: 'SL_exit' },
        });
        setApplicationRuntime(app.id, app.chatId, { ...runtime, phase: 'completed' } satisfies StagedRuntime);
        updateApplicationStatus(app.id, app.chatId, 'completed');
        return;
      }
      console.warn('[staged] SL exit fail', r.error);
      return;
    }
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
    if (!r.ok) {
      if (isPhantomHoldingError(r.error)) {
        createExecution({
          strategyId: strat.id, applicationId: app.id, chatId: app.chatId,
          stockCode: app.stockCode, action: 'sell', result: 'failure',
          errorMessage: `phantom_holding (TP2): ${r.error}`,
          payload: { reason: 'phantom_holding_on_sell', stage: 'TP2' },
        });
        setApplicationRuntime(app.id, app.chatId, { ...runtime, phase: 'completed' } satisfies StagedRuntime);
        updateApplicationStatus(app.id, app.chatId, 'completed');
        return;
      }
      console.warn('[staged] TP2 sell fail', r.error);
      return;
    }
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
      if (!r.ok) {
        if (isPhantomHoldingError(r.error)) {
          createExecution({
            strategyId: strat.id, applicationId: app.id, chatId: app.chatId,
            stockCode: app.stockCode, action: 'sell', result: 'failure',
            errorMessage: `phantom_holding (TP1 post-stage2): ${r.error}`,
            payload: { reason: 'phantom_holding_on_sell', stage: 'TP1_post_stage2' },
          });
          setApplicationRuntime(app.id, app.chatId, { ...runtime, phase: 'completed' } satisfies StagedRuntime);
          updateApplicationStatus(app.id, app.chatId, 'completed');
          return;
        }
        console.warn('[staged] TP1 (post-stage2) sell fail', r.error);
        return;
      }
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
