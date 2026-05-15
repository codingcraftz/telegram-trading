// KIS API 응답 단기 캐싱.
//
// 사용 패턴:
//   const r = await cached('holdings:chat123', 20_000, () => fetchHoldings());
//
// 캐시 적용 대상 (메뉴 흐름에서 짧은 시간 안에 여러 번 호출되는 함수):
//   - fetchHoldings (매도 흐름에서 3번 호출되던 것을 1번으로)
//   - fetchCurrentPrice (차트/시세조회/즉시매수 사이 공유)
//   - fetchOrderableCash (매수가능금액)
//
// 변동성 큰 데이터는 짧게 (10초), 잔고처럼 자주 안 바뀌는 건 길게 (30초).
// 주문 발주 직후엔 invalidate() 호출해서 stale 안 되도록.

type CacheEntry<T> = { value: T; expiresAt: number };

const _cache = new Map<string, CacheEntry<unknown>>();

export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = _cache.get(key) as CacheEntry<T> | undefined;
  if (hit && hit.expiresAt > now) return hit.value;
  const v = await fn();
  _cache.set(key, { value: v, expiresAt: now + ttlMs });
  return v;
}

// 캐시 일괄/접두사 무효화. 주문 발주 직후 호출 권장.
export function invalidate(prefix?: string): void {
  if (!prefix) {
    _cache.clear();
    return;
  }
  for (const k of _cache.keys()) {
    if (k.startsWith(prefix)) _cache.delete(k);
  }
}
