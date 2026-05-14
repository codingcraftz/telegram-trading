// chat별 단기 모드 상태 (메모리). 봇 재시작 시 초기화.
// 사용 예: 사용자가 [➕ 종목 추가] 누르면 mode='awaiting_watchlist_add' 저장 →
// 다음 텍스트 메시지를 종목명으로 처리.

export type ChatMode =
  | 'idle'
  | 'awaiting_watchlist_add'
  | 'awaiting_chart_symbol'
  | 'awaiting_trade_buy_search'
  | 'awaiting_trade_buy_amount'
  | 'awaiting_trade_sell_qty';

// 거래 흐름에서 다음 메시지가 필요한 경우 추가 컨텍스트.
export type ChatMeta = {
  buyCode?: string; // 매수 금액 직접 입력 시 종목 코드
  buyStrategy?: string;
  sellCode?: string; // 매도 수량 직접 입력 시 종목 코드
};

type State = { mode: ChatMode; meta?: ChatMeta; updatedAt: number };

const _state = new Map<number, State>();
const TTL_MS = 5 * 60 * 1000; // 5분 후 자동 만료

export function getChatMode(chatId: number): ChatMode {
  const s = _state.get(chatId);
  if (!s) return 'idle';
  if (Date.now() - s.updatedAt > TTL_MS) {
    _state.delete(chatId);
    return 'idle';
  }
  return s.mode;
}

export function getChatMeta(chatId: number): ChatMeta | undefined {
  return _state.get(chatId)?.meta;
}

export function setChatMode(chatId: number, mode: ChatMode, meta?: ChatMeta) {
  if (mode === 'idle') {
    _state.delete(chatId);
    return;
  }
  _state.set(chatId, { mode, meta, updatedAt: Date.now() });
}

export function clearChatMode(chatId: number) {
  _state.delete(chatId);
}
