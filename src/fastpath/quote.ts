// 시세조회 메뉴 — 관심종목 + 검색 → 종목 선택 → 현재가/등락률/OHLC/거래량 표시.
//   메인 키보드 [🔍 시세조회] 진입점.

import { InlineKeyboard } from 'grammy';
import { listWatchlist } from '../db/repo.js';
import { handlePriceQuery } from './price.js';
import type { ResolvedSymbol } from './symbol.js';

export function buildQuoteMainMenu(chatId: number): { text: string; kb: InlineKeyboard } {
  const wl = listWatchlist(chatId);
  const kb = new InlineKeyboard();
  for (const w of wl) {
    kb.text(w.symbolName, `qm:pick:${w.symbolCode}`).row();
  }
  kb.text('🔍 검색하기', 'qm:search');
  const text =
    wl.length === 0
      ? '🔍 <b>시세조회</b>\n관심종목이 없습니다. [🔍 검색하기]로 종목을 찾아보세요.'
      : '🔍 <b>시세조회</b>\n관심종목 중 선택하거나 [🔍 검색하기]를 누르세요.';
  return { text, kb };
}

export function buildQuoteSearchPrompt(): { text: string; kb: InlineKeyboard } {
  return {
    text:
      '🔍 <b>시세조회 — 종목 검색</b>\n' +
      '검색어를 입력해주세요.\n' +
      '예: <code>삼성전자</code> · <code>005930</code>',
    kb: new InlineKeyboard().text('⬅️ 뒤로', 'qm:back'),
  };
}

export function buildQuoteSearchResults(
  q: string,
  candidates: ResolvedSymbol[],
): { text: string; kb: InlineKeyboard } {
  const kb = new InlineKeyboard();
  for (const c of candidates) {
    kb.text(`${c.name} (${c.code})`, `qm:pick:${c.code}`).row();
  }
  kb.text('⬅️ 뒤로', 'qm:back');
  return {
    text: `🔍 "${q}" 검색 결과 (${candidates.length}개)`,
    kb,
  };
}

// 종목 시세 응답 — handlePriceQuery 재사용 + 추가 액션 버튼
export async function buildQuoteResult(
  code: string,
): Promise<{ text: string; kb: InlineKeyboard }> {
  const text = await handlePriceQuery(code);
  const kb = new InlineKeyboard()
    .text('📈 차트', `chartpick:${code}`)
    .text('🔄 새로고침', `qm:pick:${code}`)
    .row()
    .text('⬅️ 뒤로', 'qm:back');
  return { text, kb };
}
