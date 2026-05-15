import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  { path: '/', name: 'home', component: () => import('@/pages/Home.vue') },
  { path: '/balance', name: 'balance', component: () => import('@/pages/Balance.vue') },
  { path: '/orders', name: 'orders', component: () => import('@/pages/Orders.vue') },
  { path: '/quote', name: 'quote', component: () => import('@/pages/Quote.vue') },
  { path: '/chart', name: 'chart', component: () => import('@/pages/Chart.vue') },
  { path: '/trade/buy', name: 'trade-buy', component: () => import('@/pages/TradeBuy.vue') },
  { path: '/trade/sell', name: 'trade-sell', component: () => import('@/pages/TradeSell.vue') },
  { path: '/watchlist', name: 'watchlist', component: () => import('@/pages/Watchlist.vue') },
  { path: '/strategy', name: 'strategy', component: () => import('@/pages/Strategy.vue') },
  { path: '/settings', name: 'settings', component: () => import('@/pages/Settings.vue') },
];

export default createRouter({
  history: createWebHistory(),
  routes,
});
