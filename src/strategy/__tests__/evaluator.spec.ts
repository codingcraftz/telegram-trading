import { describe, expect, it } from 'vitest';
import { evaluateStrategy } from '../evaluator.js';
import type { StrategyDefinition } from '../schema.js';
import type { AccountContext, MarketContext } from '../types.js';

// KST 09:00:15 → UTC 00:00:15
function kstMs(h: number, m: number, s: number): number {
  // 2026-05-19 (수) 평일 가정
  return Date.UTC(2026, 4, 19, h - 9, m, s);
}

const baseMarket = (overrides: Partial<MarketContext> = {}): MarketContext => ({
  code: '005930',
  currentPrice: 70_000,
  prevClose: 69_000,
  marketSession: 'open',
  timestamp: kstMs(9, 0, 15),
  ...overrides,
});

const baseAccount = (overrides: Partial<AccountContext> = {}): AccountContext => ({
  availableCash: 1_000_000,
  ...overrides,
});

// ===== morning =====
describe('evaluateStrategy — morning', () => {
  const def: StrategyDefinition = {
    entry: { type: 'morning' },
    order: { method: 'market' },
    quantity: { mode: 'fixed_shares', value: 10 },
    validity: { type: 'once' },
  };

  it('09:00:15 + open → execute', () => {
    const r = evaluateStrategy(def, baseMarket(), baseAccount());
    expect(r.shouldExecute).toBe(true);
    if (r.shouldExecute) {
      expect(r.orderPlan.side).toBe('buy');
      expect(r.orderPlan.qty).toBe(10);
      expect(r.orderPlan.priceMode).toBe('market');
    }
  });

  it('09:00:45 → 윈도우 벗어남, skip', () => {
    const r = evaluateStrategy(def, baseMarket({ timestamp: kstMs(9, 0, 45) }), baseAccount());
    expect(r.shouldExecute).toBe(false);
    if (!r.shouldExecute) expect(r.reason).toContain('윈도우');
  });

  it('marketSession=before → skip', () => {
    const r = evaluateStrategy(def, baseMarket({ marketSession: 'before' }), baseAccount());
    expect(r.shouldExecute).toBe(false);
  });

  it('marketSession=closed → skip', () => {
    const r = evaluateStrategy(def, baseMarket({ marketSession: 'closed' }), baseAccount());
    expect(r.shouldExecute).toBe(false);
  });

  it('잔액 부족 → skip + reason 명시', () => {
    // 10주 * 70000 = 700000 > 100000
    const r = evaluateStrategy(def, baseMarket(), baseAccount({ availableCash: 100_000 }));
    expect(r.shouldExecute).toBe(false);
    if (!r.shouldExecute) expect(r.reason).toMatch(/잔액|0주/);
  });

  it('order.method=limit → priceMode=limit + limitPrice', () => {
    const r = evaluateStrategy(
      { ...def, order: { method: 'limit', limitPrice: 65_000 } },
      baseMarket(),
      baseAccount({ availableCash: 10_000_000 }),
    );
    expect(r.shouldExecute).toBe(true);
    if (r.shouldExecute) {
      expect(r.orderPlan.priceMode).toBe('limit');
      expect(r.orderPlan.limitPrice).toBe(65_000);
    }
  });
});

// ===== limit_price =====
describe('evaluateStrategy — limit_price', () => {
  const baseDef = (
    direction: 'above' | 'below',
    targetPrice: number,
  ): StrategyDefinition => ({
    entry: { type: 'limit_price', targetPrice, direction },
    order: { method: 'market' },
    quantity: { mode: 'fixed_shares', value: 5 },
    validity: { type: 'forever' },
  });

  it('above + 현재가 >= 목표가 → execute', () => {
    const r = evaluateStrategy(
      baseDef('above', 70_000),
      baseMarket({ currentPrice: 70_500 }),
      baseAccount(),
    );
    expect(r.shouldExecute).toBe(true);
  });

  it('above + 현재가 < 목표가 → skip', () => {
    const r = evaluateStrategy(
      baseDef('above', 75_000),
      baseMarket({ currentPrice: 70_000 }),
      baseAccount(),
    );
    expect(r.shouldExecute).toBe(false);
    if (!r.shouldExecute) expect(r.reason).toContain('<');
  });

  it('below + 현재가 <= 목표가 → execute', () => {
    const r = evaluateStrategy(
      baseDef('below', 70_000),
      baseMarket({ currentPrice: 69_500 }),
      baseAccount(),
    );
    expect(r.shouldExecute).toBe(true);
  });

  it('below + 현재가 > 목표가 → skip', () => {
    const r = evaluateStrategy(
      baseDef('below', 70_000),
      baseMarket({ currentPrice: 70_500 }),
      baseAccount(),
    );
    expect(r.shouldExecute).toBe(false);
    if (!r.shouldExecute) expect(r.reason).toContain('>');
  });

  it('marketSession=closed → skip (조건 도달했어도)', () => {
    const r = evaluateStrategy(
      baseDef('above', 70_000),
      baseMarket({ currentPrice: 70_500, marketSession: 'closed' }),
      baseAccount(),
    );
    expect(r.shouldExecute).toBe(false);
  });

  it('잔액 부족 → skip', () => {
    const r = evaluateStrategy(
      baseDef('above', 70_000),
      baseMarket({ currentPrice: 70_500 }),
      baseAccount({ availableCash: 100 }),
    );
    expect(r.shouldExecute).toBe(false);
  });
});

// ===== exit (tp/sl) =====
describe('evaluateStrategy — exit', () => {
  const baseDef = (exit: StrategyDefinition['exit']): StrategyDefinition => ({
    entry: { type: 'morning' },
    order: { method: 'market' },
    quantity: { mode: 'fixed_shares', value: 5 },
    validity: { type: 'once' },
    exit,
  });

  it('tp만 enabled → orderPlan.tp 채워짐, sl undefined', () => {
    const r = evaluateStrategy(
      baseDef({ takeProfit: { enabled: true, pct: 5 } }),
      baseMarket(),
      baseAccount(),
    );
    expect(r.shouldExecute).toBe(true);
    if (r.shouldExecute) {
      expect(r.orderPlan.tp).toBe(5);
      expect(r.orderPlan.sl).toBeUndefined();
    }
  });

  it('tp + sl 둘 다 enabled', () => {
    const r = evaluateStrategy(
      baseDef({ takeProfit: { enabled: true, pct: 7 }, stopLoss: { enabled: true, pct: 3 } }),
      baseMarket(),
      baseAccount(),
    );
    expect(r.shouldExecute).toBe(true);
    if (r.shouldExecute) {
      expect(r.orderPlan.tp).toBe(7);
      expect(r.orderPlan.sl).toBe(3);
    }
  });

  it('exit 없음 → tp/sl 둘 다 undefined', () => {
    const r = evaluateStrategy(baseDef(undefined), baseMarket(), baseAccount());
    expect(r.shouldExecute).toBe(true);
    if (r.shouldExecute) {
      expect(r.orderPlan.tp).toBeUndefined();
      expect(r.orderPlan.sl).toBeUndefined();
    }
  });

  it('tp enabled=false → undefined', () => {
    const r = evaluateStrategy(
      baseDef({ takeProfit: { enabled: false, pct: 10 } }),
      baseMarket(),
      baseAccount(),
    );
    expect(r.shouldExecute).toBe(true);
    if (r.shouldExecute) expect(r.orderPlan.tp).toBeUndefined();
  });
});
