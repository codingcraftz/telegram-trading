import { getRawSqlite, getDb } from './client.js';

// 단순 부트스트랩: drizzle migration 파일 없이 스키마 직접 생성.
// 후속 변경은 drizzle-kit generate로 마이그레이션 만들기 권장.
export function ensureSchema() {
  getDb(); // open + WAL pragma
  const sqlite = getRawSqlite();
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS pending_intents (
      id TEXT PRIMARY KEY,
      chat_id INTEGER NOT NULL,
      llm_proposal TEXT NOT NULL,
      order_spec_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      chat_id INTEGER NOT NULL,
      market TEXT NOT NULL DEFAULT 'KRX',
      symbol_code TEXT NOT NULL,
      symbol_name TEXT NOT NULL,
      side TEXT NOT NULL,
      entry_order_id TEXT NOT NULL,
      exit_order_id TEXT,
      avg_price REAL,
      quantity INTEGER NOT NULL,
      tp_price REAL,
      sl_price REAL,
      state TEXT NOT NULL,
      triggered_at INTEGER,
      opened_at INTEGER,
      closed_at INTEGER,
      realized_pnl REAL
    );
    CREATE INDEX IF NOT EXISTS positions_state_idx ON positions(state);
    CREATE INDEX IF NOT EXISTS positions_symbol_state_idx ON positions(symbol_code, state);

    CREATE TABLE IF NOT EXISTS trade_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      position_id TEXT,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_pnl (
      date TEXT PRIMARY KEY,
      realized_krw REAL NOT NULL DEFAULT 0,
      trade_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS blacklist (
      symbol_code TEXT PRIMARY KEY,
      added_at INTEGER NOT NULL,
      reason TEXT
    );

    CREATE TABLE IF NOT EXISTS cooldown (
      symbol_code TEXT PRIMARY KEY,
      until INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS market_open_settings (
      chat_id INTEGER PRIMARY KEY,
      gap_guard_pct REAL,
      tp_pct REAL,
      sl_pct REAL,
      trailing_pct REAL,
      updated_at INTEGER NOT NULL
    );
    -- 기존 DB에 trailing_pct 컬럼 추가 (이미 있으면 무시)
    -- SQLite는 IF NOT EXISTS for column 미지원. ALTER TABLE 시도 후 에러 무시.
  `);

  // 기존 테이블에 컬럼이 없으면 추가
  try {
    sqlite.exec(`ALTER TABLE market_open_settings ADD COLUMN trailing_pct REAL`);
  } catch (e) {
    // 이미 존재
  }

  sqlite.exec(`

    CREATE TABLE IF NOT EXISTS market_open_reservations (
      id TEXT PRIMARY KEY,
      chat_id INTEGER NOT NULL,
      market TEXT NOT NULL DEFAULT 'KRX',
      symbol_code TEXT NOT NULL,
      symbol_name TEXT NOT NULL,
      qty_mode TEXT NOT NULL,
      qty_value REAL NOT NULL,
      gap_guard_pct REAL,
      tp_pct REAL,
      sl_pct REAL,
      scheduled_for INTEGER NOT NULL,
      state TEXT NOT NULL,
      reject_reason TEXT,
      position_id TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      confirmed_at INTEGER,
      fired_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS mo_state_idx ON market_open_reservations(state);
    CREATE INDEX IF NOT EXISTS mo_chat_state_idx ON market_open_reservations(chat_id, state);

    CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      market TEXT NOT NULL DEFAULT 'KRX',
      symbol_code TEXT NOT NULL,
      symbol_name TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      UNIQUE(chat_id, market, symbol_code)
    );
    CREATE INDEX IF NOT EXISTS watchlist_chat_idx ON watchlist(chat_id);
  `);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureSchema();
  console.log('schema ensured');
}
