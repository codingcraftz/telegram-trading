import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDb, getRawSqlite } from './client.js';
import {
  pendingIntents,
  positions,
  tradeLog,
  blacklist,
  cooldown,
  marketOpenSettings,
  marketOpenReservations,
  watchlist,
  type NewPosition,
  type Position,
  type MarketOpenSettings,
  type MarketOpenReservation,
  type WatchlistRow,
} from './schema.js';

export type OrderSpec = {
  action: 'buy' | 'sell';
  market: string; // 'KRX' | 'NASDAQ' | ...
  symbol_code: string;
  symbol_name: string;
  // limit/market = 정규장 기본
  // pre_extended (08:30~08:40 전일 종가, ord_dvsn=05)
  // post_extended (15:40~16:00 당일 종가, ord_dvsn=06)
  // after_single (16:00~18:00 시간외 단일가, ord_dvsn=07)
  order_type: 'limit' | 'market' | 'pre_extended' | 'post_extended' | 'after_single';
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

// 현재 확정/취소 대기 중(미소비 + 미만료)인 즉시 주문 제안 — /대기 통합 뷰용.
export function listChatPendingIntents(chatId: number) {
  const now = Date.now();
  return getDb()
    .select()
    .from(pendingIntents)
    .where(
      and(
        eq(pendingIntents.chatId, chatId),
        isNull(pendingIntents.consumedAt),
        sql`${pendingIntents.expiresAt} > ${now}`,
      ),
    )
    .all();
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

// 시장가 체결 후 평균가 기준으로 TP/SL 가격을 채워 넣음.
export function setPositionTpSl(id: string, tpPrice: number | null, slPrice: number | null) {
  getDb()
    .update(positions)
    .set({ tpPrice, slPrice })
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

// ---------- market_open_settings ----------

export const DEFAULT_GAP_GUARD_PCT = 5;

export function getMarketOpenSettings(chatId: number): MarketOpenSettings | null {
  return (
    getDb()
      .select()
      .from(marketOpenSettings)
      .where(eq(marketOpenSettings.chatId, chatId))
      .get() ?? null
  );
}

export function upsertMarketOpenSettings(args: {
  chatId: number;
  gapGuardPct?: number | null;
  tpPct?: number | null;
  slPct?: number | null;
  trailingPct?: number | null;
}) {
  const cur = getMarketOpenSettings(args.chatId);
  const next = {
    chatId: args.chatId,
    gapGuardPct:
      args.gapGuardPct === undefined ? cur?.gapGuardPct ?? null : args.gapGuardPct,
    tpPct: args.tpPct === undefined ? cur?.tpPct ?? null : args.tpPct,
    slPct: args.slPct === undefined ? cur?.slPct ?? null : args.slPct,
    trailingPct:
      args.trailingPct === undefined ? cur?.trailingPct ?? null : args.trailingPct,
    updatedAt: Date.now(),
  };
  getRawSqlite()
    .prepare(
      `INSERT INTO market_open_settings (chat_id, gap_guard_pct, tp_pct, sl_pct, trailing_pct, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET
         gap_guard_pct = excluded.gap_guard_pct,
         tp_pct = excluded.tp_pct,
         sl_pct = excluded.sl_pct,
         trailing_pct = excluded.trailing_pct,
         updated_at = excluded.updated_at`,
    )
    .run(next.chatId, next.gapGuardPct, next.tpPct, next.slPct, next.trailingPct, next.updatedAt);
}

// ---------- market_open_reservations ----------

export function insertMarketOpenReservation(args: {
  chatId: number;
  market: string;
  symbolCode: string;
  symbolName: string;
  qtyMode: 'shares' | 'amount' | 'percent';
  qtyValue: number;
  gapGuardPct: number | null;
  tpPct: number | null;
  slPct: number | null;
  scheduledFor: number;
  ttlMin: number;
}): string {
  const now = Date.now();
  const id = newId();
  getRawSqlite()
    .prepare(
      `INSERT INTO market_open_reservations
        (id, chat_id, market, symbol_code, symbol_name, qty_mode, qty_value,
         gap_guard_pct, tp_pct, sl_pct, scheduled_for, state,
         created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_confirm', ?, ?)`,
    )
    .run(
      id,
      args.chatId,
      args.market,
      args.symbolCode,
      args.symbolName,
      args.qtyMode,
      args.qtyValue,
      args.gapGuardPct,
      args.tpPct,
      args.slPct,
      args.scheduledFor,
      now,
      now + args.ttlMin * 60 * 1000,
    );
  return id;
}

export function getReservation(id: string, chatId?: number): MarketOpenReservation | null {
  const where = chatId
    ? and(eq(marketOpenReservations.id, id), eq(marketOpenReservations.chatId, chatId))
    : eq(marketOpenReservations.id, id);
  return getDb().select().from(marketOpenReservations).where(where).get() ?? null;
}

export function listChatReservations(
  chatId: number,
  states: Array<'awaiting_confirm' | 'pending' | 'fired' | 'canceled' | 'rejected' | 'expired'> = [
    'awaiting_confirm',
    'pending',
  ],
): MarketOpenReservation[] {
  return getDb()
    .select()
    .from(marketOpenReservations)
    .where(
      and(
        eq(marketOpenReservations.chatId, chatId),
        sql`${marketOpenReservations.state} IN (${sql.join(states.map((s) => sql`${s}`), sql`, `)})`,
      ),
    )
    .orderBy(marketOpenReservations.scheduledFor)
    .all();
}

export function listDueReservations(now: number): MarketOpenReservation[] {
  return getDb()
    .select()
    .from(marketOpenReservations)
    .where(
      and(
        eq(marketOpenReservations.state, 'pending'),
        lte(marketOpenReservations.scheduledFor, now),
      ),
    )
    .orderBy(marketOpenReservations.scheduledFor)
    .all();
}

export function confirmReservation(id: string): boolean {
  const r = getRawSqlite()
    .prepare(
      `UPDATE market_open_reservations
       SET state = 'pending', confirmed_at = ?
       WHERE id = ? AND state = 'awaiting_confirm'`,
    )
    .run(Date.now(), id);
  return r.changes === 1;
}

export function cancelReservation(id: string): boolean {
  const r = getRawSqlite()
    .prepare(
      `UPDATE market_open_reservations
       SET state = 'canceled'
       WHERE id = ? AND state IN ('awaiting_confirm', 'pending')`,
    )
    .run(id);
  return r.changes === 1;
}

// 단일 발사 클레임
export function tryClaimReservation(id: string): boolean {
  const r = getRawSqlite()
    .prepare(
      `UPDATE market_open_reservations
       SET state = 'fired', fired_at = ?
       WHERE id = ? AND state = 'pending'`,
    )
    .run(Date.now(), id);
  return r.changes === 1;
}

export function rejectReservation(id: string, reason: string) {
  getRawSqlite()
    .prepare(
      `UPDATE market_open_reservations
       SET state = 'rejected', reject_reason = ?, fired_at = ?
       WHERE id = ?`,
    )
    .run(reason, Date.now(), id);
}

export function attachPositionToReservation(id: string, positionId: string) {
  getRawSqlite()
    .prepare(`UPDATE market_open_reservations SET position_id = ? WHERE id = ?`)
    .run(positionId, id);
}

// 휴장일/임시휴장 등으로 발사 거부됐을 때 다음 영업일로 재예약.
// state는 'pending' 그대로, scheduled_for만 갱신.
// 일단 fired 클레임이 됐다면 state='fired' → 'pending'으로 되돌림 + scheduled_for 갱신.
export function rescheduleReservation(id: string, newScheduledFor: number): number {
  const r = getRawSqlite()
    .prepare(
      `UPDATE market_open_reservations
       SET state = 'pending', scheduled_for = ?, fired_at = NULL, reject_reason = NULL
       WHERE id = ? AND state IN ('pending','fired','rejected')`,
    )
    .run(newScheduledFor, id);
  return r.changes;
}

export function expireOldAwaitingReservations() {
  getRawSqlite()
    .prepare(
      `UPDATE market_open_reservations
       SET state = 'expired'
       WHERE state = 'awaiting_confirm' AND expires_at < ?`,
    )
    .run(Date.now());
}

// ---------- watchlist ----------
// 관심종목은 추가/삭제 시에만 변경됨 → in-memory 캐시로 매 메뉴 진입마다 DB read 없앰.

const _watchlistCache = new Map<number, WatchlistRow[]>();

export function listWatchlist(chatId: number): WatchlistRow[] {
  const cached = _watchlistCache.get(chatId);
  if (cached) return cached;
  const rows = getDb()
    .select()
    .from(watchlist)
    .where(eq(watchlist.chatId, chatId))
    .orderBy(watchlist.addedAt)
    .all();
  _watchlistCache.set(chatId, rows);
  return rows;
}

export function addWatchlist(args: {
  chatId: number;
  market: string;
  symbolCode: string;
  symbolName: string;
}): { added: boolean; existed: boolean } {
  const r = getRawSqlite()
    .prepare(
      `INSERT OR IGNORE INTO watchlist (chat_id, market, symbol_code, symbol_name, added_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(args.chatId, args.market, args.symbolCode, args.symbolName, Date.now());
  _watchlistCache.delete(args.chatId);
  return { added: r.changes === 1, existed: r.changes === 0 };
}

export function removeWatchlistByIds(chatId: number, ids: number[]): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const r = getRawSqlite()
    .prepare(
      `DELETE FROM watchlist WHERE chat_id = ? AND id IN (${placeholders})`,
    )
    .run(chatId, ...ids);
  _watchlistCache.delete(chatId);
  return r.changes;
}

// 사용자별 정렬된 watchlist에서 N번째(1-indexed) → row id 매핑
export function resolveWatchlistOrdinals(chatId: number, ordinals: number[]): number[] {
  const rows = listWatchlist(chatId);
  const out: number[] = [];
  for (const n of ordinals) {
    const idx = n - 1;
    if (idx >= 0 && idx < rows.length) out.push(rows[idx]!.id);
  }
  return out;
}
