// GET /api/session — 현재 시장 세션 + 다음 개장 시각.
// GET /api/keys-status — 어떤 키가 활성인지 (시세는 실전 키 우선)

import type { Context } from 'hono';
import { getMarketSession, nextMarketOpen, sessionLabel } from '../scheduler/calendar.js';
import { getMode } from '../runtime.js';
import { hasRealKeys } from '../kis/config.js';
import { getAccessToken } from '../kis/auth.js';

// 실제 KIS 인증 가능 여부 캐시 (5분).
// 환경변수만으로는 키가 맞는지 확실치 않음 → 토큰 발급 시도해서 성공해야 '연결됨'.
type ConnCache = { ok: boolean; checkedAt: number };
const _connCache = new Map<'real' | 'demo', ConnCache>();
async function probeConnection(mode: 'real' | 'demo'): Promise<boolean> {
  const cached = _connCache.get(mode);
  if (cached && Date.now() - cached.checkedAt < 5 * 60 * 1000) return cached.ok;
  try {
    await getAccessToken(mode);
    _connCache.set(mode, { ok: true, checkedAt: Date.now() });
    return true;
  } catch {
    _connCache.set(mode, { ok: false, checkedAt: Date.now() });
    return false;
  }
}

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

export async function handleKeysStatus(c: Context) {
  const hasPaperEnv = !!(
    process.env.KIS_PAPER_APP_KEY &&
    process.env.KIS_PAPER_APP_SECRET &&
    process.env.KIS_PAPER_STOCK
  );
  const hasRealMarketKeys = hasRealKeys();
  const hasRealAcct = !!process.env.KIS_ACCT_STOCK;
  const tradingMode = getMode();

  // 환경변수가 있으면 실제 KIS 토큰 발급 시도해서 연결 여부 확정 (5분 캐시).
  const [paperConnected, realConnected] = await Promise.all([
    hasPaperEnv ? probeConnection('demo') : Promise.resolve(false),
    hasRealMarketKeys ? probeConnection('real') : Promise.resolve(false),
  ]);

  let notice = '';
  if (!hasRealMarketKeys && !hasPaperEnv) {
    notice = '⚠️ KIS 키 미입력 — 시세/매매 모두 불가. 설정에서 입력 필요.';
  } else if (hasRealMarketKeys && !realConnected) {
    notice = '⚠️ 실전 키 입력됐지만 KIS 인증 실패 — 키 다시 확인해주세요.';
  } else if (hasPaperEnv && !paperConnected) {
    notice = '⚠️ 모의 키 입력됐지만 KIS 인증 실패 — 키 다시 확인해주세요.';
  } else if (hasRealMarketKeys && !hasRealAcct) {
    notice = '시세 ✅ 실전 키. 실전 계좌 미입력 — 매매는 모의로만 가능.';
  } else {
    notice = '연결 정상.';
  }

  return c.json({
    tradingMode,
    // 환경변수 + 실제 인증 둘 다 OK 일 때 '연결됨'
    paperKeys: hasPaperEnv && paperConnected,
    realKeys: hasRealMarketKeys && realConnected && hasRealAcct, // 시세+인증+계좌 = 매매 가능
    realMarketKeys: hasRealMarketKeys && realConnected, // 시세+인증 = 시세 가능
    marketDataMode: 'real' as const,
    notice,
  });
}
