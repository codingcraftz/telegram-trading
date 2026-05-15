// 관심종목 (watchlist) 명령 처리.
//   /관심종목 (alias /watchlist)            → 번호 매겨 목록
//   /관심종목추가 [종목명] (alias /watchlist_add)
//                                           → 정확 매칭 1개면 즉시 추가
//                                              여러 후보면 InlineKeyboard로 선택
//                                              0개면 KIS find_stock_code 폴백
//                                              인자 없으면 안내
//   /관심종목제거 1, 2 / 1 2 / 1, 2, 3 (alias /watchlist_remove)
//                                           → 번호 파싱 → 일괄 제거

import { InlineKeyboard } from 'grammy';
import {
  addWatchlist,
  listWatchlist,
  removeWatchlistByIds,
  resolveWatchlistOrdinals,
} from '../db/repo.js';

// 단건 제거 — id 직접 받음
export function removeWatchlistOne(chatId: number, id: number): number {
  return removeWatchlistByIds(chatId, [id]);
}
import { resolveSymbol, searchSymbolCandidates } from './symbol.js';
import { fetchQuickQuote } from './price.js';
import type { ResolvedSymbol } from './symbol.js';

export function renderWatchlist(chatId: number): string {
  const rows = listWatchlist(chatId);
  if (rows.length === 0) {
    return '⭐ 관심종목 비어 있음. 추가: <code>/관심종목추가 삼성전자</code>';
  }
  const lines = ['⭐ <b>관심종목</b>'];
  rows.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.symbolName} (${r.market}/${r.symbolCode})`);
  });
  lines.push('');
  lines.push('제거: <code>/관심종목제거 1, 2</code>');
  return lines.join('\n');
}

export async function handleWatchlistAdd(
  chatId: number,
  arg: string,
): Promise<{ kind: 'text'; text: string } | { kind: 'choices'; text: string; kb: InlineKeyboard }> {
  const q = arg.trim();
  if (!q) {
    return {
      kind: 'text',
      text: '검색어를 입력해주세요.\n예: <code>삼성전자</code> · <code>005930</code>',
    };
  }

  // 6자리 코드면 마스터에서 종목명 조회 → 후보 1개로 표시
  const candidates: ResolvedSymbol[] = [];
  if (/^\d{6}$/.test(q)) {
    const exact = await resolveSymbol(q);
    if (exact) candidates.push(exact);
  } else {
    candidates.push(...searchSymbolCandidates(q, 10));
  }

  if (candidates.length === 0) {
    const kb = new InlineKeyboard()
      .text('🔍 다시 입력', 'wlmenu:add')
      .text('⬅️ 뒤로', 'wlmenu:back');
    return {
      kind: 'choices',
      text:
        `❓ "${q}" 검색 결과 없음.\n` +
        '오타가 아닌지 확인하거나 6자리 종목코드(예: <code>005930</code>)를 입력해 보세요.',
      kb,
    };
  }
  const kb = new InlineKeyboard();
  for (const c of candidates) {
    kb.text(`${c.name} (${c.code})`, `wladd:${c.code}:${c.name}`).row();
  }
  kb.text('⬅️ 뒤로', 'wlmenu:back');
  return {
    kind: 'choices',
    text:
      candidates.length === 1
        ? `🔍 "${q}" 검색 결과 (1개). 누르면 추가됩니다.`
        : `🔍 "${q}" 검색 결과 (${candidates.length}개). 추가할 종목을 누르세요.`,
    kb,
  };
}

export function handleWatchlistRemove(chatId: number, arg: string): string {
  const q = arg.trim();
  if (!q) return '사용: <code>/관심종목제거 1, 2</code> 또는 <code>/관심종목제거 1 2</code>';
  // 1, 2, 3 / 1 2 3 / 1,2,3 모두 지원 — 숫자 토큰만 추출
  const nums = (q.match(/\d+/g) ?? []).map(Number).filter((n) => n > 0);
  if (nums.length === 0) return '제거할 번호를 못 읽었습니다. 예: <code>/관심종목제거 1, 2</code>';
  const ids = resolveWatchlistOrdinals(chatId, nums);
  if (ids.length === 0) return '⚠️ 해당 번호 없음. <code>/관심종목</code>으로 확인하세요.';
  const removed = removeWatchlistByIds(chatId, ids);
  return `🗑️ ${removed}개 제거됨\n\n` + renderWatchlist(chatId);
}

// callback "wladd:<code>:<name>" 처리
export function handleWatchlistAddCallback(
  chatId: number,
  code: string,
  name: string,
): string {
  const r = addWatchlist({ chatId, market: 'KRX', symbolCode: code, symbolName: name });
  return r.added
    ? `✅ 관심종목 추가: ${name} (${code})`
    : `이미 관심종목에 있음: ${name} (${code})`;
}

// 관심종목 메뉴 — 종목명만 단순 표시. 시세는 [🔍 시세조회] 메뉴에서 별도.
export function buildWatchlistMenu(chatId: number): { text: string; kb: InlineKeyboard } {
  const rows = listWatchlist(chatId);
  const kb = new InlineKeyboard();
  if (rows.length === 0) {
    kb.text('➕ 추가', 'wlmenu:add');
    return {
      text: '⭐ <b>관심종목 비어있음</b>\n\n[➕ 추가] 버튼으로 시작해보세요.',
      kb,
    };
  }
  const list =
    '⭐ <b>관심종목</b>\n' +
    rows.map((r, i) => `${i + 1}. ${r.symbolName} <code>${r.symbolCode}</code>`).join('\n') +
    '\n\n💡 시세는 [🔍 시세조회] 메뉴에서 확인하세요.';
  kb.text('➕ 추가', 'wlmenu:add').text('🗑️ 제거', 'wlmenu:rm');
  return { text: list, kb };
}

// 제거 화면 — 종목별 버튼
export function buildWatchlistRemoveMenu(chatId: number): { text: string; kb: InlineKeyboard } {
  const rows = listWatchlist(chatId);
  if (rows.length === 0) {
    return {
      text: '관심종목이 비어있습니다.',
      kb: new InlineKeyboard().text('⬅️ 뒤로', 'wlmenu:back'),
    };
  }
  const kb = new InlineKeyboard();
  rows.forEach((r, i) => {
    kb.text(`❌ ${r.symbolName}`, `wlrm:${r.id}`);
    if (i % 2 === 1) kb.row();
  });
  if (rows.length % 2 === 1) kb.row();
  kb.text('⬅️ 뒤로', 'wlmenu:back');
  return { text: '🗑️ 제거할 종목을 누르세요', kb };
}

// 추가 입력 안내 (단순)
export function buildWatchlistAddPrompt(): { text: string; kb: InlineKeyboard } {
  return {
    text:
      '➕ <b>관심종목 추가</b>\n' +
      '검색어를 입력해주세요.\n' +
      '예: <code>삼성전자</code> · <code>삼성</code> · <code>005930</code>',
    kb: new InlineKeyboard().text('⬅️ 취소', 'wlmenu:back'),
  };
}
