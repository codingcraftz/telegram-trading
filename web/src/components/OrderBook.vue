<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue';
import { api, type AskingResponse, type AskingLevel } from '@/api/client';
import { fmtKrw, fmtNum } from '@/lib/format';

const props = withDefaults(
  defineProps<{
    code: string;
    /** REST 폴링 주기 (ms). SSE가 살아있으면 무시됨 */
    intervalMs?: number;
    /** 표시할 호가 단계 — 5 또는 10 */
    levels?: 5 | 10;
    /** compact: 폭이 좁을 때 (좌우 split 폼) — 가격/잔량 한 행, 잔량 막대 배경 강조 */
    compact?: boolean;
    /** false면 SSE 안 쓰고 REST 폴링만 */
    useStream?: boolean;
    /** true면 매도/매수 총잔량 합계 행 숨김 */
    hideTotals?: boolean;
  }>(),
  { intervalMs: 1500, levels: 10, compact: false, useStream: true, hideTotals: false },
);

const emit = defineEmits<{ pickPrice: [price: number] }>();

const data = ref<AskingResponse | null>(null);
const streamLive = ref(false);

// 클릭 피드백 — 누른 row 잠깐 ring + flash. 모바일 햅틱.
const flashKey = ref<string | null>(null);
let flashTimer: ReturnType<typeof setTimeout> | null = null;
function pickPrice(side: 'a' | 'b', idx: number, price: number) {
  flashKey.value = `${side}-${idx}`;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flashKey.value = null; }, 220);
  try { (navigator as Navigator & { vibrate?: (p: number) => boolean }).vibrate?.(8); } catch {}
  emit('pickPrice', price);
}
let timer: ReturnType<typeof setInterval> | null = null;
let es: EventSource | null = null;

async function load() {
  if (!props.code) return;
  try {
    data.value = await api.asking(props.code);
  } catch {
    /* silent */
  }
}

let streamRetry = 0;
let streamRetryTimer: ReturnType<typeof setTimeout> | null = null;

function openStream() {
  closeStream();
  if (!props.useStream || !props.code) return;
  try {
    es = new EventSource(`/api/stream/asking?code=${props.code}`);
    es.addEventListener('asking', (ev) => {
      try {
        const snap = JSON.parse((ev as MessageEvent).data) as AskingResponse;
        data.value = snap;
        streamLive.value = true;
        streamRetry = 0;
        stopPolling();
      } catch { /* ignore */ }
    });
    es.addEventListener('ready', () => { /* first ack */ });
    // 장외 — 서버가 closed 이벤트 보냄. polling fallback만.
    es.addEventListener('closed', () => {
      streamLive.value = false;
      closeStream();
      startPolling();
    });
    es.addEventListener('error', () => {
      streamLive.value = false;
      closeStream();
      startPolling();
      // backoff retry SSE (3s, 6s, 12s, max 30s)
      const delay = Math.min(3000 * Math.pow(2, streamRetry), 30_000);
      streamRetry++;
      streamRetryTimer = setTimeout(openStream, delay);
    });
  } catch {
    streamLive.value = false;
    startPolling();
  }
}
function closeStream() {
  if (streamRetryTimer) { clearTimeout(streamRetryTimer); streamRetryTimer = null; }
  if (es) { try { es.close(); } catch {} es = null; }
  streamLive.value = false;
}

function startPolling() {
  stopPolling();
  if (!props.code || props.intervalMs <= 0 || document.hidden) return;
  load();
  timer = setInterval(load, props.intervalMs);
}
function stopPolling() {
  if (timer) clearInterval(timer);
  timer = null;
}
function onVisibility() {
  if (document.hidden) {
    stopPolling();
    closeStream();
  } else {
    load();
    if (props.useStream) openStream();
    else startPolling();
  }
}

// 매도: 1단계가 현재가에 가장 가까움 → 표시는 위에서 아래로 (먼→가까운). reverse.
const askRows = computed<AskingLevel[]>(() => {
  if (!data.value) return [];
  return data.value.asks.slice(0, props.levels).slice().reverse();
});
const bidRows = computed<AskingLevel[]>(() => {
  if (!data.value) return [];
  return data.value.bids.slice(0, props.levels);
});

const maxQty = computed(() => {
  if (!data.value) return 1;
  let m = 1;
  for (const a of data.value.asks.slice(0, props.levels)) if (a.qty > m) m = a.qty;
  for (const b of data.value.bids.slice(0, props.levels)) if (b.qty > m) m = b.qty;
  return m;
});

function barWidth(qty: number) {
  return `${Math.min(100, (qty / maxQty.value) * 100).toFixed(1)}%`;
}

onMounted(() => {
  load();
  if (props.useStream) openStream();
  else startPolling();
  document.addEventListener('visibilitychange', onVisibility);
});
onUnmounted(() => {
  stopPolling();
  closeStream();
  document.removeEventListener('visibilitychange', onVisibility);
});

watch(() => props.code, () => {
  data.value = null;
  closeStream();
  load();
  if (props.useStream) openStream();
  else startPolling();
});
watch(() => props.intervalMs, () => { if (!streamLive.value) startPolling(); });
</script>

