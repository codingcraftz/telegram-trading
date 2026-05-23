import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

// LLM이 제안한 매매. /confirm으로 소비됨.
export const pendingIntents = sqliteTable('pending_intents', {
  id: text('id').primaryKey(),
  chatId: integer('chat_id').notNull(),
  llmProposal: text('llm_proposal').notNull(),
  orderSpecJson: text('order_spec_json').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  consumedAt: integer('consumed_at'),
});

// 체결된 포지션 (또는 진입 주문 후 대기 중)
export const positions = sqliteTable(
  'positions',
  {
    id: text('id').primaryKey(),
    chatId: integer('chat_id').notNull(),
    market: text('market').notNull().default('KRX'), // KRX | NASDAQ | NYSE | ...
    symbolCode: text('symbol_code').notNull(),
    symbolName: text('symbol_name').notNull(),
    side: text('side', { enum: ['buy', 'sell'] }).notNull(),
    entryOrderId: text('entry_order_id').notNull(),
    exitOrderId: text('exit_order_id'),
    avgPrice: real('avg_price'),
    quantity: integer('quantity').notNull(),
    tpPrice: real('tp_price'),
    slPrice: real('sl_price'),
    state: text('state', {
      enum: ['pending', 'open', 'closing', 'closed', 'failed'],
    }).notNull(),
    triggeredAt: integer('triggered_at'),
    openedAt: integer('opened_at'),
    closedAt: integer('closed_at'),
    realizedPnl: real('realized_pnl'),
  },
  (t) => ({
    stateIdx: index('positions_state_idx').on(t.state),
    symbolStateIdx: index('positions_symbol_state_idx').on(t.symbolCode, t.state),
  }),
);

export const tradeLog = sqliteTable('trade_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ts: integer('ts').notNull(),
  chatId: integer('chat_id').notNull(),
  positionId: text('position_id'),
  kind: text('kind').notNull(),
  payloadJson: text('payload_json').notNull(),
});

export const dailyPnl = sqliteTable('daily_pnl', {
  date: text('date').primaryKey(), // YYYY-MM-DD KST
  realizedKrw: real('realized_krw').notNull().default(0),
  tradeCount: integer('trade_count').notNull().default(0),
});

export const blacklist = sqliteTable('blacklist', {
  symbolCode: text('symbol_code').primaryKey(),
  addedAt: integer('added_at').notNull(),
  reason: text('reason'),
});

export const cooldown = sqliteTable('cooldown', {
  symbolCode: text('symbol_code').primaryKey(),
  until: integer('until').notNull(),
});

// 사용자별 관심종목.
export const watchlist = sqliteTable(
  'watchlist',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    chatId: integer('chat_id').notNull(),
    market: text('market').notNull().default('KRX'),
    symbolCode: text('symbol_code').notNull(),
    symbolName: text('symbol_name').notNull(),
    addedAt: integer('added_at').notNull(),
  },
  (t) => ({
    chatIdx: index('watchlist_chat_idx').on(t.chatId),
  }),
);

// 사용자별 시가매매 기본 셋팅. null 의미는 아래.
//   gapGuardPct: null=기본(5%) / 0=끄기 / 양수=임계치
//   tpPct, slPct: null=끄기 / 양수=매수가 기준 %
export const marketOpenSettings = sqliteTable('market_open_settings', {
  chatId: integer('chat_id').primaryKey(),
  gapGuardPct: real('gap_guard_pct'),
  tpPct: real('tp_pct'),
  slPct: real('sl_pct'),
  trailingPct: real('trailing_pct'),
  updatedAt: integer('updated_at').notNull(),
});

// 시가매매 예약. /confirm 받으면 state='pending'으로 진입.
//   awaiting_confirm → pending → fired (or canceled / rejected / expired)
export const marketOpenReservations = sqliteTable(
  'market_open_reservations',
  {
    id: text('id').primaryKey(),
    chatId: integer('chat_id').notNull(),
    market: text('market').notNull().default('KRX'),
    symbolCode: text('symbol_code').notNull(),
    symbolName: text('symbol_name').notNull(),
    qtyMode: text('qty_mode', { enum: ['shares', 'amount', 'percent'] }).notNull(),
    qtyValue: real('qty_value').notNull(),
    gapGuardPct: real('gap_guard_pct'), // 예약 시점 셋팅 스냅샷. null=끄기
    tpPct: real('tp_pct'),
    slPct: real('sl_pct'),
    scheduledFor: integer('scheduled_for').notNull(), // unix ms
    state: text('state', {
      enum: ['awaiting_confirm', 'pending', 'fired', 'canceled', 'rejected', 'expired'],
    }).notNull(),
    rejectReason: text('reject_reason'),
    positionId: text('position_id'),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(), // awaiting_confirm TTL
    confirmedAt: integer('confirmed_at'),
    firedAt: integer('fired_at'),
  },
  (t) => ({
    stateIdx: index('mo_state_idx').on(t.state),
    chatStateIdx: index('mo_chat_state_idx').on(t.chatId, t.state),
  }),
);

