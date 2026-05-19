// 전략 평가엔진 — entry.type에 따라 해당 evaluator로 분기.
// 순수 함수. 외부 API/DB/로깅 X.

import { evaluateLimitPrice } from './evaluators/limit_price.js';
import { evaluateMorning } from './evaluators/morning.js';
import type { StrategyDefinition } from './schema.js';
import { skip, type AccountContext, type EvaluationResult, type MarketContext } from './types.js';

export function evaluateStrategy(
  def: StrategyDefinition,
  market: MarketContext,
  account: AccountContext,
): EvaluationResult {
  switch (def.entry.type) {
    case 'morning':
      return evaluateMorning(def, market, account);
    case 'limit_price':
      return evaluateLimitPrice(def, market, account);
    default:
      // exhaustive guard
      return skip(`알 수 없는 entry: ${(def.entry as { type: string }).type}`);
  }
}

export type { EvaluationResult, MarketContext, AccountContext, OrderPlan } from './types.js';
