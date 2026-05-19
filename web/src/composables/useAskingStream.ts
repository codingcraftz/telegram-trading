// useAskingStream — 호가 SSE + REST 폴링 fallback 통합.
import { ref, watch, onMounted, onUnmounted, type Ref } from 'vue';
import { api, type AskingResponse } from '@/api/client';

export function useAskingStream(
  code: Ref<string>,
  options: { useStream?: boolean; intervalMs?: number } = {},
) {
  const useStream = options.useStream ?? true;
  const intervalMs = options.intervalMs ?? 1500;
  const snapshot = ref<AskingResponse | null>(null);
  const isLive = ref(false);
  let es: EventSource | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function load() {
    if (!code.value) return;
    try { snapshot.value = await api.asking(code.value); } catch {}
  }
  function startPolling() {
    stopPolling();
    if (!code.value || intervalMs <= 0 || document.hidden) return;
    load();
    timer = setInterval(load, intervalMs);
  }
  function stopPolling() {
    if (timer) clearInterval(timer);
    timer = null;
  }
  function openStream() {
    closeStream();
    if (!useStream || !code.value) return;
    try {
      es = new EventSource(`/api/stream/asking?code=${code.value}`);
      es.addEventListener('asking', (ev) => {
        try {
          const snap = JSON.parse((ev as MessageEvent).data) as AskingResponse;
          snapshot.value = snap;
          isLive.value = true;
          stopPolling();
        } catch {}
      });
      es.addEventListener('error', () => {
        isLive.value = false;
        startPolling();
      });
    } catch {
      isLive.value = false;
      startPolling();
    }
  }
  function closeStream() {
    if (es) { try { es.close(); } catch {} es = null; }
    isLive.value = false;
  }
  function onVis() {
    if (document.hidden) { stopPolling(); closeStream(); }
    else { load(); useStream ? openStream() : startPolling(); }
  }
  function start() { load(); useStream ? openStream() : startPolling(); }

  watch(code, () => { snapshot.value = null; closeStream(); start(); });
  onMounted(() => { start(); document.addEventListener('visibilitychange', onVis); });
  onUnmounted(() => {
    stopPolling();
    closeStream();
    document.removeEventListener('visibilitychange', onVis);
  });
  return { snapshot, isLive };
}
