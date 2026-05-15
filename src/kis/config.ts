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

// 계좌번호 파싱 — 사용자 입력은 "12345678" 8자리 또는 "12345678-01" 전체 둘 다 허용.
// '-' 있으면 split, 없으면 KIS_PROD_TYPE 환경변수 또는 '01' fallback.
//   "12345678"       → { cano: '12345678', acntPrdtCd: '01' }
//   "12345678-01"    → { cano: '12345678', acntPrdtCd: '01' }
//   "12345678-22"    → { cano: '12345678', acntPrdtCd: '22' }  // 선물옵션 등
export function getKisAccount(): { cano: string; acntPrdtCd: string } {
  const env = envDv();
  const raw = (env === 'real'
    ? process.env.KIS_ACCT_STOCK ?? ''
    : process.env.KIS_PAPER_STOCK ?? '').trim();
  if (raw.includes('-')) {
    const [cano, prdt] = raw.split('-');
    return {
      cano: (cano ?? '').trim(),
      acntPrdtCd: (prdt ?? '').trim() || process.env.KIS_PROD_TYPE || '01',
    };
  }
  return {
    cano: raw,
    acntPrdtCd: process.env.KIS_PROD_TYPE ?? '01',
  };
}