<template>
  <div class="text-xs tabular-nums">
    <!-- 데이터 로딩 전 skeleton — 실제 호가 row 와 동일한 높이로 layout shift 방지 -->
    <template v-if="!data">
      <template v-if="compact">
        <div class="space-y-px">
          <div
            v-for="n in levels" :key="`sk-a-${n}`"
            class="flex h-[22px] w-full animate-pulse items-center justify-between rounded bg-muted/30 px-1.5"
          >
            <span class="h-2.5 w-12 rounded bg-muted/60" />
            <span class="h-2.5 w-8 rounded bg-muted/40" />
          </div>
        </div>
        <div class="my-1 h-px bg-border" />
        <div class="space-y-px">
          <div
            v-for="n in levels" :key="`sk-b-${n}`"
            class="flex h-[22px] w-full animate-pulse items-center justify-between rounded bg-muted/30 px-1.5"
          >
            <span class="h-2.5 w-12 rounded bg-muted/60" />
            <span class="h-2.5 w-8 rounded bg-muted/40" />
          </div>
        </div>
      </template>
      <template v-else>
        <div class="space-y-0.5">
          <div
            v-for="n in levels" :key="`sk-a-${n}`"
            class="flex h-[26px] w-full animate-pulse items-center justify-between rounded-md bg-muted/30 px-2"
          >
            <span class="h-2.5 w-16 rounded bg-muted/60" />
            <span class="h-2.5 w-10 rounded bg-muted/40" />
          </div>
        </div>
        <div class="my-1 h-px bg-border" />
        <div class="space-y-0.5">
          <div
            v-for="n in levels" :key="`sk-b-${n}`"
            class="flex h-[26px] w-full animate-pulse items-center justify-between rounded-md bg-muted/30 px-2"
          >
            <span class="h-2.5 w-16 rounded bg-muted/60" />
            <span class="h-2.5 w-10 rounded bg-muted/40" />
          </div>
        </div>
      </template>
    </template>

    <!-- compact: 좁은 컬럼용. 한 셀에 가격 좌 / 잔량 우, 잔량 막대 배경 -->
    <template v-else-if="compact">
      <div class="space-y-px">
        <button
          v-for="(row, idx) in askRows"
          :key="`a-${idx}-${row.price}`"
          type="button"
          class="relative flex w-full items-center justify-between rounded px-1.5 py-1 text-[11px] transition-all duration-150 active:scale-[0.96]"
          :class="flashKey === `a-${idx}` ? 'scale-[1.03] bg-down/20 ring-2 ring-down/50 shadow-md' : ''"
          @click="pickPrice('a', idx, row.price)"
        >
          <div class="absolute inset-y-0 right-0 rounded bg-down/10" :style="{ width: barWidth(row.qty) }" />
          <span class="relative z-10 font-bold text-down">{{ fmtKrw(row.price) }}</span>
          <span class="relative z-10 text-muted-foreground">{{ fmtNum(row.qty) }}</span>
        </button>
      </div>
      <div class="my-1 h-px bg-border" />
      <div class="space-y-px">
        <button
          v-for="(row, idx) in bidRows"
          :key="`b-${idx}-${row.price}`"
          type="button"
          class="relative flex w-full items-center justify-between rounded px-1.5 py-1 text-[11px] transition-all duration-150 active:scale-[0.96]"
          :class="flashKey === `b-${idx}` ? 'scale-[1.03] bg-up/20 ring-2 ring-up/50 shadow-md' : ''"
          @click="pickPrice('b', idx, row.price)"
        >
          <div class="absolute inset-y-0 right-0 rounded bg-up/10" :style="{ width: barWidth(row.qty) }" />
          <span class="relative z-10 font-bold text-up">{{ fmtKrw(row.price) }}</span>
          <span class="relative z-10 text-muted-foreground">{{ fmtNum(row.qty) }}</span>
        </button>
      </div>
    </template>

    <!-- normal: 풀폭 -->
    <template v-else>
      <div class="space-y-0.5">
        <button
          v-for="(row, idx) in askRows"
          :key="`a-${idx}-${row.price}`"
          type="button"
          class="relative grid w-full grid-cols-[1fr_auto] items-center gap-2 rounded-md px-2 py-1 text-left transition-all duration-150 active:scale-[0.97]"
          :class="flashKey === `a-${idx}` ? 'scale-[1.02] bg-down/20 ring-2 ring-down/50 shadow-md' : ''"
          @click="pickPrice('a', idx, row.price)"
        >
          <div class="absolute inset-y-0 right-0 rounded-md bg-down/10" :style="{ width: barWidth(row.qty) }" />
          <span class="relative z-10 font-semibold text-down">{{ fmtKrw(row.price) }}</span>
          <span class="relative z-10 text-muted-foreground">{{ fmtNum(row.qty) }}</span>
        </button>
      </div>
      <div class="my-1 h-px bg-border" />
      <div class="space-y-0.5">
        <button
          v-for="(row, idx) in bidRows"
          :key="`b-${idx}-${row.price}`"
          type="button"
          class="relative grid w-full grid-cols-[1fr_auto] items-center gap-2 rounded-md px-2 py-1 text-left transition-all duration-150 active:scale-[0.97]"
          :class="flashKey === `b-${idx}` ? 'scale-[1.02] bg-up/20 ring-2 ring-up/50 shadow-md' : ''"
          @click="pickPrice('b', idx, row.price)"
        >
          <div class="absolute inset-y-0 right-0 rounded-md bg-up/10" :style="{ width: barWidth(row.qty) }" />
          <span class="relative z-10 font-semibold text-up">{{ fmtKrw(row.price) }}</span>
          <span class="relative z-10 text-muted-foreground">{{ fmtNum(row.qty) }}</span>
        </button>
      </div>
    </template>

    <div v-if="data && !compact && !hideTotals" class="mt-1.5 grid grid-cols-2 gap-2 border-t border-border pt-1.5 text-[10px] text-muted-foreground">
      <div class="flex items-center justify-between">
        <span>매도 잔량</span>
        <span class="font-semibold text-down">{{ fmtNum(data.totalAskQty) }}</span>
      </div>
      <div class="flex items-center justify-between">
        <span>매수 잔량</span>
        <span class="font-semibold text-up">{{ fmtNum(data.totalBidQty) }}</span>
      </div>
    </div>
  </div>
</template>
