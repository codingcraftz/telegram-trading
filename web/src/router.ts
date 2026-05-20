import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { api } from '@/api/client';

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('@/pages/Home.vue') },
  { path: '/stocks', name: 'stocks', component: () => import('@/pages/Stocks.vue') },
  { path: '/stocks/:code', name: 'stock-detail', component: () => import('@/pages/StockDetail.vue') },
  { path: '/orders', name: 'orders', component: () => import('@/pages/Orders.vue') },
  { path: '/settings', name: 'settings', component: () => import('@/pages/Settings.vue') },
  { path: '/onboarding', name: 'onboarding', component: () => import('@/pages/Onboarding.vue') },

  // 전략 시스템 (스텝 6)
  {
    path: '/more/strategy',
    name: 'strategy-list',
    component: () => import('@/pages/strategy/StrategyList.vue'),
  },
  {
    path: '/more/strategy/new',
    name: 'strategy-new',
    component: () => import('@/pages/strategy/StrategyEditor.vue'),
  },
  {
    path: '/more/strategy/templates',
    name: 'strategy-templates',
    component: () => import('@/pages/strategy/StrategyTemplates.vue'),
  },
  {
    path: '/more/strategy/:id',
    name: 'strategy-edit',
    component: () => import('@/pages/strategy/StrategyEditor.vue'),
  },

  // 사기/팔기는 종목 상세의 탭으로 통합
  { path: '/buy', redirect: (to) => ({ path: `/stocks/${(to.query.code as string) ?? ''}`, query: { tab: 'buy' } }) },
  { path: '/sell', redirect: (to) => ({ path: `/stocks/${(to.query.code as string) ?? ''}`, query: { tab: 'sell' } }) },

  // 구 경로 호환
  { path: '/balance', redirect: '/' },
  { path: '/watchlist', redirect: '/stocks' },
  { path: '/quote', redirect: (to) => `/stocks/${(to.query.code as string) ?? ''}` },
  { path: '/chart', redirect: (to) => `/stocks/${(to.query.code as string) ?? ''}` },
  { path: '/strategy', redirect: '/more/strategy' },
  { path: '/trade/buy', redirect: (to) => ({ path: `/stocks/${(to.query.code as string) ?? ''}`, query: { tab: 'buy' } }) },
  { path: '/trade/sell', redirect: (to) => ({ path: `/stocks/${(to.query.code as string) ?? ''}`, query: { tab: 'sell' } }) },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// 첫 진입 가드 — KIS 키가 전혀 없으면 /onboarding 으로.
// keys-status 결과는 sessionStorage 에 캐시 (탭 단위, 매 nav 호출 방지).
// 캐시 무효화는 Onboarding.vue 의 pollRestart 가 처리.
const KEYS_CACHE_KEY = 'owlim:keys-cached';
type KeysCache = { hasAnyKeys: boolean; checkedAt: number };

async function getKeysStatusCached(): Promise<KeysCache> {
  try {
    const raw = sessionStorage.getItem(KEYS_CACHE_KEY);
    if (raw) return JSON.parse(raw) as KeysCache;
  } catch {
    // ignore
  }
  try {
    const data = await api.keysStatus();
    const cache: KeysCache = {
      hasAnyKeys: data.paperKeys || data.realKeys || data.realMarketKeys,
      checkedAt: Date.now(),
    };
    try { sessionStorage.setItem(KEYS_CACHE_KEY, JSON.stringify(cache)); } catch {}
    return cache;
  } catch {
    // API 자체 실패 → 일단 통과 (onboarding 무한 루프 방지)
    return { hasAnyKeys: true, checkedAt: Date.now() };
  }
}

router.beforeEach(async (to) => {
  // onboarding 페이지 자체는 항상 통과 (무한 루프 방지)
  if (to.path === '/onboarding') return true;
  const cache = await getKeysStatusCached();
  if (!cache.hasAnyKeys) return { path: '/onboarding' };
  return true;
});

export default router;
