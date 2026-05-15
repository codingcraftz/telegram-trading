// GET/POST /api/strategy — 시가매매 기본 셋팅 (gapGuard/TP/SL/trailing)

import type { Context } from 'hono';
import {
  DEFAULT_GAP_GUARD_PCT,
  getMarketOpenSettings,
  upsertMarketOpenSettings,
} from '../db/repo.js';
import { getDefaultChatId } from './_auth.js';

export function handleStrategyGet(c: Context) {
  const chatId = getDefaultChatId();
  const s = getMarketOpenSettings(chatId);
  return c.json({
    gapGuardPct: s?.gapGuardPct ?? DEFAULT_GAP_GUARD_PCT,
    tpPct: s?.tpPct ?? null,
    slPct: s?.slPct ?? null,
    trailingPct: s?.trailingPct ?? null,
    defaultGapGuardPct: DEFAULT_GAP_GUARD_PCT,
  });
}

export async function handleStrategyPost(c: Context) {
  const chatId = getDefaultChatId();
  let body: {
    gapGuardPct?: number | null;
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
    gapGuardPct: body.gapGuardPct,
    tpPct: body.tpPct,
    slPct: body.slPct,
    trailingPct: body.trailingPct,
  });
  return c.json({ ok: true });
}
