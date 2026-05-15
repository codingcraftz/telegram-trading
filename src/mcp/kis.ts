// 이전엔 KIS Trading MCP (Python)을 통해 호출.
// 이제 src/kis/client.ts가 KIS REST를 직접 호출. 호출 측 시그니처 그대로 유지.
//
// cano/acnt_prdt_cd는 src/kis/client.ts가 자동 주입.

import { callKisApi as kisCallKisApi } from '../kis/client.js';
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
  return kisCallKisApi(category, apiType, applyDefaults(category, apiType, params));
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
// orderType → KIS ord_dvsn 매핑
//   limit         → 00 (지정가)
//   market        → 01 (시장가)
//   pre_extended  → 05 (장전 시간외 종가, 08:30~08:40)
//   post_extended → 06 (장후 시간외 종가, 15:40~16:00)
//   after_single  → 07 (시간외 단일가, 16:00~18:00)
export type OrderType = 'limit' | 'market' | 'pre_extended' | 'post_extended' | 'after_single';

const ORDER_TYPE_TO_DVSN: Record<OrderType, string> = {
  limit: '00',
  market: '01',
  pre_extended: '05',
  post_extended: '06',
  after_single: '07',
};

export async function placeOrder(args: {
  market: Market;
  side: 'buy' | 'sell';
  code: string;
  quantity: number;
  orderType: OrderType;
  price?: number;
}): Promise<unknown> {
  if (isDomestic(args.market)) {
    const ordDvsn = ORDER_TYPE_TO_DVSN[args.orderType];
    // ord_unpr 전송 규칙:
    //   market(01)        → 0
    //   limit(00)         → price
    //   pre_extended(05)  → 0 (전일 종가 자동)
    //   post_extended(06) → 0 (당일 종가 자동)
    //   after_single(07)  → price 필수 (10분 단위 단일가)
    const ordUnpr =
      args.orderType === 'limit' || args.orderType === 'after_single' ? args.price ?? 0 : 0;
    // excg_id_dvsn_cd 제거 — KIS demo가 IGW00017("상품번호를 확인해주세요")로 거부함.
    // 실측: 이 필드가 들어가면 매수/매도 모두 거부. 빼면 통과 (전통적 KRX 단일 주문).
    return callKisApi('domestic_stock', 'order_cash', {
      ord_dv: args.side,
      pdno: args.code,
      ord_qty: String(args.quantity),
      ord_unpr: String(ordUnpr),
      ord_dvsn: ordDvsn,
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
// 미체결 취소 (국내만). inquire_daily_ccld의 row에서 ord_gno_brno/odno/ord_qty/ord_dvsn 그대로 사용.
// rvse_cncl_dvsn_cd: '01'=정정, '02'=취소. qty_all_ord_yn='Y'면 잔량 전부 취소.
// ============================================================
export async function cancelKrxOrder(args: {
  orgno: string;
  odno: string;
  qty?: number;
  ordDvsn?: string;
}): Promise<unknown> {
  // excg_id_dvsn_cd 제거 (order_cash와 동일 이유 — IGW00017 거부)
  return callKisApi('domestic_stock', 'order_rvsecncl', {
    krx_fwdg_ord_orgno: args.orgno,
    orgn_odno: args.odno,
    ord_dvsn: args.ordDvsn ?? '00',
    rvse_cncl_dvsn_cd: '02',
    ord_qty: String(args.qty ?? 0),
    ord_unpr: '0',
    qty_all_ord_yn: 'Y',
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
