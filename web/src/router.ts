import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('@/pages/Home.vue') },
  { path: '/stocks', name: 'stocks', component: () => import('@/pages/Stocks.vue') },
  { path: '/stocks/:code', name: 'stock-detail', component: () => import('@/pages/StockDetail.vue') },
  { path: '/orders', name: 'orders', component: () => import('@/pages/Orders.vue') },
  { path: '/buy', name: 'buy', component: () => import('@/pages/TradeBuy.vue') },
  { path: '/sell', name: 'sell', component: () => import('@/pages/TradeSell.vue') },
  { path: '/settings', name: 'settings', component: () => import('@/pages/Settings.vue') },

  // 구 경로 호환 리다이렉트
  { path: '/balance', redirect: '/' },
  { path: '/watchlist', redirect: '/stocks' },
  { path: '/quote', redirect: (to) => `/stocks/${(to.query.code as string) ?? ''}` },
  { path: '/chart', redirect: (to) => `/stocks/${(to.query.code as string) ?? ''}` },
  { path: '/strategy', redirect: '/settings' },
  { path: '/trade/buy', redirect: (to) => ({ path: '/buy', query: to.query }) },
  { path: '/trade/sell', redirect: (to) => ({ path: '/sell', query: to.query }) },
];

export default createRouter({
  history: createWebHistory(),
  routes,
});
