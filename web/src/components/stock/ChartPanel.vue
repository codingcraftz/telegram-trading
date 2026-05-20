<script setup lang="ts">
// ChartPanel — TradeChart 래핑. KIS MTS 차트 스타일 (봉 토글 + 이동평균선 5/20/60/120).
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import TradeChart, { type TradeCandle } from '@/components/TradeChart.vue';
import Card from '@/components/ui/Card.vue';
import { api } from '@/api/client';
import { usePrefs } from '@/stores/prefs';

type Timeframe = '5m' | '1d' | '1w' | '1M';

const INTERVALS: Record<Timeframe, { label: string; fetch: number; visible: number }> = {
  '1d': { label: '일', fetch: 120, visible: 60 },
  '1w': { label: '주', fetch: 80, visible: 32 },
  '1M': { label: '월', fetch: 36, visible: 24 },
  '5m': { label: '분', fetch: 200, visible: 60 },
};

const props = withDefaults(defineProps<{ code: string; height?: number }>(), { height: 320 });

const prefs = usePrefs();

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

const availableTimeframes: Timeframe[] = ['1d', '1w', '1M', '5m'];
const visibleBars = computed(() => INTERVALS[timeframe.value].visible);

// 이동평균선 — KIS 차트와 동일하게 5/20/60/120.
// 데이터 길이가 짧으면 lightweight-charts 가 자동으로 partial render.
const MA_PERIODS = [5, 20, 60, 120];
const MA_COLOR: Record<number, string> = { 5: '#e23744', 20: '#a855f7', 60: '#1e88e5', 120: '#22c55e' };

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
      <div class="flex items-center justify-between gap-2">
        <!-- 봉 토글 — KIS 스타일 outlined 칩 -->
        <div class="flex gap-1">
          <button
            v-for="t in availableTimeframes" :key="t"
            class="shrink-0 rounded-md px-3 py-1 text-[11px] font-semibold transition"
            :class="t === timeframe
              ? 'bg-foreground text-background ring-1 ring-foreground'
              : 'bg-transparent text-muted-foreground ring-1 ring-border hover:text-foreground'"
            @click="timeframe = t"
          >
            {{ INTERVALS[t].label }}
          </button>
        </div>

        <!-- 이동평균선 색상 라벨 -->
        <div class="flex items-center gap-1.5 text-[10px] font-semibold tabular-nums">
          <span
            v-for="p in MA_PERIODS" :key="p"
            class="inline-flex items-center gap-0.5"
            :style="{ color: MA_COLOR[p] }"
          >
            <span class="inline-block h-1.5 w-1.5 rounded-sm" :style="{ backgroundColor: MA_COLOR[p] }" />
            {{ p }}
          </span>
        </div>
      </div>
    </template>
    <TradeChart
      :key="themeKey"
      :candles="candles"
      :height="height"
      :show-volume="true"
      :visible-bars="visibleBars"
      :moving-averages="MA_PERIODS"
    />
  </Card>
</template>
