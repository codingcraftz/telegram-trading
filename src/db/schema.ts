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
