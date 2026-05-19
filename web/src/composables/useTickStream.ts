// useTickStream — KIS 체결가 SSE.
// code 변경 시 재연결, visibility hidden 시 close.
import { ref, watch, onMounted, onUnmounted, type Ref } from 'vue';
import type { TickSnapshot } from '@/api/client';

export function useTickStream(code: Ref<string>, onTick: (snap: TickSnapshot) => void) {
  const isLive = ref(false);
  let es: EventSource | null = null;

  function open() {
    close();
    if (!code.value) return;
    try {
      es = new EventSource(`/api/stream/tick?code=${code.value}`);
      es.addEventListener('tick', (ev) => {
        try {
          const snap = JSON.parse((ev as MessageEvent).data) as TickSnapshot;
          onTick(snap);
          isLive.value = true;
        } catch { /* ignore */ }
      });
      es.addEventListener('error', () => { isLive.value = false; });
    } catch { isLive.value = false; }
  }
  function close() {
    if (es) { try { es.close(); } catch {} es = null; }
    isLive.value = false;
  }
  function onVis() { document.hidden ? close() : open(); }

  watch(code, () => { close(); open(); });
  onMounted(() => { open(); document.addEventListener('visibilitychange', onVis); });
  onUnmounted(() => { close(); document.removeEventListener('visibilitychange', onVis); });
  return { isLive };
}
