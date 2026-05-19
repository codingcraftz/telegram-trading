// useIndices — /api/indices 폴링. 장중 10s, 그 외 정지.
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { api, type IndexItem } from '@/api/client';
import { useMarketSession } from './useMarketSession';

const POLL_MS = 10_000;

export function useIndices() {
  const items = ref<IndexItem[]>([]);
  const loading = ref(false);
  const { session } = useMarketSession();
  let timer: ReturnType<typeof setInterval> | null = null;

  async function load() {
    loading.value = true;
    try { items.value = (await api.indices()).items; }
    catch {} finally { loading.value = false; }
  }
  function start() {
    stop();
    if (document.hidden) return;
    if (session.value !== 'open') return;
    timer = setInterval(load, POLL_MS);
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  function onVis() { document.hidden ? stop() : (load(), start()); }

  watch(session, () => start());
  onMounted(() => { load(); start(); document.addEventListener('visibilitychange', onVis); });
  onUnmounted(() => { stop(); document.removeEventListener('visibilitychange', onVis); });

  return { items, loading, refresh: load };
}
