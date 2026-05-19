// 관심 종목 + 시세 batch 폴링 글로벌 스토어. orders 스토어와 동일 패턴.
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { api, type WatchlistItem, type QuotesItem } from '@/api/client';
import { useMarketSession } from '@/composables/useMarketSession';
import { toast } from '@/lib/toast';

const POLL_MS = 30_000;

export const useWatchlistStore = defineStore('watchlist', () => {
  const items = ref<WatchlistItem[]>([]);
  const quotes = ref<Map<string, QuotesItem>>(new Map());
  const loading = ref(false);
  const loaded = ref(false);
  let timer: ReturnType<typeof setInterval> | null = null;
  let visBound = false;
  let subscribers = 0;

  const codeSet = computed(() => new Set(items.value.map((it) => it.code)));
  const count = computed(() => items.value.length);
  function has(code: string) { return codeSet.value.has(code); }

  async function fetchList() {
    loading.value = true;
    try {
      const r = await api.watchlist();
      items.value = r.items;
      loaded.value = true;
    } catch {} finally { loading.value = false; }
  }
  async function fetchQuotes() {
    if (items.value.length === 0) { quotes.value = new Map(); return; }
    try {
      const r = await api.quotes(items.value.map((it) => it.code));
      const m = new Map<string, QuotesItem>();
      for (const q of r.items) m.set(q.code, q);
      quotes.value = m;
    } catch {}
  }
  async function refresh() { await fetchList(); await fetchQuotes(); }

  async function add(code: string) {
    try {
      const r = await api.watchlistAdd(code);
      if (r.existed) toast.info('이미 관심에 담겨 있어요');
      else toast.success(`${r.name} 담았어요`);
      await refresh();
      return { ok: true, existed: r.existed };
    } catch (err) {
      toast.error((err as Error).message);
      return { ok: false };
    }
  }
  async function removeByCode(code: string) {
    const it = items.value.find((x) => x.code === code);
    if (!it) return false;
    const snapshot = items.value;
    items.value = items.value.filter((x) => x.code !== code);
    try {
      await api.watchlistRemove(it.id);
      toast.info('관심에서 뺐어요');
      const m = new Map(quotes.value);
      m.delete(code);
      quotes.value = m;
      return true;
    } catch (err) {
      items.value = snapshot;
      toast.error((err as Error).message);
      return false;
    }
  }
  async function removeByIds(ids: number[]) {
    if (ids.length === 0) return 0;
    const snap = items.value;
    items.value = items.value.filter((x) => !ids.includes(x.id));
    try {
      await Promise.all(ids.map((id) => api.watchlistRemove(id)));
      toast.success(`${ids.length}개 종목을 관심에서 뺐어요`);
      return ids.length;
    } catch (err) {
      items.value = snap;
      toast.error((err as Error).message);
      return 0;
    }
  }

  const { session } = useMarketSession();
  function startPolling() {
    stopPolling();
    if (document.hidden) return;
    if (session.value !== 'open') return;
    if (items.value.length === 0) return;
    timer = setInterval(fetchQuotes, POLL_MS);
  }
  function stopPolling() { if (timer) clearInterval(timer); timer = null; }
  function onVis() { document.hidden ? stopPolling() : (fetchQuotes(), startPolling()); }

  watch([session, items], () => startPolling());

  async function subscribe() {
    subscribers += 1;
    if (subscribers === 1) {
      if (!loaded.value) await refresh();
      else fetchQuotes();
      if (!visBound) { document.addEventListener('visibilitychange', onVis); visBound = true; }
      startPolling();
    } else fetchQuotes();
  }
  function unsubscribe() {
    subscribers = Math.max(0, subscribers - 1);
    if (subscribers === 0) {
      stopPolling();
      if (visBound) { document.removeEventListener('visibilitychange', onVis); visBound = false; }
    }
  }

  return { items, quotes, count, loading, loaded, has, refresh, add, removeByCode, removeByIds, subscribe, unsubscribe };
});
