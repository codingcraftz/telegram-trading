// KIS access token 관리 — 1일 cache + 자동 refresh + 디스크 영속.
// paper / real 별도 캐싱 + getAccessToken(mode?) 인자.
//
// 디스크 캐시: data/.kis-token-{mode}.json — 봇 재시작·tsx watch reload에도 유지.
// 1분당 1회 발급 제한(EGW00133) 회피.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { envDv } from '../runtime.js';
import { getKisCredentials } from './config.js';

export type KisMode = 'real' | 'demo';

type Token = {
  value: string;
  expiresAt: number;
};

const _cache = new Map<KisMode, Token>();
const _inflight = new Map<KisMode, Promise<string>>();

function tokenFilePath(mode: KisMode): string {
  const base = process.env.TOKEN_CACHE_DIR ?? resolve(process.cwd(), 'data');
  return resolve(base, `.kis-token-${mode}.json`);
}

function loadFromDisk(mode: KisMode): Token | null {
  const path = tokenFilePath(mode);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Token;
    if (parsed.value && parsed.expiresAt > Date.now() + 60_000) return parsed;
  } catch { /* ignore */ }
  return null;
}

function saveToDisk(mode: KisMode, token: Token) {
  const path = tokenFilePath(mode);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(token), { mode: 0o600 });
  } catch (err) {
    console.warn('[kis-auth] 디스크 캐시 저장 실패:', (err as Error).message);
  }
}

const BASE_URL: Record<KisMode, string> = {
  real: 'https://openapi.koreainvestment.com:9443',
  demo: 'https://openapivts.koreainvestment.com:29443',
};

export async function getAccessToken(mode?: KisMode): Promise<string> {
  const m: KisMode = mode ?? envDv();

  // 1) 메모리 캐시
  const cached = _cache.get(m);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.value;
  }

  // 2) 디스크 캐시 — 봇 재시작/reload에도 유지
  const disk = loadFromDisk(m);
  if (disk) {
    _cache.set(m, disk);
    return disk.value;
  }

  // 3) inflight dedupe — 동시 다발 호출 시 한 번만 발급
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
    saveToDisk(m, token);
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
