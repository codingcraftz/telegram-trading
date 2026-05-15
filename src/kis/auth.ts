// KIS access token 관리 — 1일 cache + 자동 refresh.
// paper / real 별도 캐싱 + getAccessToken(mode?) 인자.
//
// 사용 패턴:
//   getAccessToken()         → 현재 envDv() (계좌 종속 호출)
//   getAccessToken('real')   → 실전 키 강제 (시장 데이터 호출 — rate limit 여유)
//   getAccessToken('demo')   → 모의 키 강제

import { envDv } from '../runtime.js';
import { getKisCredentials } from './config.js';

export type KisMode = 'real' | 'demo';

type Token = {
  value: string;
  expiresAt: number;
};

const _cache = new Map<KisMode, Token>();
const _inflight = new Map<KisMode, Promise<string>>();

const BASE_URL: Record<KisMode, string> = {
  real: 'https://openapi.koreainvestment.com:9443',
  demo: 'https://openapivts.koreainvestment.com:29443',
};

export async function getAccessToken(mode?: KisMode): Promise<string> {
  const m: KisMode = mode ?? envDv();

  // 1) 캐시 확인
  const cached = _cache.get(m);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.value;
  }

  // 2) inflight dedupe — 동시 다발 호출 시 한 번만 발급
  const existing = _inflight.get(m);
  if (existing) return existing;

  const promise = (async () => {
    const { appKey, appSecret } = getKisCredentials(m);
    if (!appKey || !appSecret) {
      throw new Error(`KIS ${m} 키 미입력 — 대시보드 [설정]에서 입력`);
    }
    const baseUrl = BASE_URL[m];
    const res = await fetch(`${baseUrl}/oauth2/tokenP`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        appkey: appKey,
        appsecret: appSecret,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`KIS ${m} token 발급 실패 (${res.status}): ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
      token_type: string;
    };
    const token: Token = {
      value: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    _cache.set(m, token);
    return token.value;
  })();

  _inflight.set(m, promise);
  try {
    return await promise;
  } finally {
    _inflight.delete(m);
  }
}

export function getKisBaseUrlFor(mode: KisMode): string {
  return BASE_URL[mode];
}

export function clearTokenCache(): void {
  _cache.clear();
}
