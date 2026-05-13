import { listOpenPositions } from '../db/repo.js';
import { getQuote, type Market } from '../mcp/kis.js';
import { maybeFire } from './trigger.js';

// 30초 간격으로 오픈 포지션의 현재가 폴링.
// 시장(국내/해외)에 따라 다른 KIS API 호출. v2에서 WS로 업그레이드.

const INTERVAL_MS = 30_000;
let _running = false;
let _timer: NodeJS.Timeout | null = null;

function extractNumber(obj: unknown, ...keys: string[]): number | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v);
  }
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v && typeof v === 'object') {
      const r = extractNumber(v, ...keys);
      if (r !== null) return r;
    }
  }
  return null;
}

async function tick() {
  const positions = listOpenPositions();
  if (positions.length === 0) return;

  // (market, code) 단위로 모아서 한 번씩만 조회
  type Key = string;
  const byKey = new Map<Key, typeof positions>();
  for (const p of positions) {
    const k: Key = `${p.market || 'KRX'}|${p.symbolCode}`;
    const arr = byKey.get(k) ?? [];
    arr.push(p);
    byKey.set(k, arr);
  }

  for (const [key, posList] of byKey.entries()) {
    const [marketStr, code] = key.split('|') as [string, string];
    const market = (marketStr || 'KRX') as Market;
    try {
      const res = await getQuote(market, code);
      // 국내: stck_prpr / 해외: last
      const price = extractNumber(
        res,
        'stck_prpr',
        'last',
        'current_price',
        'price',
        'ovrs_nmix_prpr',
      );
      if (price === null || price <= 0) {
        console.warn('[monitor] no price for', key);
        continue;
      }
      for (const p of posList) {
        await maybeFire(p, price);
      }
    } catch (err) {
      console.warn('[monitor] tick error for', key, (err as Error).message);
    }
  }
}

export function startMonitor() {
  if (_running) return;
  _running = true;
  console.log('[monitor] starting polling every', INTERVAL_MS / 1000, 's');
  _timer = setInterval(() => {
    tick().catch((err) => console.error('[monitor] tick failed', err));
  }, INTERVAL_MS);
}

export function stopMonitor() {
  _running = false;
  if (_timer) clearInterval(_timer);
  _timer = null;
}
