// PWA용 chatId — 현재는 1인 self-hosted 환경이라 ALLOWED_CHAT_IDS 첫 항목 사용.
// Caddy basic_auth가 앞단에서 인증하므로 봇 측에선 신뢰. 향후 멀티유저 시 JWT 도입.

import { getConfig } from '../config.js';

let _cached: number | null = null;

export function getDefaultChatId(): number {
  if (_cached !== null) return _cached;
  try {
    const ids = getConfig().ALLOWED_CHAT_IDS;
    _cached = ids[0] ?? 0;
  } catch {
    // getConfig가 throw하는 경우 (키 미입력) — 0 반환. 일부 API는 chatId 0이어도 동작 (예: 시세).
    _cached = 0;
  }
  return _cached;
}
