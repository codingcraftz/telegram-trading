import { describe, expect, it } from 'vitest';
import { planQuantity } from '../planner.js';

describe('planQuantity', () => {
  it('fixed_shares 그대로 반환', () => {
    const r = planQuantity({ mode: 'fixed_shares', value: 10 }, 1000, 100_000);
    expect(r).toEqual({ ok: true, qty: 10 });
  });

  it('fixed_amount → floor(value / price)', () => {
    const r = planQuantity({ mode: 'fixed_amount', value: 100_000 }, 7_000, 1_000_000);
    // floor(100000/7000) = 14
    expect(r).toEqual({ ok: true, qty: 14 });
  });

  it('cash_ratio → floor(cash * ratio / price)', () => {
    const r = planQuantity({ mode: 'cash_ratio', value: 0.5 }, 5_000, 100_000);
    // floor(100000*0.5/5000) = 10
    expect(r).toEqual({ ok: true, qty: 10 });
  });

  it('price=0 → error', () => {
    const r = planQuantity({ mode: 'fixed_shares', value: 10 }, 0, 100_000);
    expect(r.ok).toBe(false);
  });

  it('cash=0 → cash_ratio 시 qty 0 → error', () => {
    const r = planQuantity({ mode: 'cash_ratio', value: 1.0 }, 5_000, 0);
    expect(r.ok).toBe(false);
  });

  it('fixed_amount 결과가 0이면 error', () => {
    const r = planQuantity({ mode: 'fixed_amount', value: 100 }, 5_000, 100_000);
    expect(r.ok).toBe(false);
  });

  it('잔액보다 큰 fixed_shares → error', () => {
    const r = planQuantity({ mode: 'fixed_shares', value: 100 }, 10_000, 50_000);
    // 100 * 10000 = 1_000_000 > 50_000
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('잔액');
  });

  it('fixed_shares 1주에 잔액 정확히 일치 → ok', () => {
    const r = planQuantity({ mode: 'fixed_shares', value: 1 }, 50_000, 50_000);
    expect(r).toEqual({ ok: true, qty: 1 });
  });
});
