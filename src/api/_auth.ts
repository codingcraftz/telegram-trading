// PWA용 chatId — 현재는 1인 self-hosted 환경.
// 텔레그램 알림이 활성이면 ALLOWED_CHAT_IDS 첫 항목, 아니면 기본 1.
// Caddy basic_auth가 앞단에서 인증하므로 봇 측에선 신뢰. 향후 멀티유저 시 JWT 도입.

import { getConfig } from '../config.js';

const DEFAULT_CHAT_ID = 1;
let _cached: number | null = null;

export function getDefaultChatId(): number {
  if (_cached !== null) return _cached;
  try {
    const ids = getConfig().ALLOWED_CHAT_IDS;
    // 알림 안 받는 사용자도 매매는 가능해야 — 빈 배열이면 기본값 1.
    _cached = ids[0] ?? DEFAULT_CHAT_ID;
  } catch {
    _cached = DEFAULT_CHAT_ID;
  }
  return _cached;
}
