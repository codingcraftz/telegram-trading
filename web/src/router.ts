import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('@/pages/Home.vue') },
  { path: '/stocks', name: 'stocks', component: () => import('@/pages/Stocks.vue') },
  { path: '/stocks/:code', name: 'stock-detail', component: () => import('@/pages/StockDetail.vue') },
  { path: '/orders', name: 'orders', component: () => import('@/pages/Orders.vue') },
  { path: '/settings', name: 'settings', component: () => import('@/pages/Settings.vue') },

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

export default createRouter({
  history: createWebHistory(),
  routes,
});
