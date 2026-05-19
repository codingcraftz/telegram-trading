// useMarketSession — /api/session 60s 캐싱 + 4 버킷.
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { api, type SessionResponse } from '@/api/client';

export type SessionBucket = 'open' | 'before' | 'after' | 'closed';

const REFRESH_MS = 60_000;
const _state = {
  raw: ref<SessionResponse | null>(null),
  lastFetch: 0,
  inflight: null as Promise<void> | null,
};

function bucketOf(s: string | undefined): SessionBucket {
  if (s === 'regular') return 'open';
  if (s === 'pre_extended' || s === 'pre_auction') return 'before';
  if (s === 'close_auction' || s === 'post_extended' || s === 'after_single') return 'after';
  return 'closed';
}

async function load(force = false) {
  if (!force && Date.now() - _state.lastFetch < REFRESH_MS) return;
  if (_state.inflight) return _state.inflight;
  _state.inflight = (async () => {
    try {
      _state.raw.value = await api.session();
      _state.lastFetch = Date.now();
    } catch {} finally { _state.inflight = null; }
  })();
  return _state.inflight;
}

export function useMarketSession() {
  let timer: ReturnType<typeof setInterval> | null = null;
  onMounted(() => { load(); timer = setInterval(() => load(), REFRESH_MS); });
  onUnmounted(() => { if (timer) clearInterval(timer); });
  return {
    session: computed<SessionBucket>(() => bucketOf(_state.raw.value?.session)),
    label: computed(() => _state.raw.value?.label ?? ''),
    nowKst: computed(() => _state.raw.value?.nowKst ?? null),
    refresh: () => load(true),
  };
}
