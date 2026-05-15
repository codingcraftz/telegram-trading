// GET /api/session — 현재 시장 세션 + 다음 개장 시각.
// GET /api/keys-status — 어떤 키가 활성인지 (시세는 실전 키 우선)

import type { Context } from 'hono';
import { getMarketSession, nextMarketOpen, sessionLabel } from '../scheduler/calendar.js';
import { getMode } from '../runtime.js';
import { hasRealKeys } from '../kis/config.js';

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

export function handleKeysStatus(c: Context) {
  const hasPaper = !!(
    process.env.KIS_PAPER_APP_KEY &&
    process.env.KIS_PAPER_APP_SECRET &&
    process.env.KIS_PAPER_STOCK
  );
  const hasReal = hasRealKeys() && !!process.env.KIS_ACCT_STOCK;
  const tradingMode = getMode();
  return c.json({
    tradingMode, // 'paper' | 'real' — 실제 매매에 사용
    paperKeys: hasPaper,
    realKeys: hasReal,
    // 시장 데이터는 실전 키 있으면 그쪽으로 (rate limit 분당 1080), 없으면 모의(60)
    marketDataMode: hasReal ? 'real' : tradingMode === 'real' ? 'real' : 'demo',
    notice: hasReal
      ? '시세/차트는 실전 키 사용 (rate limit 여유), 매매는 현재 모드 사용'
      : '실전 키가 없어 시세/차트도 모의 키로 호출 (rate limit 분당 60건)',
  });
}
