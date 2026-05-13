import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDb, getRawSqlite } from './client.js';
import {
  pendingIntents,
  positions,
  tradeLog,
  blacklist,
  cooldown,
  type NewPosition,
  type Position,
} from './schema.js';

export type OrderSpec = {
  action: 'buy' | 'sell';
  market: string; // 'KRX' | 'NASDAQ' | ...
  symbol_code: string;
  symbol_name: string;
  order_type: 'limit' | 'market';
  price?: number;
  quantity: number;
  tp_pct?: number | null;
  sl_pct?: number | null;
};

export function newId() {
  return nanoid(8);
}

// ---------- pending_intents ----------

export function insertPendingIntent(args: {
  chatId: number;
  llmProposal: string;
  orderSpec: OrderSpec;
  ttlMin: number;
}) {
  const now = Date.now();
  const id = newId();
  getDb().insert(pendingIntents).values({
    id,
    chatId: args.chatId,
    llmProposal: args.llmProposal,
    orderSpecJson: JSON.stringify(args.orderSpec),
    createdAt: now,
    expiresAt: now + args.ttlMin * 60 * 1000,
  }).run();
  return id;
}

export function loadPendingIntent(id: string, chatId: number) {
  const rows = getDb()
    .select()
    .from(pendingIntents)
    .where(and(eq(pendingIntents.id, id), eq(pendingIntents.chatId, chatId)))
    .all();
  return rows[0] ?? null;
}

export function markIntentConsumed(id: string) {
  getDb()
    .update(pendingIntents)
    .set({ consumedAt: Date.now() })
    .where(eq(pendingIntents.id, id))
    .run();
}

// ---------- positions ----------

export function insertPosition(p: NewPosition) {
  getDb().insert(positions).values(p).run();
}

export function getPosition(id: string): Position | null {
  return (
    getDb().select().from(positions).where(eq(positions.id, id)).get() ?? null
  );
}

export function listOpenPositions(): Position[] {
  return getDb().select().from(positions).where(eq(positions.state, 'open')).all();
}

export function listAllUnclosedPositions(): Position[] {
  return getDb()
    .select()
    .from(positions)
    .where(sql`${positions.state} IN ('pending','open','closing')`)
    .all();
}

export function listChatPositions(chatId: number): Position[] {
  return getDb()
    .select()
    .from(positions)
    .where(
      and(
        eq(positions.chatId, chatId),
        sql`${positions.state} IN ('pending','open','closing')`,
      ),
    )
    .all();
}

export function markPositionOpen(id: string, avgPrice: number) {
  const now = Date.now();
  getDb()
    .update(positions)
    .set({ state: 'open', avgPrice, openedAt: now })
    .where(eq(positions.id, id))
    .run();
}

// 단일 발사 클레임: triggered_at이 NULL일 때만 set. 영향받은 row가 1이면 우리가 클레임 성공.
export function tryClaimTrigger(positionId: string): boolean {
  const stmt = getRawSqlite().prepare(
    `UPDATE positions SET triggered_at = ? WHERE id = ? AND triggered_at IS NULL`,
  );
  const r = stmt.run(Date.now(), positionId);
  return r.changes === 1;
}

export function markPositionClosing(id: string, exitOrderId: string) {
  getDb()
    .update(positions)
    .set({ state: 'closing', exitOrderId })
    .where(eq(positions.id, id))
    .run();
}

export function markPositionClosed(id: string, realizedPnl: number) {
  getDb()
    .update(positions)
    .set({ state: 'closed', realizedPnl, closedAt: Date.now() })
    .where(eq(positions.id, id))
    .run();
}

export function markPositionFailed(id: string) {
  getDb()
    .update(positions)
    .set({ state: 'failed' })
    .where(eq(positions.id, id))
    .run();
}

// ---------- trade_log ----------

export function logTrade(args: {
  chatId: number;
  positionId?: string;
  kind: string;
  payload: unknown;
}) {
  getDb().insert(tradeLog).values({
    ts: Date.now(),
    chatId: args.chatId,
    positionId: args.positionId ?? null,
    kind: args.kind,
    payloadJson: JSON.stringify(args.payload),
  }).run();
}

// ---------- blacklist / cooldown ----------

export function isBlacklisted(code: string): boolean {
  return !!getDb().select().from(blacklist).where(eq(blacklist.symbolCode, code)).get();
}

export function inCooldown(code: string): boolean {
  const row = getDb().select().from(cooldown).where(eq(cooldown.symbolCode, code)).get();
  return !!row && row.until > Date.now();
}

export function setCooldown(code: string, untilMs: number) {
  // upsert
  getRawSqlite()
    .prepare(
      `INSERT INTO cooldown (symbol_code, until) VALUES (?, ?)
       ON CONFLICT(symbol_code) DO UPDATE SET until = excluded.until`,
    )
    .run(code, untilMs);
}

export function countOpenLikePositions(): number {
  const row = getRawSqlite()
    .prepare(`SELECT COUNT(*) as c FROM positions WHERE state IN ('pending','open','closing')`)
    .get() as { c: number } | undefined;
  return row?.c ?? 0;
}

export function todaysRealizedPnl(): number {
  const d = new Date();
  // KST date
  const kstDate = new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const row = getRawSqlite()
    .prepare(`SELECT realized_krw as r FROM daily_pnl WHERE date = ?`)
    .get(kstDate) as { r: number } | undefined;
  return row?.r ?? 0;
}

export function addDailyPnl(realizedKrw: number) {
  const d = new Date();
  const kstDate = new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  getRawSqlite()
    .prepare(
      `INSERT INTO daily_pnl (date, realized_krw, trade_count) VALUES (?, ?, 1)
       ON CONFLICT(date) DO UPDATE SET realized_krw = realized_krw + excluded.realized_krw, trade_count = trade_count + 1`,
    )
    .run(kstDate, realizedKrw);
}
