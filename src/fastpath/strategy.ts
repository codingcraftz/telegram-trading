// 전략 관리 메뉴.
// Phase 1: 시가매매 전략 1개 (기본 제공) 편집.
//   /시가매매 set 명령을 InlineKeyboard로 wrap — TP/SL/갭가드/트레일링 빠른 변경.
// Phase 2(추후): 전략 추가 — 사용자 정의 전략.

import { InlineKeyboard } from 'grammy';
import {
  DEFAULT_GAP_GUARD_PCT,
  getMarketOpenSettings,
  upsertMarketOpenSettings,
} from '../db/repo.js';

function fmtGap(v: number | null | undefined): string {
  if (v === null || v === undefined) return `±${DEFAULT_GAP_GUARD_PCT}% (기본)`;
  if (v === 0) return '끄기';
  return `±${v}%`;
}
function fmtPct(v: number | null | undefined, prefix: '+' | '-'): string {
  if (v === null || v === undefined) return '끄기';
  return `${prefix}${v}%`;
}

// ============================================================
// 전략 메인 (보유 중인 전략 목록)
// ============================================================

export function buildStrategyMainMenu(): { text: string; kb: InlineKeyboard } {
  const kb = new InlineKeyboard()
    .text('⏰ 시가매매', 'st:mo')
    .row()
    .text('+ 전략 추가', 'st:add')
    .row();
  return {
    text:
      '🧩 <b>전략</b>\n' +
      '보유 중인 전략을 누르면 편집할 수 있고, 새 전략도 만들 수 있어요.\n\n' +
      '거래 시 매수 흐름에서 이 전략 중 하나를 선택해 자동 매수·TP·SL이 적용됩니다.',
    kb,
  };
}

// ============================================================
// 시가매매 편집
// ============================================================

export function buildMarketOpenStrategyView(chatId: number): {
  text: string;
  kb: InlineKeyboard;
} {
  const s = getMarketOpenSettings(chatId);
  const lines = [
    '⏰ <b>시가매매 전략</b> (기본 제공)',
    '─────────────────',
    '🕘 매수 시점: 다음 영업일 09:00:05',
    '💰 주문 방식: 시장가',
    `🛡️ 갭가드: ${fmtGap(s?.gapGuardPct)}`,
    `🎯 TP: ${fmtPct(s?.tpPct, '+')} (매수 체결가 기준)`,
    `🚨 SL: ${fmtPct(s?.slPct, '-')} (매수 체결가 기준)`,
    `📈 트레일링: 🚧 구현 예정`,
    '─────────────────',
  ];
  const kb = new InlineKeyboard()
    .text('🛡️ 갭가드', 'st:mo:gap')
    .text('🎯 TP', 'st:mo:tp')
    .text('🚨 SL', 'st:mo:sl')
    .row()
    .text('⬅️ 뒤로', 'st:main');
  return { text: lines.join('\n'), kb };
}

// 각 항목 편집 — 빠른 % 옵션 + 끄기/직접 입력
type EditField = 'gap' | 'tp' | 'sl' | 'trail';

const QUICK_OPTIONS: Record<EditField, number[]> = {
  gap: [3, 5, 7, 10],
  tp: [3, 5, 10, 15, 20],
  sl: [3, 5, 7, 10],
  trail: [3, 5, 10],
};

const FIELD_LABELS: Record<EditField, { title: string; emoji: string; signed: '+' | '-' | '±' }> = {
  gap: { title: '갭가드', emoji: '🛡️', signed: '±' },
  tp: { title: 'TP (익절)', emoji: '🎯', signed: '+' },
  sl: { title: 'SL (손절)', emoji: '🚨', signed: '-' },
  trail: { title: '트레일링', emoji: '📈', signed: '+' },
};

export function buildEditField(field: EditField): { text: string; kb: InlineKeyboard } {
  const meta = FIELD_LABELS[field];
  const kb = new InlineKeyboard();
  QUICK_OPTIONS[field].forEach((p, i) => {
    kb.text(`${meta.signed}${p}%`, `st:mo:set:${field}:${p}`);
    if (i % 4 === 3) kb.row();
  });
  kb.row().text('끄기', `st:mo:set:${field}:off`).text('⬅️ 뒤로', 'st:mo');
  return {
    text: `${meta.emoji} <b>${meta.title}</b> 수정\n빠른 옵션을 누르거나 [끄기]를 선택하세요.`,
    kb,
  };
}

export function applyFieldChange(
  chatId: number,
  field: EditField,
  rawValue: string,
): { ok: true; message: string } | { ok: false; message: string } {
  let value: number | null;
  if (rawValue === 'off') value = field === 'gap' ? 0 : null; // gap=0이 끄기 의미
  else {
    const n = Number(rawValue);
    if (!Number.isFinite(n) || n < 0) return { ok: false, message: '잘못된 값' };
    value = n;
  }
  const updates: Parameters<typeof upsertMarketOpenSettings>[0] = { chatId };
  if (field === 'gap') updates.gapGuardPct = value;
  else if (field === 'tp') updates.tpPct = value;
  else if (field === 'sl') updates.slPct = value;
  else if (field === 'trail') updates.trailingPct = value;
  upsertMarketOpenSettings(updates);
  const label = FIELD_LABELS[field].title;
  return { ok: true, message: `✅ ${label} 갱신됨` };
}

// ============================================================
// 전략 추가 — 미구현 안내 (Phase 2)
// ============================================================

export function buildStrategyAddPlaceholder(): { text: string; kb: InlineKeyboard } {
  return {
    text:
      '🚧 <b>전략 추가</b>\n' +
      '아직 준비 중입니다.\n\n' +
      '다음 버전에서 추가 예정:\n' +
      '• 전략명 자유 입력\n' +
      '• 매수 시점 (예약/즉시)\n' +
      '• 주문 방식 (시장가/지정가)\n' +
      '• 갭가드 / TP / SL / 트레일링',
    kb: new InlineKeyboard().text('⬅️ 뒤로', 'st:main'),
  };
}
