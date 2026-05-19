// 잔고/예수금/시세 사전 워밍.
// KIS 응답이 본래 200~800ms로 느려서, 사용자 호출 시점에 캐시 hit으로 0ms 응답하도록.
// 부팅 시 1회 + 주기 갱신. 토큰 발급 비용도 사전 처리.

import { callKisApi } from '../mcp/kis.js';
import { fetchPendingOrders } from './pending.js';
import { cached, invalidate } from './cache.js';
import { fetchIndicesItems } from '../api/indices.js';

const WARMUP_INTERVAL_MS = 30_000; // 30s
let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

async function warmBalance(): Promise<void> {
  try {
    invalidate('balance:raw');
    await cached('balance:raw', 60_000, () =>
      callKisApi('domestic_stock', 'inquire_balance', {}),
    );
  } catch (err) {
    console.warn('[warmup] balance fail:', (err as Error).message);
  }
}

async function warmPending(): Promise<void> {
  try {
    invalidate('pending:raw');
    await fetchPendingOrders();
  } catch (err) {
    console.warn('[warmup] pending fail:', (err as Error).message);
  }
}

function ymdKst(d: Date): string {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCFullYear()}${String(k.getUTCMonth() + 1).padStart(2, '0')}${String(k.getUTCDate()).padStart(2, '0')}`;
}

async function warmFilled(): Promise<void> {
  // 7일치 체결만 워밍 (가장 자주 조회). 30/90은 사용자 명시 클릭이라 그때만 fetch.
  try {
    invalidate('filled:days:7');
    const end = new Date();
    const start = new Date(end.getTime() - 6 * 24 * 3600 * 1000);
    await cached('filled:days:7', 60_000, () =>
      callKisApi('domestic_stock', 'inquire_daily_ccld', {
        pd_dv: 'inner',
        inqr_strt_dt: ymdKst(start),
        inqr_end_dt: ymdKst(end),
        sll_buy_dvsn_cd: '00',
        ccld_dvsn: '01',
        inqr_dvsn: '00',
        inqr_dvsn_3: '00',
      }),
    );
  } catch (err) {
    console.warn('[warmup] filled fail:', (err as Error).message);
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function warmIndices(): Promise<void> {
  // Yahoo Finance는 KIS 와 별도 호스트라 rate limit 영향 없음. invalidate 후 30s 캐시 재채움.
  try {
    invalidate('indices:all');
    await fetchIndicesItems();
  } catch (err) {
    console.warn('[warmup] indices fail:', (err as Error).message);
  }
}

// 순차 + 사이 200ms — KIS 초당 한도(rate limit) 회피.
// Promise.all 병렬은 부팅 직후 토큰 발급과 겹쳐 EGW 에러 유발.
async function warmAll(): Promise<void> {
  await warmBalance();
  await sleep(250);
  await warmPending();
  await sleep(250);
  await warmFilled();
  // indices 는 KIS 아니라 sleep 없이 OK
  await warmIndices();
}

export function startWarmup(): void {
  if (_running) return;
  _running = true;
  warmAll().catch(() => {});
  _timer = setInterval(() => {
    warmAll().catch(() => {});
  }, WARMUP_INTERVAL_MS);
  console.log('[warmup] started — balance + pending + filled(7d) + indices every 30s');
}

export function stopWarmup(): void {
  if (_timer) clearInterval(_timer);
  _timer = null;
  _running = false;
}
