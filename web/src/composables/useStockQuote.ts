// useStockQuote — /api/quote + SSE tick 통합.
// SSE live면 30s 폴링, 죽으면 2.5s.
import { ref, watch, computed, onMounted, onUnmounted, type Ref } from 'vue';
import { api, type QuoteResponse, type TickSnapshot } from '@/api/client';
import { useTickStream } from './useTickStream';

export function useStockQuote(code: Ref<string>) {
  const quote = ref<QuoteResponse | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function load() {
    if (!code.value) return;
    loading.value = true;
    error.value = null;
    try { quote.value = await api.quote(code.value); }
    catch (err) { error.value = (err as Error).message; }
    finally { loading.value = false; }
  }

  function applyTick(snap: TickSnapshot) {
    if (snap.code !== code.value) return;
    if (!quote.value) return;
    quote.value = {
      ...quote.value,
      price: snap.price,
      change: snap.change,
      changeRate: snap.changePct,
    };
  }

  const { isLive } = useTickStream(code, applyTick);

  function startPolling() {
    stopPolling();
    if (document.hidden) return;
    const ms = isLive.value ? 30_000 : 2_500;
    pollTimer = setInterval(load, ms);
  }
  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }
  function onVis() { document.hidden ? stopPolling() : (load(), startPolling()); }

  watch(isLive, () => startPolling());
  watch(code, () => { quote.value = null; load(); startPolling(); });

  onMounted(() => { load(); startPolling(); document.addEventListener('visibilitychange', onVis); });
  onUnmounted(() => { stopPolling(); document.removeEventListener('visibilitychange', onVis); });

  return {
    quote,
    price: computed(() => quote.value?.price ?? 0),
    changeRate: computed(() => quote.value?.changeRate ?? 0),
    isLive,
    loading,
    error,
    refresh: load,
  };
}
