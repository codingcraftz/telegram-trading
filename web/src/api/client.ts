// 봇 서버 REST API 래퍼. dev에서는 vite proxy → http://localhost:8080.
// 배포에서는 same-origin (Caddy + Hono).

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string; message?: string };
      msg = j.error ?? j.message ?? msg;
    } catch {}
    throw new Error(msg);
  }
  // PNG 같은 binary는 호출 측에서 별도 처리. 여기는 JSON 가정.
  return (await res.json()) as T;
}

export const api = {
  // 조회
  session: () => request<SessionResponse>('/api/session'),
  balance: () => request<BalanceResponse>('/api/balance'),
  orders: () => request<OrdersResponse>('/api/orders'),
  quote: (code: string) => request<QuoteResponse>(`/api/quote?code=${code}`),
  // 실시간 폴링용 batch — 종목 N개 한 번에. 봇 캐시 (2.5s)와 클라이언트 폴링 (1~3s) 조합.
  quotes: (codes: string[]) =>
    request<{ items: QuotesItem[] }>(`/api/quotes?codes=${codes.join(',')}`),
  search: (q: string) => request<{ items: SearchItem[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  candles: (code: string, interval = '5m', count = 180) =>
    request<CandlesResponse>(`/api/candles?code=${code}&interval=${interval}&count=${count}`),
  watchlist: () => request<WatchlistResponse>('/api/watchlist'),
  strategy: () => request<StrategyResponse>('/api/strategy'),
  version: () => request<{ sha: string; buildDate: string }>('/api/version'),
  keysStatus: () =>
    request<{
      tradingMode: 'paper' | 'real';
      paperKeys: boolean;
      realKeys: boolean;
      realMarketKeys: boolean;
      marketDataMode: 'demo' | 'real';
      notice: string;
    }>('/api/keys-status'),

  // 매매 액션
  tradeBuy: (body: TradeBuyBody) =>
    request<TradeBuyResponse>('/api/trade/buy', { method: 'POST', body: JSON.stringify(body) }),
  tradeSell: (body: TradeSellBody) =>
    request<TradeSellResponse>('/api/trade/sell', { method: 'POST', body: JSON.stringify(body) }),
  tradeConfirm: (id: string) =>
    request<TradeConfirmResponse>(`/api/trade/confirm/${id}`, { method: 'POST' }),
  tradeCancel: (id: string) =>
    request<{ ok: boolean; message: string }>(`/api/trade/cancel/${id}`, { method: 'POST' }),
  cancelKis: (body: { orgno: string; odno: string; ordDvsn?: string; qty?: number }) =>
    request<{ ok: boolean; message?: string }>('/api/trade/cancel-kis', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // 관심종목
  watchlistAdd: (code: string) =>
    request<{ ok: boolean; added: boolean; existed: boolean; code: string; name: string }>(
      '/api/watchlist/add',
      { method: 'POST', body: JSON.stringify({ code }) },
    ),
  watchlistRemove: (id: number) =>
    request<{ ok: boolean; removed: number }>(`/api/watchlist/remove/${id}`, { method: 'POST' }),

  // 시가매매 셋팅
  strategySave: (body: Partial<StrategyResponse>) =>
    request<{ ok: boolean }>('/api/strategy', { method: 'POST', body: JSON.stringify(body) }),

  // 차트 PNG URL (img src에 직접 사용)
  chartUrl: (code: string, interval = '1d') => `/api/chart?code=${code}&interval=${interval}`,
};

// ===== 타입 =====
export type SessionResponse = {
  session: string;
  label: string;
  icon: string;
  nextOpen: string;
  nowKst: string;
};

export type Holding = {
  code: string;
  name: string;
  qty: number;
  orderable: number;
  avg: number;
  cur: number;
  pflsAmt: number;
  pflsRt: number;
};

export type BalanceResponse = {
  totalEvlu: number;
  cash: number;
  totalPfls: number;
  totalPflsRt: number;
  nextDaySettlement: number;
  session: { session: string; label: string; icon: string };
  holdings: Holding[];
};

export type QuoteResponse = {
  code: string;
  name: string;
  industry: string;
  price: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changeRate: number;
  signLabel: string;
  volume: number;
  tradeAmount: number;
  week52High: number;
  week52Low: number;
  per: string | null;
  pbr: string | null;
  eps: string | null;
  bps: string | null;
  foreignerRatio: number;
};

export type SearchItem = { code: string; name: string };

export type CandlesResponse = {
  code: string;
  interval: string;
  count: number;
  candles: Array<{
    ts: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
};

export type QuotesItem = {
  code: string;
  name: string;
  ok: boolean;
  price: number;
  changePct: number;
  signLabel: string;
};

export type WatchlistItem = {
  id: number;
  code: string;
  name: string;
  market: string;
  addedAt: number;
};
export type WatchlistResponse = { items: WatchlistItem[] };

export type OrdersResponse = {
  intents: {
    id: string;
    action: 'buy' | 'sell' | '?';
    code: string;
    name: string;
    quantity: number;
    orderType: string;
    price: number | null;
    tpPct: number | null;
    slPct: number | null;
    createdAt: number;
    expiresAt: number;
    remainingMs: number;
  }[];
  reservations: {
    id: string;
    code: string;
    name: string;
    qtyMode: 'shares' | 'amount' | 'percent';
    qtyValue: number;
    gapGuardPct: number | null;
    tpPct: number | null;
    slPct: number | null;
    scheduledFor: number;
    state: string;
    expiresAt: number;
    remainingMs: number | null;
  }[];
  kis: {
    ok: boolean;
    error?: string;
    items: {
      code: string;
      name: string;
      side: string;
      qty: number;
      price: number;
      filled: number;
      remaining: number;
      time: string;
      orgno: string;
      odno: string;
      ordDvsn: string;
    }[];
  };
};

export type StrategyResponse = {
  gapGuardPct: number | null;
  tpPct: number | null;
  slPct: number | null;
  trailingPct: number | null;
  defaultGapGuardPct: number;
};

export type TradeBuyBody = {
  code: string;
  strategy: 'mo' | 'now';
  amount: { mode: 'percent' | 'amount' | 'shares'; value: number };
  tp?: number | null;
  sl?: number | null;
};
export type TradeSellBody = {
  code: string;
  qtyMode: 'all' | 'half' | 'shares';
  qtyValue?: number;
};
export type TradeBuyResponse = { kind: string; id: string; text: string };
export type TradeSellResponse = { kind: string; id: string; text: string };
export type TradeConfirmResponse = {
  ok: boolean;
  message: string;
  positionId?: string;
  orderId?: string;
  diagnostics?: unknown;
};
