// GET /api/session — 현재 시장 세션 + 다음 개장 시각.

import type { Context } from 'hono';
import { getMarketSession, nextMarketOpen, sessionLabel } from '../scheduler/calendar.js';

export function handleSession(c: Context) {
  const now = new Date();
  const session = getMarketSession(now);
  const label = sessionLabel(session);
  return c.json({
    session,
    label: label.label,
    icon: label.icon,
    nextOpen: nextMarketOpen(now).toISOString(),
    nowKst: new Date(now.getTime() + 9 * 3600 * 1000).toISOString(),
  });
}
