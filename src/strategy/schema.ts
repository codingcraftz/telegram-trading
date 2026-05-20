// 전략 definition zod 스키마.
// 첫 버전: 진입 2종 / 매수 2종 / 수량 3종 / 자동매도 2종 / 유효기간 2종.

import { z } from 'zod';

// ===== 진입 조건 =====
//
// 'morning_staged': 시가매매 — 분할 진입 + 분할 익절 + 평단 대비 손절.
//   stages[0]은 다음 영업일 09:00 시가에 시장가 매수.
//   stages[1] 옵션이면, 1차 체결가 대비 triggerDropPct% 하락 시 추가 매수.
//   1차 TP 도달 시 잔여 stages 자동 캔슬 (evaluator 책임).
//
//   entryPct 합 ≤ 100. cash_ratio 또는 total_amount 둘 중 하나의 의미로 해석 — 여기선 단순 비율로.
export const StagedMorningStageSchema = z.object({
  /** 이 단계가 받을 비율 (1~100, 합이 100 이하) */
  entryPct: z.number().min(1).max(100),
  /** 2차+ 단계만: 1차 체결가 대비 N% 하락 시 발동. stages[0]엔 무시. */
  triggerDropPct: z.number().min(0.1).max(50).optional(),
});

export const MorningStagedTpSchema = z
  .object({
    /** 1차 TP: 평균단가 대비 atPct% 상승 시 sellPct% 매도 */
    tp1: z
      .object({
        enabled: z.boolean(),
        atPct: z.number().min(0.5).max(100),
        sellPct: z.number().min(1).max(100),
      })
      .optional(),
    /** 2차 TP: 잔량 익절. 활성화 안 하면 tp1에서 100% 매도. */
    tp2: z
      .object({
        enabled: z.boolean(),
        atPct: z.number().min(0.5).max(200),
      })
      .optional(),
  })
  .optional();

export const MorningStagedSlSchema = z
  .object({
    enabled: z.boolean(),
    /** 평균단가 대비 N% 하락 시 전량 손절 */
    atPct: z.number().min(0.5).max(50),
  })
  .optional();

export const EntrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('morning') }),
  z.object({
    type: z.literal('limit_price'),
    targetPrice: z.number().positive(),
    direction: z.enum(['above', 'below']),
  }),
  z.object({
    type: z.literal('morning_staged'),
    /** 자금 단위 — 전체 자금 중 얼마를 이 전략이 쓸지 */
    budget: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('fixed_amount'), value: z.number().positive() }),
      z.object({ mode: z.literal('cash_ratio'), value: z.number().min(0.01).max(1.0) }),
    ]),
    /** 진입 단계 — 1개(단순 시가매매) 또는 2개(분할) */
    stages: z.array(StagedMorningStageSchema).min(1).max(2),
    /** 분할 익절 */
    takeProfit: MorningStagedTpSchema,
    /** 손절 — 평균단가 기준 */
    stopLoss: MorningStagedSlSchema,
  }),
]);
export type EntryCondition = z.infer<typeof EntrySchema>;

// ===== 매수 방식 =====
export const OrderMethodSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('market') }),
  z.object({ method: z.literal('limit'), limitPrice: z.number().positive() }),
]);
export type OrderMethod = z.infer<typeof OrderMethodSchema>;

// ===== 수량 방식 =====
export const QuantitySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('fixed_shares'), value: z.number().int().positive() }),
  z.object({ mode: z.literal('fixed_amount'), value: z.number().positive() }),
  z.object({ mode: z.literal('cash_ratio'), value: z.number().min(0.01).max(1.0) }),
]);
export type QuantitySpec = z.infer<typeof QuantitySchema>;

// ===== 자동 매도 (optional) =====
export const ExitSchema = z.object({
  takeProfit: z
    .object({ enabled: z.boolean(), pct: z.number().positive() })
    .optional(),
  stopLoss: z
    .object({ enabled: z.boolean(), pct: z.number().positive() })
    .optional(),
});
export type ExitSpec = z.infer<typeof ExitSchema>;

// ===== 유효 기간 =====
export const ValiditySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('once') }),
  z.object({ type: z.literal('forever') }),
]);
export type ValiditySpec = z.infer<typeof ValiditySchema>;

// ===== 전략 정의 =====
export const StrategyDefinitionSchema = z.object({
  entry: EntrySchema,
  order: OrderMethodSchema,
  quantity: QuantitySchema,
  exit: ExitSchema.optional(),
  validity: ValiditySchema,
});
export type StrategyDefinition = z.infer<typeof StrategyDefinitionSchema>;

// ===== CRUD 입력 =====
export const CreateStrategyInputSchema = z.object({
  name: z.string().trim().min(1, 'name required').max(80),
  active: z.boolean().optional().default(true),
  definition: StrategyDefinitionSchema,
});
export type CreateStrategyInput = z.infer<typeof CreateStrategyInputSchema>;

export const UpdateStrategyInputSchema = z.object({
  version: z.number().int().positive(), // optimistic lock
  name: z.string().trim().min(1).max(80).optional(),
  active: z.boolean().optional(),
  definition: StrategyDefinitionSchema.optional(),
});
export type UpdateStrategyInput = z.infer<typeof UpdateStrategyInputSchema>;

export const ApplyStrategyInputSchema = z.object({
  stockCode: z.string().regex(/^\d{6}$/, '6자리 종목코드만 가능'),
  /** apply 시점에 사용자가 지정하는 자금 (원). 없으면 strategy.budget 사용. */
  budgetAmount: z.number().int().positive().optional(),
});
export type ApplyStrategyInput = z.infer<typeof ApplyStrategyInputSchema>;

export const ToggleStrategyInputSchema = z.object({
  active: z.boolean(),
});
export type ToggleStrategyInput = z.infer<typeof ToggleStrategyInputSchema>;
