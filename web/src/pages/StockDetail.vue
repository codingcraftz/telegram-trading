<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue';
import { useRoute, RouterLink, useRouter } from 'vue-router';
import { ArrowUpRight, ArrowDownRight, ChevronLeft, ChevronDown, Maximize2, Minimize2, Star, StarOff, RefreshCw } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import TradeChart, { type TradeCandle } from '@/components/TradeChart.vue';
import { api, type QuoteResponse, type WatchlistItem } from '@/api/client';
import { fmtKrw, fmtNum, fmtPct, pflsColor } from '@/lib/format';
import { toast } from '@/lib/toast';

const INTERVALS = [
  { key: '5m', label: '5분' },
  { key: '15m', label: '15분' },
  { key: '1h', label: '1시간' },
  { key: '1d', label: '일' },
  { key: '4h', label: '주' },
] as const;

const route = useRoute();
const router = useRouter();
const code = computed(() => (route.params.code as string) ?? '');
const interval = ref<string>('5m');
const quote = ref<QuoteResponse | null>(null);
const candles = ref<TradeCandle[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const detailsOpen = ref(false);
const fullscreen = ref(false);
const watchItem = ref<WatchlistItem | null>(null);

let pollTimer: ReturnType<typeof setInterval> | null = null;
let chartTick = 0;

async function loadQuote() {
  if (!code.value) return;
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
  try {
    const r = await api.candles(code.value, interval.value, 180);
    candles.value = r.candles;
  } catch (err) {
    console.warn('candles fail:', (err as Error).message);
  }
}

async function loadWatchStatus() {
  try {
    const r = await api.watchlist();
    watchItem.value = r.items.find((it) => it.code === code.value) ?? null;
  } catch {
    watchItem.value = null;
  }
}

function startPolling() {
  stopPolling();
  if (!code.value || document.hidden) return;
  pollTimer = setInterval(() => {
    loadQuote();
    chartTick++;
    if (chartTick % 4 === 0) loadCandles();
  }, 2_500);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
function onVisibility() {
  if (document.hidden) stopPolling();
  else { loadQuote(); startPolling(); }
}

async function toggleWatch() {
  if (!code.value) return;
  try {
    if (watchItem.value) {
      await api.watchlistRemove(watchItem.value.id);
      toast.info('관심에서 뺐어요');
      watchItem.value = null;
    } else {
      const r = await api.watchlistAdd(code.value);
      toast.success(`${r.name} 담았어요`);
      await loadWatchStatus();
    }
  } catch (err) {
    toast.error((err as Error).message);
  }
}

watch(code, () => { loadQuote(); loadCandles(); loadWatchStatus(); startPolling(); });
watch(interval, loadCandles);

onMounted(() => {
  loadQuote();
  loadCandles();
  loadWatchStatus();
  startPolling();
  document.addEventListener('visibilitychange', onVisibility);
});
onUnmounted(() => {
  stopPolling();
  document.removeEventListener('visibilitychange', onVisibility);
});
</script>

<template>
  <div :class="fullscreen ? 'fixed inset-0 z-30 bg-background overflow-y-auto' : ''">
    <div class="space-y-4" :class="fullscreen ? 'p-4' : ''">
      <!-- 헤더 -->
      <div class="flex items-center gap-2 px-1">
        <button class="-ml-2 rounded-md p-2 text-muted-foreground transition hover:bg-accent" @click="router.back()">
          <ChevronLeft class="h-5 w-5" />
        </button>
        <div class="min-w-0 flex-1">
          <h2 class="truncate text-base font-bold tracking-tight">{{ quote?.name ?? code }}</h2>
          <p class="text-[10px] text-muted-foreground tabular-nums">{{ code }}<span v-if="quote?.industry"> · {{ quote.industry }}</span></p>
        </div>
        <button class="rounded-md p-2 text-muted-foreground transition hover:bg-accent" :disabled="loading" @click="loadQuote">
          <RefreshCw class="h-4 w-4" :class="loading ? 'animate-spin' : ''" />
        </button>
        <button class="rounded-md p-2 text-muted-foreground transition hover:bg-accent" @click="toggleWatch">
          <Star v-if="watchItem" class="h-5 w-5 fill-amber-400 text-amber-400" />
          <StarOff v-else class="h-5 w-5" />
        </button>
      </div>

      <!-- 가격 헤드라인 -->
      <Card v-if="quote">
        <p class="text-[2.4rem] font-bold leading-none tabular-nums tracking-tighter">{{ fmtKrw(quote.price) }}</p>
        <div class="mt-2 flex items-center gap-1.5 text-sm">
          <ArrowUpRight v-if="quote.change > 0" class="h-4 w-4 text-up" />
          <ArrowDownRight v-else-if="quote.change < 0" class="h-4 w-4 text-down" />
          <span class="font-semibold tabular-nums" :class="pflsColor(quote.change)">
            {{ quote.change >= 0 ? '+' : '' }}{{ fmtKrw(quote.change) }}
          </span>
          <span class="text-xs font-semibold tabular-nums" :class="pflsColor(quote.change)">
            ({{ fmtPct(quote.changeRate) }})
          </span>
          <span class="ml-1 text-[11px] text-muted-foreground">어제보다</span>
        </div>
      </Card>
      <p v-else-if="error" class="text-sm text-destructive">{{ error }}</p>

      <!-- 차트 -->
      <Card v-if="code">
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex gap-1 overflow-x-auto">
              <button
                v-for="i in INTERVALS"
                :key="i.key"
                class="shrink-0 rounded-md px-2.5 py-1 text-[11px] font-semibold transition"
                :class="i.key === interval ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'"
                @click="interval = i.key"
              >
                {{ i.label }}
              </button>
            </div>
            <button class="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent" @click="fullscreen = !fullscreen">
              <Maximize2 v-if="!fullscreen" class="h-4 w-4" />
              <Minimize2 v-else class="h-4 w-4" />
            </button>
          </div>
        </template>
        <TradeChart :candles="candles" :height="fullscreen ? 560 : 320" :show-volume="true" />
      </Card>

      <!-- 오늘 흐름 -->
      <Card v-if="quote && !fullscreen">
        <template #header>
          <h3 class="text-sm font-bold tracking-tight">오늘 흐름</h3>
        </template>
        <div class="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p class="text-[10px] text-muted-foreground">시작</p>
            <p class="mt-0.5 font-semibold tabular-nums">{{ fmtKrw(quote.open) }}</p>
          </div>
          <div>
            <p class="text-[10px] text-muted-foreground">최고</p>
            <p class="mt-0.5 font-semibold tabular-nums text-up">{{ fmtKrw(quote.high) }}</p>
          </div>
          <div>
            <p class="text-[10px] text-muted-foreground">최저</p>
            <p class="mt-0.5 font-semibold tabular-nums text-down">{{ fmtKrw(quote.low) }}</p>
          </div>
          <div>
            <p class="text-[10px] text-muted-foreground">거래량</p>
            <p class="mt-0.5 font-semibold tabular-nums">{{ fmtNum(quote.volume) }}주</p>
          </div>
        </div>
      </Card>

      <!-- 상세 정보 토글 -->
      <Card v-if="quote && !fullscreen">
        <button class="-mx-1 flex w-full items-center justify-between px-1 py-0.5" @click="detailsOpen = !detailsOpen">
          <h3 class="text-sm font-bold tracking-tight">상세 정보</h3>
          <ChevronDown class="h-4 w-4 text-muted-foreground transition-transform" :class="detailsOpen ? 'rotate-180' : ''" />
        </button>
        <div v-if="detailsOpen" class="mt-3 space-y-3 border-t border-border pt-3 text-sm">
          <div v-if="quote.week52High > 0" class="flex items-center justify-between">
            <span class="text-muted-foreground">52주 최저 ~ 최고</span>
            <span class="font-semibold tabular-nums">{{ fmtKrw(quote.week52Low) }} ~ {{ fmtKrw(quote.week52High) }}</span>
          </div>
          <div v-if="quote.per" class="flex items-center justify-between">
            <span class="text-muted-foreground">PER <span class="text-[10px]">(주가수익비율)</span></span>
            <span class="font-semibold tabular-nums">{{ quote.per }}</span>
          </div>
          <div v-if="quote.pbr" class="flex items-center justify-between">
            <span class="text-muted-foreground">PBR <span class="text-[10px]">(주가순자산비율)</span></span>
            <span class="font-semibold tabular-nums">{{ quote.pbr }}</span>
          </div>
          <div v-if="quote.foreignerRatio > 0" class="flex items-center justify-between">
            <span class="text-muted-foreground">외국인 비중</span>
            <span class="font-semibold tabular-nums">{{ quote.foreignerRatio.toFixed(2) }}%</span>
          </div>
        </div>
      </Card>

      <!-- 액션 -->
      <div v-if="!fullscreen" class="grid grid-cols-2 gap-2 pt-1">
        <RouterLink :to="`/buy?code=${code}`">
          <Button variant="primary" size="lg" class="w-full">
            <ArrowUpRight class="mr-1 h-4 w-4" />사기
          </Button>
        </RouterLink>
        <RouterLink :to="`/sell?code=${code}`">
          <Button variant="destructive" size="lg" class="w-full">
            <ArrowDownRight class="mr-1 h-4 w-4" />팔기
          </Button>
        </RouterLink>
      </div>
    </div>
  </div>
</template>
