// KIS 환경 설정 — paper/real 키 + 계좌. envDv() 기본 + 명시 인자 지원.

import { envDv } from '../runtime.js';
import type { KisMode } from './auth.js';

const REAL_BASE = 'https://openapi.koreainvestment.com:9443';
const DEMO_BASE = 'https://openapivts.koreainvestment.com:29443';

export function getKisBaseUrl(mode?: KisMode): string {
  const m = mode ?? envDv();
  return m === 'real' ? REAL_BASE : DEMO_BASE;
}

export function getKisCredentials(mode?: KisMode): { appKey: string; appSecret: string } {
  const m = mode ?? envDv();
  if (m === 'real') {
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

// 실전 키가 채워졌는지 (시장 데이터 호출 가능 여부)
export function hasRealKeys(): boolean {
  return !!(process.env.KIS_APP_KEY && process.env.KIS_APP_SECRET);
}

// 계좌번호 파싱 — paper/real 분리 + "12345678-01" 자동 split.
export function getKisAccount(mode?: KisMode): { cano: string; acntPrdtCd: string } {
  const m = mode ?? envDv();
  const raw = (m === 'real'
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
