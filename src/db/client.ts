import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getConfig } from '../config.js';
import * as schema from './schema.js';

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

export function getDb() {
  if (_db) return _db;
  const cfg = getConfig();
  mkdirSync(dirname(cfg.DATABASE_FILE), { recursive: true });
  _sqlite = new Database(cfg.DATABASE_FILE);
  _sqlite.pragma('journal_mode = WAL');
  _sqlite.pragma('foreign_keys = ON');
  _db = drizzle(_sqlite, { schema });
  return _db;
}

export function getRawSqlite() {
  if (!_sqlite) getDb();
  return _sqlite!;
}

export function closeDb() {
  _sqlite?.close();
  _sqlite = null;
  _db = null;
}
