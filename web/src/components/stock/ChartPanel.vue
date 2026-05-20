<script setup lang="ts">
// ChartPanel — KIS MTS 스타일. 봉 토글 [일/주/월/분] + 분봉 드롭다운 (5분/15분) +
// 이동평균선 5/20/60/120 + 거래량은 별도 패널 (시간축 동기화).
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import TradeChart, { type TradeCandle } from '@/components/TradeChart.vue';
import Card from '@/components/ui/Card.vue';
import { api } from '@/api/client';
import { usePrefs } from '@/stores/prefs';

type Timeframe = '5m' | '15m' | '1d' | '1w' | '1M';
type Bucket = 'day' | 'week' | 'month' | 'min';

const INTERVALS: Record<Timeframe, { fetch: number; visible: number }> = {
  '1d': { fetch: 120, visible: 60 },
  '1w': { fetch: 80, visible: 32 },
  '1M': { fetch: 36, visible: 24 },
  '5m': { fetch: 200, visible: 60 },
  '15m': { fetch: 200, visible: 60 },
};

const BUCKETS: { value: Bucket; label: string }[] = [
  { value: 'day', label: '일' },
  { value: 'week', label: '주' },
  { value: 'month', label: '월' },
  { value: 'min', label: '분' },
];

const props = withDefaults(defineProps<{ code: string; height?: number }>(), { height: 240 });

const prefs = usePrefs();

// 분봉 sub 선택 (5분/15분). 사용자가 분 탭 active 시점에 표시.
const minBucket = ref<'5m' | '15m'>('5m');
const bucket = ref<Bucket>('day');
const timeframe = computed<Timeframe>(() => {
  if (bucket.value === 'day') return '1d';
  if (bucket.value === 'week') return '1w';
  if (bucket.value === 'month') return '1M';
  return minBucket.value;
});

const candles = ref<TradeCandle[]>([]);

// 다크/라이트 reactive
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

const visibleBars = computed(() => INTERVALS[timeframe.value].visible);

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
      <div class="space-y-2">
        <div class="flex items-center justify-between gap-2">
          <!-- 봉 토글 -->
          <div class="flex gap-1">
            <button
              v-for="b in BUCKETS" :key="b.value"
              class="shrink-0 rounded-md px-3 py-1 text-[11px] font-semibold transition"
              :class="b.value === bucket
                ? 'bg-foreground text-background ring-1 ring-foreground'
                : 'bg-transparent text-muted-foreground ring-1 ring-border hover:text-foreground'"
              @click="bucket = b.value"
            >
              {{ b.label }}
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

        <!-- 분봉 sub 토글 — '분' 활성 시만 노출 -->
        <div v-if="bucket === 'min'" class="flex gap-1">
          <button
            v-for="m in (['5m', '15m'] as const)" :key="m"
            class="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition"
            :class="m === minBucket
              ? 'bg-primary/15 text-primary ring-1 ring-primary/40'
              : 'bg-muted text-muted-foreground hover:text-foreground'"
            @click="minBucket = m"
          >
            {{ m === '5m' ? '5분' : '15분' }}
          </button>
        </div>
      </div>
    </template>
    <TradeChart
      :key="themeKey"
      :candles="candles"
      :height="height"
      :show-volume="true"
      :split-volume="true"
      :volume-height="80"
      :visible-bars="visibleBars"
      :moving-averages="MA_PERIODS"
    />
  </Card>
</template>
