// 평가엔진 공용 타입. 순수 함수 시그니처.

import type { ExitSpec, OrderMethod } from './schema.js';

export type MarketSession = 'open' | 'before' | 'after' | 'closed';

export type MarketContext = {
  code: string;
  currentPrice: number;
  prevClose: number;
  marketSession: MarketSession;
  /** epoch ms */
  timestamp: number;
};

export type HoldingContext = {
  qty: number;
  avgPrice: number;
};

export type AccountContext = {
  availableCash: number;
  holding?: HoldingContext;
};

export type OrderPlan = {
  side: 'buy' | 'sell';
  qty: number;
  priceMode: OrderMethod['method'];
  limitPrice?: number;
  tp?: number;
  sl?: number;
};

export type EvaluationResult =
  | { shouldExecute: true; reason: string; orderPlan: OrderPlan }
  | { shouldExecute: false; reason: string };

export function ok(reason: string, orderPlan: OrderPlan): EvaluationResult {
  return { shouldExecute: true, reason, orderPlan };
}
export function skip(reason: string): EvaluationResult {
  return { shouldExecute: false, reason };
}

export function applyExit(plan: OrderPlan, exit: ExitSpec | undefined): OrderPlan {
  if (!exit) return plan;
  return {
    ...plan,
    tp: exit.takeProfit?.enabled && exit.takeProfit.pct > 0 ? exit.takeProfit.pct : undefined,
    sl: exit.stopLoss?.enabled && exit.stopLoss.pct > 0 ? exit.stopLoss.pct : undefined,
  };
}
