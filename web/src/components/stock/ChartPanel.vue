<script setup lang="ts">
// ChartPanel — TradeChart 래핑 + timeframe 칩 + 다크/라이트 토글 시 재마운트.
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import TradeChart, { type TradeCandle } from '@/components/TradeChart.vue';
import Card from '@/components/ui/Card.vue';
import { api } from '@/api/client';
import { usePrefs } from '@/stores/prefs';

type Timeframe = '5m' | '15m' | '1d' | '1w' | '1M';

const INTERVALS: Record<Timeframe, { label: string; fetch: number; visible: number }> = {
  '5m': { label: '5분', fetch: 200, visible: 50 },
  '15m': { label: '15분', fetch: 200, visible: 50 },
  '1d': { label: '일', fetch: 90, visible: 30 },
  '1w': { label: '주', fetch: 60, visible: 26 },
  '1M': { label: '월', fetch: 36, visible: 18 },
};

const props = withDefaults(defineProps<{ code: string; height?: number }>(), { height: 300 });

const prefs = usePrefs();
const isAdvanced = computed(() => prefs.mode === 'advanced');

const timeframe = ref<Timeframe>('1d');
const candles = ref<TradeCandle[]>([]);

// 다크/라이트 reactive — prefs.theme + system pref watch
const systemDark = ref(
  typeof window !== 'undefined'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false,
);
let mql: MediaQueryList | null = null;
function onMqlChange(e: MediaQueryListEvent) { systemDark.value = e.matches; }
onMounted(() => {
  mql = window.matchMedia('(prefers-color-scheme: dark)');
  if (mql.addEventListener) mql.addEventListener('change', onMqlChange);
  else mql.addListener(onMqlChange);
});
onUnmounted(() => {
  if (!mql) return;
  if (mql.removeEventListener) mql.removeEventListener('change', onMqlChange);
  else mql.removeListener(onMqlChange);
});
const themeKey = computed<'dark' | 'light'>(() => {
  const t = prefs.theme;
  if (t === 'dark') return 'dark';
  if (t === 'light') return 'light';
  return systemDark.value ? 'dark' : 'light';
});

const availableTimeframes = computed<Timeframe[]>(() =>
  isAdvanced.value ? ['5m', '15m', '1d', '1w', '1M'] : ['1d', '1w', '1M'],
);
const visibleBars = computed(() => INTERVALS[timeframe.value].visible);

function setCandles(c: TradeCandle[]) { candles.value = c; }
function patchLast(snap: { price: number; cumVolume?: number }) {
  if (candles.value.length === 0) return;
  const last = candles.value[candles.value.length - 1]!;
  candles.value = [
    ...candles.value.slice(0, -1),
    {
      ...last,
      close: snap.price,
      high: Math.max(last.high, snap.price),
      low: Math.min(last.low > 0 ? last.low : snap.price, snap.price),
      volume: snap.cumVolume && snap.cumVolume > 0 ? snap.cumVolume : last.volume,
    },
  ];
}
defineExpose({ setCandles, patchLast, refresh: () => load() });

async function load() {
  if (!props.code) return;
  try {
    const r = await api.candles(props.code, timeframe.value, INTERVALS[timeframe.value].fetch);
    candles.value = r.candles;
  } catch (err) {
    console.warn('candles fail:', (err as Error).message);
  }
}

watch(() => props.code, load);
watch(timeframe, load);
onMounted(load);
</script>

<template>
  <Card>
    <template #header>
      <div class="flex gap-1 overflow-x-auto">
        <button
          v-for="t in availableTimeframes" :key="t"
          class="shrink-0 rounded-md px-2.5 py-1 text-[11px] font-semibold transition"
          :class="t === timeframe ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'"
          @click="timeframe = t"
        >
          {{ INTERVALS[t].label }}
        </button>
      </div>
    </template>
    <TradeChart
      :key="themeKey"
      :candles="candles"
      :height="height"
      :show-volume="true"
      :visible-bars="visibleBars"
    />
  </Card>
</template>
