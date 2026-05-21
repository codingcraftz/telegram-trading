// KIS Open API REST 직접 호출.
// 이전엔 KIS MCP (Python wrapper)를 통해 호출 → 이제 직접.
//
// callKisApi(category, apiType, params) 시그니처는 기존과 동일하게 유지 →
// 호출 측 (fastpath/*, scheduler/*) 코드 변경 0.
//
// 응답은 KIS 직접 응답을 MCP-스타일로 wrap → parseMcpResult가 그대로 동작.

import { envDv } from '../runtime.js';
import { getAccessToken, getKisBaseUrlFor, invalidateToken, type KisMode } from './auth.js';
import { getKisAccount, getKisCredentials } from './config.js';

// 시장 데이터 API — 계좌 무관, read-only. 항상 실전 키 사용 (분당 1080건).
// 모의 키 fallback 금지 — 사용자 결정: 시세는 실전 only, 매매만 모의.
// 실전 키 없으면 getAccessToken이 throw → 호출 측 명시 에러.
const MARKET_DATA_APIS = new Set([
  'inquire_price',
  'inquire_asking_price_exp_ccn',
  'inquire_time_itemchartprice',
  'volume_rank',
  'fluctuation',
  'market_cap',
  'chk_holiday',
]);

function pickModeFor(apiType: string): KisMode {
  if (MARKET_DATA_APIS.has(apiType)) return 'real';
  return envDv();
}

// API 메타 — endpoint path + tr_id + HTTP method.
// 각 endpoint마다 모의/실전 tr_id 다를 수 있음.
type ApiMeta = {
  path: string;
  method: 'GET' | 'POST';
  trId: { real: string; demo: string };
  // 호출 시 자동으로 cano/acnt_prdt_cd 채울지
  needsAccount?: boolean;
  // 매수/매도(buy/sell)별 tr_id 다름 — order_cash 전용
  orderTrId?: {
    real: { buy: string; sell: string };
    demo: { buy: string; sell: string };
  };
};

const API: Record<string, ApiMeta> = {
  inquire_price: {
    path: '/uapi/domestic-stock/v1/quotations/inquire-price',
    method: 'GET',
    trId: { real: 'FHKST01010100', demo: 'FHKST01010100' },
  },
  inquire_balance: {
    path: '/uapi/domestic-stock/v1/trading/inquire-balance',
    method: 'GET',
    trId: { real: 'TTTC8434R', demo: 'VTTC8434R' },
    needsAccount: true,
  },
  inquire_psbl_order: {
    path: '/uapi/domestic-stock/v1/trading/inquire-psbl-order',
    method: 'GET',
    trId: { real: 'TTTC8908R', demo: 'VTTC8908R' },
    needsAccount: true,
  },
  inquire_daily_ccld: {
    path: '/uapi/domestic-stock/v1/trading/inquire-daily-ccld',
    method: 'GET',
    trId: { real: 'TTTC0081R', demo: 'VTTC0081R' },
    needsAccount: true,
  },
  inquire_time_itemchartprice: {
    path: '/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice',
    method: 'GET',
    trId: { real: 'FHKST03010200', demo: 'FHKST03010200' },
  },
  inquire_asking_price_exp_ccn: {
    path: '/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn',
    method: 'GET',
    trId: { real: 'FHKST01010200', demo: 'FHKST01010200' },
  },
  order_cash: {
    path: '/uapi/domestic-stock/v1/trading/order-cash',
    method: 'POST',
    trId: { real: 'TTTC0802U', demo: 'VTTC0802U' }, // default = buy
    needsAccount: true,
    orderTrId: {
      real: { buy: 'TTTC0802U', sell: 'TTTC0801U' },
      demo: { buy: 'VTTC0802U', sell: 'VTTC0801U' },
    },
  },
  // 미체결 정정/취소
  order_rvsecncl: {
    path: '/uapi/domestic-stock/v1/trading/order-rvsecncl',
    method: 'POST',
    trId: { real: 'TTTC0803U', demo: 'VTTC0803U' },
    needsAccount: true,
  },
  // 영업일/휴장일 조회 (KRX). 실전·모의 tr_id 동일.
  // 응답 output: { bass_dt, wday_dvsn_cd, bzdy_yn, tr_day_yn, opnd_yn, sttl_day_yn }
  //   opnd_yn = 'Y' 면 개장 (정상 거래일)
  chk_holiday: {
    path: '/uapi/domestic-stock/v1/quotations/chk-holiday',
    method: 'GET',
    trId: { real: 'CTCA0903R', demo: 'CTCA0903R' },
  },
  // 랭킹
  volume_rank: {
    path: '/uapi/domestic-stock/v1/quotations/volume-rank',
    method: 'GET',
    trId: { real: 'FHPST01710000', demo: 'FHPST01710000' },
  },
  fluctuation: {
    path: '/uapi/domestic-stock/v1/ranking/fluctuation',
    method: 'GET',
    trId: { real: 'FHPST01700000', demo: 'FHPST01700000' },
  },
  market_cap: {
    path: '/uapi/domestic-stock/v1/ranking/market-cap',
    method: 'GET',
    trId: { real: 'FHPST01740000', demo: 'FHPST01740000' },
  },
};

