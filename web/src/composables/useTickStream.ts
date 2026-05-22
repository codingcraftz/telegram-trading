// useTickStream — KIS 체결가 SSE.
// code 변경 시 재연결, visibility hidden 시 close.
// 장외 시간 closed 이벤트 수신 시 retry 중단.
import { ref, watch, onMounted, onUnmounted, type Ref } from 'vue';
import type { TickSnapshot } from '@/api/client';

export function useTickStream(code: Ref<string>, onTick: (snap: TickSnapshot) => void) {
  const isLive = ref(false);
  let es: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryCount = 0;

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
          retryCount = 0;
        } catch { /* ignore */ }
      });
      // 장외 시간 — 서버가 closed 이벤트 보냄. retry 안 함.
      es.addEventListener('closed', () => {
        isLive.value = false;
        close();
      });
      es.addEventListener('error', () => {
        isLive.value = false;
        // 자동 재연결 (backoff: 3s, 6s, 12s, max 30s)
        close();
        const delay = Math.min(3000 * Math.pow(2, retryCount), 30_000);
        retryCount++;
        retryTimer = setTimeout(open, delay);
      });
    } catch { isLive.value = false; }
  }
  function close() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (es) { try { es.close(); } catch {} es = null; }
    isLive.value = false;
  }
  function onVis() { document.hidden ? close() : open(); }

  watch(code, () => { retryCount = 0; close(); open(); });
  onMounted(() => { open(); document.addEventListener('visibilitychange', onVis); });
  onUnmounted(() => { close(); document.removeEventListener('visibilitychange', onVis); });
  return { isLive };
}
