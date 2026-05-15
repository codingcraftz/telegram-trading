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
  // 시세는 KEY/SECRET만 있으면 OK (계좌 불필요), 매매는 계좌도 필요
  const hasRealMarketKeys = hasRealKeys();
  const hasRealTradeKeys = hasRealMarketKeys && !!process.env.KIS_ACCT_STOCK;
  const tradingMode = getMode();

  let notice = '';
  if (!hasRealMarketKeys) {
    notice = '⚠️ 실전 KEY/SECRET 미입력 — 시세/차트 조회 불가. 설정에서 입력 필요.';
  } else if (!hasRealTradeKeys) {
    notice = '시세/차트 ✅ 실전 키 사용 (1080/min). 실전 계좌 미입력 — 매매는 모의만 가능.';
  } else {
    notice = '시세/차트 ✅ 실전 키. 매매는 현재 모드 사용.';
  }

  return c.json({
    tradingMode,
    paperKeys: hasPaper,
    realKeys: hasRealTradeKeys, // 매매 가능 여부 (계좌 포함)
    realMarketKeys: hasRealMarketKeys, // 시세 조회 가능 여부 (KEY/SECRET만)
    marketDataMode: 'real' as const,
    notice,
  });
}
