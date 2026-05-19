// 시가매매 — 정규장 09:00:00 ~ 09:00:30 윈도우 안에 발동.

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

const WINDOW_START_S = 0;   // 09:00:00
const WINDOW_END_S = 30;    // 09:00:30

function inMorningWindow(ts: number): boolean {
  // KST 기준 시·분·초 추출 — Date 객체를 KST로 shift 후 UTC getter 사용.
  const k = new Date(ts + 9 * 3600 * 1000);
  const h = k.getUTCHours();
  const m = k.getUTCMinutes();
  const s = k.getUTCSeconds();
  if (h !== 9 || m !== 0) return false;
  return s >= WINDOW_START_S && s <= WINDOW_END_S;
}

export function evaluateMorning(
  def: StrategyDefinition,
  market: MarketContext,
  account: AccountContext,
): EvaluationResult {
  if (def.entry.type !== 'morning') return skip('entry mismatch');
  if (market.marketSession !== 'open') return skip('장 시작 전이거나 휴장이에요');
  if (!inMorningWindow(market.timestamp)) return skip('시가 윈도우(09:00:00~09:00:30) 벗어남');

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
  return ok('시가매매 윈도우 진입', plan);
}
