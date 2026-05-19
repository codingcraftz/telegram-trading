// 지정가 도달 트리거 — 정규장 중 현재가가 목표가 above/below 도달 시 발동.

import { planQuantity } from '../planner.js';
import type { StrategyDefinition } from '../schema.js';
import {
  applyExit,
  ok,
  skip,
  type AccountContext,
  type EvaluationResult,
  type MarketContext,
} from '../types.js';

export function evaluateLimitPrice(
  def: StrategyDefinition,
  market: MarketContext,
  account: AccountContext,
): EvaluationResult {
  if (def.entry.type !== 'limit_price') return skip('entry mismatch');
  if (market.marketSession !== 'open') return skip('장 시작 전이거나 휴장이에요');

  const reached =
    def.entry.direction === 'above'
      ? market.currentPrice >= def.entry.targetPrice
      : market.currentPrice <= def.entry.targetPrice;
  if (!reached) {
    return skip(
      def.entry.direction === 'above'
        ? `현재가 ${market.currentPrice} < 목표 ${def.entry.targetPrice}`
        : `현재가 ${market.currentPrice} > 목표 ${def.entry.targetPrice}`,
    );
  }

  const q = planQuantity(def.quantity, market.currentPrice, account.availableCash);
  if (!q.ok) return skip(q.error);

  const plan = applyExit(
    {
      side: 'buy',
      qty: q.qty,
      priceMode: def.order.method,
      limitPrice: def.order.method === 'limit' ? def.order.limitPrice : undefined,
    },
    def.exit,
  );
  return ok('지정가 도달', plan);
}
