import { listOpenPositions } from '../db/repo.js';
import { getQuote, type Market } from '../mcp/kis.js';
import { maybeFire } from './trigger.js';

// 30초 간격으로 오픈 포지션의 현재가 폴링.
// 시장(국내/해외)에 따라 다른 KIS API 호출. v2에서 WS로 업그레이드.
//
// TODO (사용자 결정 보류): 사용자가 봇 외부(HTS 등)에서 손 매도한 경우 처리.
// 현재 동작 — position 은 'open' 으로 남고 monitor 가 TP/SL 도달 시 매도 발주 시도 → KIS
// 가 잔량부족으로 거부. 안전하지만 유령 position 으로 화면에 잔존 + 물타기는 추가 매수 위험.
// 후보안: (1) tick 시작 시 KIS balance fetch → holdings 와 cross-check, KIS 에 없으면
// position 'closed' 자동 처리. (2) staged_runner 도 동일 cross-check. (3) UI 에서 수동
// '봇 추적 종료' 버튼.

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
