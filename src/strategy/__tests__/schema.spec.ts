import { describe, expect, it } from 'vitest';
import {
  CreateStrategyInputSchema,
  StrategyDefinitionSchema,
  UpdateStrategyInputSchema,
} from '../schema.js';

const validDef = {
  entry: { type: 'morning' as const },
  order: { method: 'market' as const },
  quantity: { mode: 'fixed_shares' as const, value: 10 },
  validity: { type: 'once' as const },
};

describe('StrategyDefinitionSchema', () => {
  it('유효한 시가매매 definition 통과', () => {
    expect(() => StrategyDefinitionSchema.parse(validDef)).not.toThrow();
  });

  it('유효한 limit_price definition 통과', () => {
    const r = StrategyDefinitionSchema.parse({
      ...validDef,
      entry: { type: 'limit_price', targetPrice: 50_000, direction: 'above' },
    });
    expect(r.entry.type).toBe('limit_price');
  });

  it('entry.type 잘못된 값 거부', () => {
    expect(() =>
      StrategyDefinitionSchema.parse({ ...validDef, entry: { type: 'bogus' } as never }),
    ).toThrow();
  });

  it('limit_price targetPrice 음수 거부', () => {
    expect(() =>
      StrategyDefinitionSchema.parse({
        ...validDef,
        entry: { type: 'limit_price', targetPrice: -100, direction: 'above' },
      }),
    ).toThrow();
  });

  it('cash_ratio 범위 초과(>1.0) 거부', () => {
    expect(() =>
      StrategyDefinitionSchema.parse({
        ...validDef,
        quantity: { mode: 'cash_ratio', value: 1.5 },
      }),
    ).toThrow();
  });

  it('cash_ratio 범위 미만(<0.01) 거부', () => {
    expect(() =>
      StrategyDefinitionSchema.parse({
        ...validDef,
        quantity: { mode: 'cash_ratio', value: 0 },
      }),
    ).toThrow();
  });

  it('exit는 optional — 없어도 통과', () => {
    expect(() => StrategyDefinitionSchema.parse(validDef)).not.toThrow();
  });

  it('exit takeProfit pct 음수 거부', () => {
    expect(() =>
      StrategyDefinitionSchema.parse({
        ...validDef,
        exit: { takeProfit: { enabled: true, pct: -1 } },
      }),
    ).toThrow();
  });

  it('order limit에 limitPrice 누락 거부', () => {
    expect(() =>
      StrategyDefinitionSchema.parse({
        ...validDef,
        order: { method: 'limit' } as never,
      }),
    ).toThrow();
  });
});

describe('CreateStrategyInputSchema', () => {
  it('name 빈 문자열 거부', () => {
    expect(() =>
      CreateStrategyInputSchema.parse({ name: '', definition: validDef }),
    ).toThrow();
  });

  it('name 공백만 → trim 후 거부', () => {
    expect(() =>
      CreateStrategyInputSchema.parse({ name: '   ', definition: validDef }),
    ).toThrow();
  });

  it('active 기본값 true', () => {
    const r = CreateStrategyInputSchema.parse({ name: 'A', definition: validDef });
    expect(r.active).toBe(true);
  });
});

describe('StrategyDefinitionSchema — morning_staged', () => {
  const stagedDef = {
    entry: {
      type: 'morning_staged' as const,
      budget: { mode: 'fixed_amount' as const, value: 1_000_000 },
      stages: [
        { entryPct: 30 },
        { entryPct: 70, triggerDropPct: 5 },
      ],
      takeProfit: {
        tp1: { enabled: true, atPct: 10, sellPct: 50 },
        tp2: { enabled: true, atPct: 20 },
      },
      stopLoss: { enabled: true, atPct: 10 },
    },
    // morning_staged는 외부 quantity/order/exit를 실효 무시. placeholder.
    order: { method: 'market' as const },
    quantity: { mode: 'fixed_shares' as const, value: 1 },
    validity: { type: 'forever' as const },
  };

  it('유효한 분할 진입 + 분할 익절 통과', () => {
    expect(() => StrategyDefinitionSchema.parse(stagedDef)).not.toThrow();
  });

  it('1단계만 (단순 시가매매와 동일) 통과', () => {
    const d = {
      ...stagedDef,
      entry: {
        ...stagedDef.entry,
        stages: [{ entryPct: 100 }],
      },
    };
    expect(() => StrategyDefinitionSchema.parse(d)).not.toThrow();
  });

  it('stages 0개 거부', () => {
    const d = { ...stagedDef, entry: { ...stagedDef.entry, stages: [] } };
    expect(() => StrategyDefinitionSchema.parse(d)).toThrow();
  });

  it('stages 3개 거부 (max 2)', () => {
    const d = {
      ...stagedDef,
      entry: {
        ...stagedDef.entry,
        stages: [{ entryPct: 30 }, { entryPct: 30 }, { entryPct: 40 }],
      },
    };
    expect(() => StrategyDefinitionSchema.parse(d)).toThrow();
  });

  it('entryPct 0 거부', () => {
    const d = {
      ...stagedDef,
      entry: { ...stagedDef.entry, stages: [{ entryPct: 0 }] },
    };
    expect(() => StrategyDefinitionSchema.parse(d)).toThrow();
  });

  it('budget cash_ratio 범위 통과 (1%~100%)', () => {
    const d = {
      ...stagedDef,
      entry: { ...stagedDef.entry, budget: { mode: 'cash_ratio', value: 0.5 } as const },
    };
    expect(() => StrategyDefinitionSchema.parse(d)).not.toThrow();
  });

  it('budget cash_ratio 범위 초과 거부', () => {
    const d = {
      ...stagedDef,
      entry: { ...stagedDef.entry, budget: { mode: 'cash_ratio', value: 1.5 } as const },
    };
    expect(() => StrategyDefinitionSchema.parse(d)).toThrow();
  });

  it('tp1 sellPct 0 거부', () => {
    const d = {
      ...stagedDef,
      entry: {
        ...stagedDef.entry,
        takeProfit: { tp1: { enabled: true, atPct: 10, sellPct: 0 } },
      },
    };
    expect(() => StrategyDefinitionSchema.parse(d)).toThrow();
  });

  it('SL atPct 50 초과 거부', () => {
    const d = {
      ...stagedDef,
      entry: {
        ...stagedDef.entry,
        stopLoss: { enabled: true, atPct: 60 },
      },
    };
    expect(() => StrategyDefinitionSchema.parse(d)).toThrow();
  });

  it('takeProfit/stopLoss 없어도 통과 (optional)', () => {
    const d = {
      ...stagedDef,
      entry: {
        type: 'morning_staged' as const,
        budget: stagedDef.entry.budget,
        stages: stagedDef.entry.stages,
      },
    };
    expect(() => StrategyDefinitionSchema.parse(d)).not.toThrow();
  });
});

describe('UpdateStrategyInputSchema', () => {
  it('version 필수', () => {
    expect(() => UpdateStrategyInputSchema.parse({ name: 'A' })).toThrow();
  });

  it('version만 있어도 통과 (부분 수정)', () => {
    expect(() => UpdateStrategyInputSchema.parse({ version: 1 })).not.toThrow();
  });
});
