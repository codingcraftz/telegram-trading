// KIS 환경 설정 — 모의/실전에 따라 base URL + key + 계좌 분기.

import { envDv } from '../runtime.js';

const REAL_BASE = 'https://openapi.koreainvestment.com:9443';
const DEMO_BASE = 'https://openapivts.koreainvestment.com:29443';

export function getKisBaseUrl(): string {
  return envDv() === 'real' ? REAL_BASE : DEMO_BASE;
}

export function getKisCredentials(): { appKey: string; appSecret: string } {
  const env = envDv();
  if (env === 'real') {
    return {
      appKey: process.env.KIS_APP_KEY ?? '',
      appSecret: process.env.KIS_APP_SECRET ?? '',
    };
  }
  return {
    appKey: process.env.KIS_PAPER_APP_KEY ?? '',
    appSecret: process.env.KIS_PAPER_APP_SECRET ?? '',
  };
}

// 계좌번호 — 종합계좌 8자리 + 계좌상품코드 2자리 (보통 01)
export function getKisAccount(): { cano: string; acntPrdtCd: string } {
  const env = envDv();
  const stock = env === 'real'
    ? process.env.KIS_ACCT_STOCK ?? ''
    : process.env.KIS_PAPER_STOCK ?? '';
  return {
    cano: stock,
    acntPrdtCd: process.env.KIS_PROD_TYPE ?? '01',
  };
}
