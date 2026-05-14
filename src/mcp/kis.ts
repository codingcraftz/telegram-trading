// KIS Trading MCP의 카테고리 도구를 우리 코드가 쓰기 쉽도록 감싸는 wrapper.
// MCP는 카테고리별로 1개 도구를 등록하고, api_type+params로 실제 API를 식별함.
//   예: domestic_stock(api_type="order_cash", params={...})
//      overseas_stock(api_type="order",      params={...})
//
// cano (계좌번호), acnt_prdt_cd, my_htsid 는 MCP가 자동 주입하므로 우리는 안 넣음.

import { callTool } from './client.js';
import { applyDefaults } from './defaults.js';
import { envDv as runtimeEnvDv } from '../runtime.js';

export type Market =
  | 'KRX'      // 국내
  | 'NASDAQ'
  | 'NYSE'
  | 'AMEX'
  | 'TSE'      // 도쿄
  | 'HKEX'     // 홍콩
  | 'SSE'      // 상해
  | 'SZSE'    // 심천
  | 'HNX'      // 베트남 하노이
  | 'HSX';     // 베트남 호치민

export function isDomestic(m: Market): boolean {
  return m === 'KRX';
}

// 시장 → KIS excd 코드
const MARKET_TO_EXCD: Record<Exclude<Market, 'KRX'>, string> = {
  NASDAQ: 'NAS',
  NYSE: 'NYS',
  AMEX: 'AMS',
  TSE: 'TSE',
  HKEX: 'HKS',
  SSE: 'SHS',
  SZSE: 'SZS',
  HNX: 'HNX',
  HSX: 'HSX',
};

export const envDv = runtimeEnvDv;

export async function callKisApi(
  category: string,
  apiType: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  return callTool(category, {
    api_type: apiType,
    params: applyDefaults(category, apiType, params),
  });
}

// ============================================================
// 시세
// ============================================================
export async function getQuote(market: Market, code: string): Promise<unknown> {
  if (isDomestic(market)) {
    return callKisApi('domestic_stock', 'inquire_price', {
      fid_cond_mrkt_div_code: 'J',
      fid_input_iscd: code,
    });
  }
  return callKisApi('overseas_stock', 'price', {
    excd: MARKET_TO_EXCD[market as Exclude<Market, 'KRX'>],
    symb: code,
  });
}

// ============================================================
// 분봉 차트 (국내만, 당일 1분봉)
// ============================================================
function nowKstHhmmss(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mm = String(kst.getUTCMinutes()).padStart(2, '0');
  const ss = String(kst.getUTCSeconds()).padStart(2, '0');
  return `${hh}${mm}${ss}`;
}

export async function getMinuteChart(code: string, hour?: string): Promise<unknown> {
  // 장중이면 현재 KST, 그 외엔 장 마감 시각(15:30:00)
  let h = hour ?? '';
  if (!h) {
    const cur = nowKstHhmmss();
    h = cur >= '090000' && cur <= '153000' ? cur : '153000';
  }
  return callKisApi('domestic_stock', 'inquire_time_itemchartprice', {
    fid_input_iscd: code,
    fid_input_hour_1: h,
  });
}

// ============================================================
// 잔고
// ============================================================
export async function getBalance(market: Market): Promise<unknown> {
  if (isDomestic(market)) {
    return callKisApi('domestic_stock', 'inquire_balance', {});
  }
  return callKisApi('overseas_stock', 'inquire_balance', {
    ovrs_excg_cd: MARKET_TO_EXCD[market as Exclude<Market, 'KRX'>],
  });
}

// ============================================================
// 주문
// ============================================================
export async function placeOrder(args: {
  market: Market;
  side: 'buy' | 'sell';
  code: string;
  quantity: number;
  orderType: 'limit' | 'market';
  price?: number;
}): Promise<unknown> {
  if (isDomestic(args.market)) {
    return callKisApi('domestic_stock', 'order_cash', {
      ord_dv: args.side, // 'buy' | 'sell'
      pdno: args.code,
      ord_qty: String(args.quantity),
      ord_unpr: String(args.orderType === 'limit' ? args.price ?? 0 : 0),
      ord_dvsn: args.orderType === 'limit' ? '00' : '01', // 00=지정가, 01=시장가
      excg_id_dvsn_cd: 'KRX', // 필수: KRX | NXT | SOR
    });
  }
  // 해외: 시장가는 거래소·상품별로 다름. v1은 지정가 위주.
  return callKisApi('overseas_stock', 'order', {
    excd: MARKET_TO_EXCD[args.market as Exclude<Market, 'KRX'>],
    pdno: args.code,
    symb: args.code,
    ord_dv: args.side,
    ord_qty: String(args.quantity),
    ord_unpr: String(args.price ?? 0),
  });
}

// ============================================================
// 체결 조회
// ============================================================
export async function checkFill(market: Market, orderId: string): Promise<unknown> {
  if (isDomestic(market)) {
    return callKisApi('domestic_stock', 'inquire_daily_ccld', {
      odno: orderId,
    });
  }
  return callKisApi('overseas_stock', 'inquire_ccnl', {
    odno: orderId,
  });
}
