// 전략 평가 + 발주 — 스케줄러 worker에서 호출.
//
// 흐름:
//   1) listAllActiveApplications() 로 모든 chat의 active 전략 가져옴
//   2) 각 application 마다 시세 + 매수가능금액 조회
//   3) evaluateStrategy → shouldExecute=true 면 placeBuyOrder + pollFill
//   4) once 면 status='completed', forever 면 lastEvaluatedAt 만 업데이트
//   5) strategy_executions 에 감사 로그
//
// 중복 발동 방지:
//   - morning/limit_price: 같은 KST 일자 내 1회만 평가 (lastEvaluatedAt 비교)
//   - once: 평가 결과와 상관없이 발동 후 status='completed'
//   - forever: 발동 후 lastEvaluatedAt 만 갱신 (다음 영업일 다시 평가 가능)

import { callKisApi } from '../mcp/kis.js';
import { firstOutput, num, parseMcpResult } from '../fastpath/extract.js';
import { placeBuyOrder, pollFill } from '../execution/order.js';
import { getMarketSession } from '../scheduler/calendar.js';
import { setPositionTpSl, type OrderSpec } from '../db/repo.js';
import { getStrategyById } from '../db/repo/strategies.js';
import {
  listAllActiveApplications,
  touchLastEvaluated,
  updateApplicationStatus,
} from '../db/repo/strategy_applications.js';
import { createExecution } from '../db/repo/strategy_executions.js';
import { evaluateStrategy } from './evaluator.js';
import { StrategyDefinitionSchema, type StrategyDefinition } from './schema.js';
import { processStagedApplication } from './staged_runner.js';
import type { MarketContext, MarketSession as StratSession } from './types.js';

function kstYmd(ts: number): string {
  const k = new Date(ts + 9 * 3600 * 1000);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')}`;
}

function toStrategySession(): StratSession {
  // src/scheduler/calendar.ts 의 MarketSession 을 strategy/types 의 MarketSession 으로 매핑.
  // strategy 쪽은 'open' | 'before' | 'after' | 'closed' 4가지.
  const s = getMarketSession();
  switch (s) {
    case 'regular':
      return 'open';
    case 'pre_extended':
    case 'pre_auction':
      return 'before';
    case 'close_auction':
    case 'post_extended':
    case 'after_single':
      return 'after';
    default:
      return 'closed';
  }
}

async function fetchPrice(code: string): Promise<{ current: number; prevClose: number } | null> {
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
    const prevClose = num(o.stck_sdpr);
    if (!current || current <= 0) return null;
    return { current, prevClose: prevClose ?? 0 };
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

function parseDefinition(json: string): StrategyDefinition | null {
  try {
    const parsed = JSON.parse(json);
    const validated = StrategyDefinitionSchema.safeParse(parsed);
    return validated.success ? validated.data : null;
  } catch {
    return null;
  }
}

/** worker tick 마다 호출 — 1회 라운드. */
export async function evaluateAndFireStrategies(): Promise<void> {
  const apps = listAllActiveApplications();
  if (apps.length === 0) return;

  const now = Date.now();
  const todayKst = kstYmd(now);
  const session = toStrategySession();

  for (const app of apps) {
    try {
      const strat = getStrategyById(app.strategyId, app.chatId);
      if (!strat || !strat.active) continue;

      const def = parseDefinition(strat.definition);
      if (!def) {
        console.warn('[strategy-runner] invalid definition', strat.id);
        continue;
      }

      // morning_staged 는 multi-step — 별도 runner 가 phase 분기로 처리
      if (def.entry.type === 'morning_staged') {
        await processStagedApplication(app);
        continue;
      }

      // 같은 KST 일자 내 1회만 평가 (morning/limit_price 공통)
      if (app.lastEvaluatedAt && kstYmd(app.lastEvaluatedAt) === todayKst) continue;

      const price = await fetchPrice(app.stockCode);
      if (!price) continue;

      // morning/limit_price 는 'open' 세션만 발동
      if (session !== 'open') {
        // 윈도우 이전에는 발동 안 함. lastEvaluatedAt 안 건드림.
        continue;
      }

      const cash = (await fetchOrderableCash(app.stockCode, price.current)) ?? 0;

      const market: MarketContext = {
        code: app.stockCode,
        currentPrice: price.current,
        prevClose: price.prevClose,
        marketSession: session,
        timestamp: now,
      };
      const account = { availableCash: cash };

      const evalResult = evaluateStrategy(def, market, account);

      if (!evalResult.shouldExecute) {
        // skip — 윈도우 밖 / 가격 미도달 등. lastEvaluatedAt 안 갱신 (다음 tick에 재평가).
        continue;
      }

      // 발주 직전 lastEvaluatedAt 즉시 갱신 — 다음 tick(5초 후)이 같은 KST일자라 중복 발주 차단.
      // 발주 실패해도 그날엔 더 시도 안 함 (의도). forever 면 다음 영업일에 자연 재개.
      touchLastEvaluated(app.id, app.chatId, now);

      // 발주
      const plan = evalResult.orderPlan;
      const stockName = ''; // KIS 응답에 종목명 없는 경우 빈 문자열 — placeBuyOrder가 처리.
      const spec: OrderSpec = {
        action: 'buy',
        market: 'KRX',
        symbol_code: app.stockCode,
        symbol_name: stockName || app.stockCode,
        order_type: plan.priceMode === 'limit' ? 'limit' : 'market',
        quantity: plan.qty,
        price: plan.limitPrice,
        tp_pct: plan.tp ?? null,
        sl_pct: plan.sl ?? null,
      };

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
          payload: { entry: def.entry.type, reason: evalResult.reason, plan },
        });
        updateApplicationStatus(app.id, app.chatId, 'failed');
        continue;
      }

      createExecution({
        strategyId: strat.id,
        applicationId: app.id,
        chatId: app.chatId,
        stockCode: app.stockCode,
        action: 'buy',
        result: 'success',
        payload: { entry: def.entry.type, reason: evalResult.reason, plan, orderId, positionId },
      });

      // 체결 알림은 pollFill 내부의 매수 체결 알림이 자동 송신
      pollFill({
        chatId: app.chatId,
        positionId,
        market: 'KRX',
        orderId,
        expectedQty: plan.qty,
        symbolName: app.stockCode,
        note: `[전략 ${strat.name}]`,
      })
        .then((fill) => {
          if (!fill.avgPrice) return;
          const avg = fill.avgPrice;
          const tpPrice = plan.tp ? Math.round(avg * (1 + plan.tp / 100)) : null;
          const slPrice = plan.sl ? Math.round(avg * (1 - plan.sl / 100)) : null;
          if (tpPrice !== null || slPrice !== null) {
            setPositionTpSl(positionId, tpPrice, slPrice);
          }
        })
        .catch((err) => console.error('[strategy-runner] pollFill failed', err));

      // 발동 후 처리: once → completed. forever 는 lastEvaluatedAt 이미 갱신 됨 (위에서).
      if (def.validity.type === 'once') {
        updateApplicationStatus(app.id, app.chatId, 'completed');
      }
    } catch (err) {
      console.error('[strategy-runner] app error', app.id, err);
    }
  }
}
