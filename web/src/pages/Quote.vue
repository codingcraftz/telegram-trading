<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';
import { RefreshCw, Plus, ArrowUpRight, ArrowDownRight } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import SymbolSearch from '@/components/SymbolSearch.vue';
import TradeChart, { type TradeCandle } from '@/components/TradeChart.vue';
import { api, type QuoteResponse, type SearchItem } from '@/api/client';
import { fmtKrw, fmtNum, fmtPct, pflsColor } from '@/lib/format';
import { toast } from '@/lib/toast';

const INTERVALS = [
  { key: '1m', label: '1분' },
  { key: '5m', label: '5분' },
  { key: '15m', label: '15분' },
  { key: '1h', label: '1시간' },
  { key: '1d', label: '일봉' },
] as const;

const route = useRoute();
const router = useRouter();
const code = ref<string>((route.query.code as string) ?? '');
const interval = ref<string>('5m');
const quote = ref<QuoteResponse | null>(null);
const candles = ref<TradeCandle[]>([]);
const loading = ref(false);
const chartLoading = ref(false);
const error = ref<string | null>(null);

const POLL_MS = 2500;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let chartTick = 0;

async function load() {
  if (!code.value) {
    quote.value = null;
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    quote.value = await api.quote(code.value);
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

async function loadCandles() {
  if (!code.value) return;
  chartLoading.value = true;
  try {
    const r = await api.candles(code.value, interval.value, 180);
    candles.value = r.candles;
  } catch (err) {
    console.warn('candles fail:', (err as Error).message);
  } finally {
    chartLoading.value = false;
  }
}

async function refreshAll() {
  await Promise.all([load(), loadCandles()]);
}

function startPolling() {
  stopPolling();
  if (!code.value || document.hidden) return;
  pollTimer = setInterval(() => {
    load();
    chartTick++;
    if (chartTick % 4 === 0) loadCandles();
  }, POLL_MS);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
function onVisibility() {
  if (document.hidden) stopPolling();
  else { load(); startPolling(); }
}

function pickSymbol(item: SearchItem) {
  code.value = item.code;
  router.replace({ query: { code: item.code } });
}

async function addWatchlist() {
  if (!code.value) return;
  try {
    const r = await api.watchlistAdd(code.value);
    if (r.existed) toast.info('이미 관심종목에 있습니다');
    else toast.success(`${r.name} 추가됨`);
  } catch (err) {
    toast.error((err as Error).message);
  }
}

watch(code, () => {
  load();
  loadCandles();
  startPolling();
});
watch(interval, () => loadCandles());

onMounted(() => {
  refreshAll();
  startPolling();
  document.addEventListener('visibilitychange', onVisibility);
});
onUnmounted(() => {
  stopPolling();
  document.removeEventListener('visibilitychange', onVisibility);
});
</script>

<template>
  <div class="space-y-3">
    <div class="px-1">
      <h2 class="text-base font-semibold tracking-tight">시세</h2>
    </div>

    <SymbolSearch placeholder="종목명 또는 6자리 코드" @pick="pickSymbol" />

    <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

    <Card v-if="quote">
      <template #header>
        <div class="flex items-start justify-between">
          <div>
            <h3 class="text-base font-bold tracking-tight">{{ quote.name }}</h3>
            <p class="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
              {{ quote.code }}<span v-if="quote.industry"> · {{ quote.industry }}</span>
            </p>
          </div>
          <button class="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent" :disabled="loading" @click="refreshAll">
            <RefreshCw class="h-4 w-4" :class="loading ? 'animate-spin' : ''" />
          </button>
        </div>
      </template>

      <div>
        <p class="text-3xl font-bold tabular-nums tracking-tighter">{{ fmtKrw(quote.price) }}</p>
        <div class="mt-1.5 flex items-center gap-1.5 text-sm">
          <ArrowUpRight v-if="quote.change > 0" class="h-4 w-4 text-up" />
          <ArrowDownRight v-else-if="quote.change < 0" class="h-4 w-4 text-down" />
          <span class="font-semibold tabular-nums" :class="pflsColor(quote.change)">
            {{ quote.change >= 0 ? '+' : '' }}{{ fmtKrw(quote.change) }}
          </span>
          <span class="tabular-nums text-xs" :class="pflsColor(quote.change)">
            ({{ fmtPct(quote.changeRate) }})
          </span>
        </div>
      </div>

      <div class="mt-4 grid grid-cols-3 gap-1.5 text-xs">
        <div class="rounded-lg bg-muted/50 px-2.5 py-2">
          <p class="text-[10px] text-muted-foreground">시가</p>
          <p class="mt-0.5 font-semibold tabular-nums">{{ fmtKrw(quote.open) }}</p>
        </div>
        <div class="rounded-lg bg-muted/50 px-2.5 py-2">
          <p class="text-[10px] text-muted-foreground">고가</p>
          <p class="mt-0.5 font-semibold tabular-nums text-up">{{ fmtKrw(quote.high) }}</p>
        </div>
        <div class="rounded-lg bg-muted/50 px-2.5 py-2">
          <p class="text-[10px] text-muted-foreground">저가</p>
          <p class="mt-0.5 font-semibold tabular-nums text-down">{{ fmtKrw(quote.low) }}</p>
        </div>
        <div class="col-span-3 rounded-lg bg-muted/50 px-2.5 py-2">
          <p class="text-[10px] text-muted-foreground">거래량</p>
          <p class="mt-0.5 font-semibold tabular-nums">{{ fmtNum(quote.volume) }}주</p>
        </div>
        <div v-if="quote.week52High > 0" class="col-span-3 rounded-lg bg-muted/50 px-2.5 py-2">
          <p class="text-[10px] text-muted-foreground">52주 최저 — 최고</p>
          <p class="mt-0.5 font-semibold tabular-nums">
            {{ fmtKrw(quote.week52Low) }} — {{ fmtKrw(quote.week52High) }}
          </p>
        </div>
        <div v-if="quote.per" class="rounded-lg bg-muted/50 px-2.5 py-2">
          <p class="text-[10px] text-muted-foreground">PER</p>
          <p class="mt-0.5 font-semibold tabular-nums">{{ quote.per }}</p>
        </div>
        <div v-if="quote.pbr" class="rounded-lg bg-muted/50 px-2.5 py-2">
          <p class="text-[10px] text-muted-foreground">PBR</p>
          <p class="mt-0.5 font-semibold tabular-nums">{{ quote.pbr }}</p>
        </div>
        <div v-if="quote.foreignerRatio > 0" class="rounded-lg bg-muted/50 px-2.5 py-2">
          <p class="text-[10px] text-muted-foreground">외인</p>
          <p class="mt-0.5 font-semibold tabular-nums">{{ quote.foreignerRatio.toFixed(2) }}%</p>
        </div>
      </div>

      <div class="mt-4 grid grid-cols-2 gap-2">
        <RouterLink :to="`/trade/buy?code=${code}`">
          <Button variant="primary" size="md" class="w-full">
            <ArrowUpRight class="mr-1 h-4 w-4" />매수
          </Button>
        </RouterLink>
        <Button variant="secondary" size="md" class="w-full" @click="addWatchlist">
          <Plus class="mr-1 h-4 w-4" />관심 추가
        </Button>
      </div>
    </Card>

    <Card v-if="code">
      <template #header>
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold tracking-tight">차트</h3>
          <div class="flex gap-1 overflow-x-auto">
            <button
              v-for="i in INTERVALS"
              :key="i.key"
              class="rounded-md px-2.5 py-1 text-[11px] font-semibold transition"
              :class="i.key === interval ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground hover:bg-muted'"
              @click="interval = i.key"
            >
              {{ i.label }}
            </button>
          </div>
        </div>
      </template>
      <TradeChart :candles="candles" :height="360" :show-volume="true" />
    </Card>

    <Card v-else>
      <p class="text-sm text-muted-foreground">위 검색창에서 종목을 선택하세요.</p>
    </Card>
  </div>
</template>