function buildHeaders(trId: string, accessToken: string, mode: KisMode): Record<string, string> {
  const { appKey, appSecret } = getKisCredentials(mode);
  return {
    'content-type': 'application/json; charset=utf-8',
    Authorization: `Bearer ${accessToken}`,
    appkey: appKey,
    appsecret: appSecret,
    tr_id: trId,
    custtype: 'P',
  };
}

function injectAccount(
  params: Record<string, unknown>,
  mode: KisMode,
): Record<string, unknown> {
  const { cano, acntPrdtCd } = getKisAccount(mode);
  return {
    cano,
    acnt_prdt_cd: acntPrdtCd,
    ...params, // 사용자 지정이 우선
  };
}

// MCP 응답 형식으로 wrap → parseMcpResult가 그대로 동작.
// data 필드에 KIS 응답 본문을 JSON 문자열 또는 객체로 넣음.
function wrapAsMcp(kisResponse: unknown): unknown {
  return {
    structuredContent: {
      ok: true,
      data: kisResponse,
    },
  };
}

export async function callKisApi(
  category: string,
  apiType: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  // 해외주식은 v1에서 미지원 — 빈 응답
  if (category === 'overseas_stock') {
    return wrapAsMcp({ rt_cd: '1', msg1: '해외주식 미지원 (v1)' });
  }
  if (category !== 'domestic_stock') {
    return wrapAsMcp({ rt_cd: '1', msg1: `미지원 카테고리: ${category}` });
  }

  const meta = API[apiType];
  if (!meta) {
    return wrapAsMcp({ rt_cd: '1', msg1: `미지원 API: ${apiType}` });
  }

  // 시장 데이터는 실전 키로 (실전 키 있을 때) — 분당 호출 제한이 모의 60 → 실전 1080.
  // 매매/잔고/주문 조회 등 계좌 종속 호출은 현재 MODE 그대로.
  const mode = pickModeFor(apiType);

  // tr_id는 mode 기준
  let trId = meta.trId[mode];
  if (apiType === 'order_cash' && meta.orderTrId) {
    const side = (params.ord_dv as string) ?? (params.SLL_BUY_DVSN_CD as string);
    if (side === 'buy' || side === 'sell') {
      trId = meta.orderTrId[mode][side];
    }
  }

  const finalParams = meta.needsAccount ? injectAccount(params, mode) : params;
  const url = `${getKisBaseUrlFor(mode)}${meta.path}`;

  // KIS 토큰 만료 응답 받으면 cache 비우고 새 토큰으로 1회 재시도.
  // KIS demo 토큰은 명목상 24h 인데 외부 요인 (같은 키로 다른 인스턴스 발급,
  // 서버 측 invalidate 등) 으로 일찍 만료될 수 있음.
  const doRequest = async (token: string): Promise<{ res: Response; body: unknown }> => {
    const headers = buildHeaders(trId, token, mode);
    let r: Response;
    if (meta.method === 'GET') {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(finalParams)) {
        if (v === undefined || v === null) continue;
        qs.set(k, String(v));
      }
      const fullUrl = qs.toString() ? `${url}?${qs.toString()}` : url;
      r = await fetch(fullUrl, { method: 'GET', headers });
    } else {
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(finalParams)) {
        const lower = k.toLowerCase();
        if (lower === 'ord_dv' || lower === 'env_dv') continue;
        if (v === undefined || v === null) continue;
        cleaned[k.toUpperCase()] = v;
      }
      r = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(cleaned),
      });
    }
    let body: unknown;
    try { body = await r.json(); } catch { body = { rt_cd: '1', msg1: `응답 파싱 실패 (${r.status})` }; }
    return { res: r, body };
  };

  const isTokenExpired = (body: unknown): boolean => {
    if (!body || typeof body !== 'object') return false;
    const b = body as Record<string, unknown>;
    const msg = String(b.msg1 ?? b.message ?? '');
    const code = String(b.msg_cd ?? '');
    return (
      /기간이 만료된 token|만료된 token|token.*expired|EGW00121|EGW00123/i.test(msg) ||
      code === 'EGW00121' || code === 'EGW00123'
    );
  };

  let accessToken = await getAccessToken(mode);
  let { res, body: kisResponse } = await doRequest(accessToken);

  if (isTokenExpired(kisResponse)) {
    console.warn('[kis] token 만료 감지 — invalidate + 재발급 + 재시도');
    invalidateToken(mode);
    accessToken = await getAccessToken(mode);
    ({ res, body: kisResponse } = await doRequest(accessToken));
  }

  if (!res.ok) {
    return wrapAsMcp({
      rt_cd: '1',
      msg_cd: String(res.status),
      msg1: `HTTP ${res.status}`,
      ...((kisResponse as object) ?? {}),
    });
  }

  return wrapAsMcp(kisResponse);
}