export type Position = typeof positions.$inferSelect;
export type NewPosition = typeof positions.$inferInsert;
export type PendingIntent = typeof pendingIntents.$inferSelect;
export type MarketOpenSettings = typeof marketOpenSettings.$inferSelect;
export type MarketOpenReservation = typeof marketOpenReservations.$inferSelect;
export type WatchlistRow = typeof watchlist.$inferSelect;

// ============================================================
// 전략 시스템 (스텝 5)
// ============================================================

// 사용자가 정의한 매매 전략. definition은 zod-validated JSON.
export const strategies = sqliteTable(
  'strategies',
  {
    id: text('id').primaryKey(),
    chatId: integer('chat_id').notNull(),
    name: text('name').notNull(),
    version: integer('version').notNull().default(1), // optimistic lock
    active: integer('active').notNull().default(1),   // 0/1 (boolean)
    definition: text('definition').notNull(),         // JSON serialized StrategyDefinition
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    chatIdx: index('strategies_chat_idx').on(t.chatId),
  }),
);

// 전략을 특정 종목에 적용한 인스턴스. (chat, strategy, stock) 조합 unique.
export const strategyApplications = sqliteTable(
  'strategy_applications',
  {
    id: text('id').primaryKey(),
    strategyId: text('strategy_id').notNull(),
    chatId: integer('chat_id').notNull(),
    stockCode: text('stock_code').notNull(),
    status: text('status', {
      enum: ['active', 'paused', 'completed', 'failed'],
    }).notNull(),
    appliedAt: integer('applied_at').notNull(),
    lastEvaluatedAt: integer('last_evaluated_at'),
    /** morning_staged 등 multi-step 전략의 runtime 상태 (JSON). null = 미시작. */
    runtimeJson: text('runtime_json'),
    /** apply 시점에 사용자가 지정한 자금 (원). null 이면 strategy.budget 사용.
     *  사용자 정책: 자금은 매수마다 다르게 정함 → strategy 자체엔 cash_ratio=1.0 placeholder. */
    budgetAmount: integer('budget_amount'),
  },
  (t) => ({
    chatIdx: index('strat_app_chat_idx').on(t.chatId),
    strategyIdx: index('strat_app_strategy_idx').on(t.strategyId),
    // UNIQUE (chat_id, strategy_id, stock_code) — migrate.ts에서 CREATE UNIQUE INDEX
  }),
);

// 전략 평가 실행 이력 (감사 로그)
export const strategyExecutions = sqliteTable(
  'strategy_executions',
  {
    id: text('id').primaryKey(),
    strategyId: text('strategy_id').notNull(),
    applicationId: text('application_id').notNull(),
    chatId: integer('chat_id').notNull(),
    stockCode: text('stock_code').notNull(),
    triggeredAt: integer('triggered_at').notNull(),
    action: text('action', { enum: ['buy', 'sell', 'no_op'] }).notNull(),
    result: text('result', { enum: ['success', 'failure', 'skipped'] }).notNull(),
    payload: text('payload'),
    errorMessage: text('error_message'),
  },
  (t) => ({
    strategyTimeIdx: index('strat_exec_strategy_time_idx').on(t.strategyId, t.triggeredAt),
    chatTimeIdx: index('strat_exec_chat_time_idx').on(t.chatId, t.triggeredAt),
  }),
);

// 일간 HOT 종목 (장마감 후 1회 수집)
export const dailyHotStocks = sqliteTable('daily_hot_stocks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(), // YYYY-MM-DD (KST)
  dataJson: text('data_json').notNull(), // JSON array
  createdAt: integer('created_at').notNull(),
});

export type Strategy = typeof strategies.$inferSelect;
export type NewStrategy = typeof strategies.$inferInsert;
export type StrategyApplication = typeof strategyApplications.$inferSelect;
export type StrategyExecution = typeof strategyExecutions.$inferSelect;
