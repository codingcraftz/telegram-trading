// 봇 서버 REST API 래퍼. dev에서는 vite proxy → http://localhost:8080.
// 배포에서는 same-origin (Caddy + Hono).

// 세션 만료 등으로 한 번 401 받으면 모든 후속 호출 자동 redirect (중복 redirect 방지).
let redirectingToLogin = false;
function redirectToLogin(): void {
  if (redirectingToLogin) return;
  redirectingToLogin = true;
  const next = encodeURIComponent(location.pathname + location.search);
  location.replace(`/login?next=${next}`);
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) {
    redirectToLogin();
    throw new Error('세션이 만료되었습니다. 로그인 화면으로 이동합니다.');
  }
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
  orderable: (code: string, price: number) =>
    request<{ cash: number | null; qty: number | null; error?: string }>(
      `/api/orderable?code=${code}&price=${Math.round(price)}`,
    ),
  orders: () => request<OrdersResponse>('/api/orders'),
  quote: (code: string) => request<QuoteResponse>(`/api/quote?code=${code}`),
  // 실시간 폴링용 batch — 종목 N개 한 번에. 봇 캐시 (2.5s)와 클라이언트 폴링 (1~3s) 조합.
  quotes: (codes: string[]) =>
    request<{ items: QuotesItem[] }>(`/api/quotes?codes=${codes.join(',')}`),
  search: (q: string) => request<{ items: SearchItem[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  candles: (code: string, interval = '5m', count = 180) =>
    request<CandlesResponse>(`/api/candles?code=${code}&interval=${interval}&count=${count}`),
  indices: () => request<IndicesResponse>('/api/indices'),
  ranking: (category: RankingCategory) =>
    request<RankingResponse>(`/api/ranking?category=${category}`),
  ordersFilled: (days = 7) =>
    request<FilledOrdersResponse>(`/api/orders/filled?days=${days}`),

  // 네이버 테마주
  themes: (limit = 30) => request<{ items: ThemeItem[] }>(`/api/themes?limit=${limit}`),
  themeDetail: (no: number) => request<{ no: number; items: ThemeStock[] }>(`/api/themes/${no}`),
  themeSearch: (q: string) =>
    request<{ q: string; items: (ThemeItem & { matchedStocks: ThemeStock[] })[] }>(
      `/api/themes/search?q=${encodeURIComponent(q)}`,
    ),

  asking: (code: string) => request<AskingResponse>(`/api/asking?code=${code}`),
  watchlist: () => request<WatchlistResponse>('/api/watchlist'),
  strategy: () => request<StrategyResponse>('/api/strategy'),
  version: () => request<{ sha: string; buildDate: string }>('/api/version'),
  checkUpdate: () =>
    request<{
      current: string;
      latest: string;
      latestMessage: string;
      updateAvailable: boolean;
    }>('/api/check-update'),
  triggerUpdate: () =>
    request<{ ok: boolean; message: string }>('/api/update', { method: 'POST' }),
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

  // ===== 전략 시스템 (스텝 5/6) =====
  strategies: () => request<{ items: StrategyItem[] }>('/api/strategies'),
  strategyDetail: (id: string) =>
    request<{ strategy: StrategyItem; applications: StrategyApplicationRow[] }>(
      `/api/strategies/${id}`,
    ),
  createStrategy: (input: CreateStrategyInput) =>
    request<StrategyItem>('/api/strategies', { method: 'POST', body: JSON.stringify(input) }),
  updateStrategy: (id: string, input: UpdateStrategyInput) =>
    request<StrategyItem>(`/api/strategies/${id}`, {
      method: 'PUT', body: JSON.stringify(input),
    }),
  deleteStrategy: (id: string) =>
    request<{ ok: boolean }>(`/api/strategies/${id}`, { method: 'DELETE' }),
  cloneStrategy: (id: string) =>
    request<StrategyItem>(`/api/strategies/${id}/clone`, { method: 'POST' }),
  applyStrategy: (id: string, body: { stockCode: string; budgetAmount?: number }) =>
    request<StrategyApplicationRow>(`/api/strategies/${id}/apply`, {
      method: 'POST', body: JSON.stringify(body),
    }),
  removeApplication: (strategyId: string, appId: string) =>
    request<{ ok: boolean }>(`/api/strategies/${strategyId}/applications/${appId}`, {
      method: 'DELETE',
    }),
  toggleStrategy: (id: string, active: boolean) =>
    request<StrategyItem>(`/api/strategies/${id}/toggle`, {
      method: 'POST', body: JSON.stringify({ active }),
    }),
  strategyExecutions: (id: string, limit = 20) =>
    request<{ items: StrategyExecutionRow[] }>(`/api/strategies/${id}/executions?limit=${limit}`),

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

export type IndexItem = {
  key: string;
  label: string;
  price: number;
  change: number;
  changePct: number;
  prevClose: number;
  series: number[];
};
export type IndicesResponse = { items: IndexItem[] };

export type AskingLevel = { price: number; qty: number };
export type AskingResponse = {
  code: string;
  asks: AskingLevel[];
  bids: AskingLevel[];
  totalAskQty: number;
  totalBidQty: number;
};

export type TickSnapshot = {
  code: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  cumVolume: number;
  ts: number;
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
  tpPct: number | null;
  slPct: number | null;
  trailingPct: number | null;
};

export type TradeBuyBody = {
  code: string;
  strategy: 'mo' | 'now';
  amount: { mode: 'percent' | 'amount' | 'shares'; value: number };
  tp?: number | null;
  sl?: number | null;
  /** 지정가 — 있으면 시장가 대신 이 가격으로 매수 (정규장만) */
  limitPrice?: number | null;
  /** true면 intent 등록 + 즉시 발주 한 번에 (1 round-trip, 빠른 발주) */
  execute?: boolean;
};
export type TradeSellBody = {
  code: string;
  qtyMode: 'all' | 'half' | 'shares';
  qtyValue?: number;
  execute?: boolean;
};
export type TradeExecuteResult = {
  ok: boolean;
  message: string;
  positionId?: string;
  orderId?: string;
};
export type TradeBuyResponse = { kind: string; id: string; text: string; executed?: boolean; result?: TradeExecuteResult };
export type TradeSellResponse = { kind: string; id: string; text: string; executed?: boolean; result?: TradeExecuteResult };
export type RankingCategory = 'volume' | 'qty' | 'change_up' | 'change_down';
export type RankingItem = {
  rank: number;
  code: string;
  name: string;
  price: number;
  changePct: number;
  volume: number;
  tradeAmount: number;
};
export type RankingResponse = {
  category: RankingCategory;
  items: RankingItem[];
};

export type FilledOrder = {
  ts: number;
  orderDate: string;
  orderTime: string;
  code: string;
  name: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  amount: number;
  orgno: string;
  odno: string;
  /** 매도 체결의 실현 손익(원). 서버가 채워주면 표시. 없으면 미표시. */
  pnl?: number | null;
};
export type FilledOrdersResponse = {
  days: number;
  items: FilledOrder[];
  error?: string;
};

export type ThemeItem = {
  no: number;
  name: string;
  changePct: number;
  upCount: number;
  flatCount: number;
  downCount: number;
  leadingStocks: string[];
};
export type ThemeStock = {
  code: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
};

export type TradeConfirmResponse = {
  ok: boolean;
  message: string;
  positionId?: string;
  orderId?: string;
  diagnostics?: unknown;
};

// ===== 전략 시스템 (스텝 5/6) =====
export type StagedMorningStage = {
  entryPct: number;
  triggerDropPct?: number;
};
export type StagedMorningTp = {
  tp1?: { enabled: boolean; atPct: number; sellPct: number };
  tp2?: { enabled: boolean; atPct: number };
};
export type StagedMorningSl = { enabled: boolean; atPct: number };
export type StagedMorningBudget =
  | { mode: 'fixed_amount'; value: number }
  | { mode: 'cash_ratio'; value: number };

export type StrategyEntry =
  | { type: 'morning' }
  | { type: 'limit_price'; targetPrice: number; direction: 'above' | 'below' }
  | {
      type: 'morning_staged';
      budget: StagedMorningBudget;
      stages: StagedMorningStage[];
      takeProfit?: StagedMorningTp;
      stopLoss?: StagedMorningSl;
    };

export type StrategyOrderMethod =
  | { method: 'market' }
  | { method: 'limit'; limitPrice: number };

export type StrategyQuantity =
  | { mode: 'fixed_shares'; value: number }
  | { mode: 'fixed_amount'; value: number }
  | { mode: 'cash_ratio'; value: number };

export type StrategyExit = {
  takeProfit?: { enabled: boolean; pct: number };
  stopLoss?: { enabled: boolean; pct: number };
};

export type StrategyValidity = { type: 'once' } | { type: 'forever' };

export type StrategyDefinition = {
  entry: StrategyEntry;
  order: StrategyOrderMethod;
  quantity: StrategyQuantity;
  exit?: StrategyExit;
  validity: StrategyValidity;
};

export type StrategyItem = {
  id: string;
  name: string;
  version: number;
  active: boolean;
  definition: StrategyDefinition;
  createdAt: number;
  updatedAt: number;
  applicationCount: number;
};

export type StrategyApplicationRow = {
  id: string;
  strategyId: string;
  chatId: number;
  stockCode: string;
  status: 'active' | 'paused' | 'completed' | 'failed';
  appliedAt: number;
  lastEvaluatedAt: number | null;
};

export type StrategyExecutionRow = {
  id: string;
  strategyId: string;
  applicationId: string;
  chatId: number;
  stockCode: string;
  triggeredAt: number;
  action: 'buy' | 'sell' | 'no_op';
  result: 'success' | 'failure' | 'skipped';
  payload: unknown | null;
  errorMessage: string | null;
};

export type CreateStrategyInput = {
  name: string;
  active?: boolean;
  definition: StrategyDefinition;
};

export type UpdateStrategyInput = {
  version: number;
  name?: string;
  active?: boolean;
  definition?: StrategyDefinition;
};
