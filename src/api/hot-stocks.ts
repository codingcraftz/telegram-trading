// GET /api/hot-stocks — 오늘(또는 최근) HOT 종목 반환.

import type { Context } from 'hono';
import { getDb } from '../db/client.js';
import { dailyHotStocks } from '../db/schema.js';
import { desc } from 'drizzle-orm';
import type { HotStock } from '../jobs/hot-stocks.js';

export async function handleHotStocks(c: Context) {
  const row = getDb()
    .select()
    .from(dailyHotStocks)
    .orderBy(desc(dailyHotStocks.date))
    .limit(1)
    .get();

  if (!row) return c.json({ date: null, items: [] });

  try {
    const items = JSON.parse(row.dataJson) as HotStock[];
    return c.json({ date: row.date, items });
  } catch {
    return c.json({ date: row.date, items: [] });
  }
}
