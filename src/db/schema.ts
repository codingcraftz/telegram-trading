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

export type Position = typeof positions.$inferSelect;
export type NewPosition = typeof positions.$inferInsert;
export type PendingIntent = typeof pendingIntents.$inferSelect;
