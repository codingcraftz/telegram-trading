// GET/POST /api/strategy — 시가매매 기본 셋팅 (TP/SL/trailing). 갭가드 제거됨.

import type { Context } from 'hono';
import { getMarketOpenSettings, upsertMarketOpenSettings } from '../db/repo.js';
import { getDefaultChatId } from './_auth.js';

export function handleStrategyGet(c: Context) {
  const chatId = getDefaultChatId();
  const s = getMarketOpenSettings(chatId);
  return c.json({
    tpPct: s?.tpPct ?? null,
    slPct: s?.slPct ?? null,
    trailingPct: s?.trailingPct ?? null,
  });
}

export async function handleStrategyPost(c: Context) {
  const chatId = getDefaultChatId();
  let body: {
    tpPct?: number | null;
    slPct?: number | null;
    trailingPct?: number | null;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }
  upsertMarketOpenSettings({
    chatId,
    tpPct: body.tpPct,
    slPct: body.slPct,
    trailingPct: body.trailingPct,
  });
  return c.json({ ok: true });
}
