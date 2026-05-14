// KIS access token 관리 — 1일 cache + 자동 refresh.
// 모의/실전 별도 관리.

import { envDv } from '../runtime.js';
import { getKisCredentials, getKisBaseUrl } from './config.js';

type Token = {
  value: string;
  expiresAt: number;
};

const _cache = new Map<'real' | 'demo', Token>();

export async function getAccessToken(): Promise<string> {
  const env = envDv();
  const cached = _cache.get(env);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.value;
  }
  const { appKey, appSecret } = getKisCredentials();
  const baseUrl = getKisBaseUrl();
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
    throw new Error(`KIS token 발급 실패 (${res.status}): ${text.slice(0, 200)}`);
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
  _cache.set(env, token);
  return token.value;
}

export function clearTokenCache(): void {
  _cache.clear();
}
