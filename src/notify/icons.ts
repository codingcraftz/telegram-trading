// 상태/세션 표시 아이콘 컨벤션. 메시지/알림 전반에서 일관성 유지.

export const ICON = {
  // 상태
  ok: '✅',
  fail: '❌',
  expired: '⌛',
  pending: '⏳',
  warn: '⚠️',

  // 주문 종류
  submit: '📨',
  sellOrder: '📤',
  buyOrder: '📥',

  // 청산 사유
  tp: '🎯',
  sl: '🛑',
  manual: '✋',
  schedule: '📅',

  // 시장 세션
  marketOpen: '🟢',
  marketAfter: '🟡',
  marketClosed: '🔴',
} as const;
