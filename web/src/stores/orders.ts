import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api, type OrdersResponse } from '@/api/client';

export const useOrdersStore = defineStore('orders', () => {
  const data = ref<OrdersResponse | null>(null);
  const count = ref(0);
  const loading = ref(false);
  let timer: ReturnType<typeof setInterval> | null = null;
  let subscribers = 0;

  async function refresh() {
    loading.value = true;
    try {
      const o = await api.orders();
      data.value = o;
      count.value =
        o.intents.length +
        o.reservations.length +
        (o.kis.ok ? o.kis.items.length : 0);
    } catch {
      /* silent */
    } finally {
      loading.value = false;
    }
  }

  let currentInterval = Number.POSITIVE_INFINITY;
  function subscribe(intervalMs = 4000) {
    subscribers += 1;
    // 페이지 진입 시 항상 즉시 한 번 새로고침 (BottomNav가 먼저 구독 중이라도)
    refresh();
    // 더 짧은 폴링 간격을 원하는 구독자가 들어오면 타이머 재설정
    if (!timer || intervalMs < currentInterval) {
      if (timer) clearInterval(timer);
      currentInterval = intervalMs;
      timer = setInterval(() => {
        if (!document.hidden) refresh();
      }, intervalMs);
    }
  }
  function unsubscribe() {
    subscribers = Math.max(0, subscribers - 1);
    if (subscribers === 0 && timer) {
      clearInterval(timer);
      timer = null;
      currentInterval = Number.POSITIVE_INFINITY;
    }
  }

  return { data, count, loading, refresh, subscribe, unsubscribe };
});
