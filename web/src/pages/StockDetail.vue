<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ArrowUpRight, ArrowDownRight, ChevronLeft, ChevronDown,
  Maximize2, Minimize2, Star, StarOff, RefreshCw, Info, Zap, Calendar,
} from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import Modal from '@/components/ui/Modal.vue';
import TradeChart, { type TradeCandle } from '@/components/TradeChart.vue';
import OrderBook from '@/components/OrderBook.vue';
import PriceStepper from '@/components/PriceStepper.vue';
import InfoTooltip from '@/components/InfoTooltip.vue';
import {
  api,
  type Holding,
  type QuoteResponse,
  type SessionResponse,
  type TickSnapshot,
  type TradeBuyBody,
  type WatchlistItem,
} from '@/api/client';
import { fmtKrw, fmtNum, fmtPct, fmtSigned, pflsColor } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useOrdersStore } from '@/stores/orders';

const INTERVALS = [
  { key: '5m', label: '5분', fetch: 200, visible: 50 },
  { key: '15m', label: '15분', fetch: 200, visible: 50 },
  { key: '1d', label: '일', fetch: 90, visible: 30 },
  { key: '1w', label: '주', fetch: 60, visible: 26 },
  { key: '1M', label: '월', fetch: 36, visible: 18 },
] as const;

const route = useRoute();
const router = useRouter();
const ordersStore = useOrdersStore();
const code = computed(() => (route.params.code as string) ?? '');
const interval = ref<string>('1d');
const quote = ref<QuoteResponse | null>(null);
const candles = ref<TradeCandle[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const detailsOpen = ref(false);
const fullscreen = ref(false);
const watchItem = ref<WatchlistItem | null>(null);

// 상단 탭: 주문 ↔ 차트
type View = 'order' | 'chart';
const view = ref<View>('order');

// 사기 ↔ 팔기
type Tab = 'buy' | 'sell';
const initialTab = (route.query.tab as Tab) === 'sell' ? 'sell' : 'buy';
const tab = ref<Tab>(initialTab);

const cash = ref<number>(0);
const holdings = ref<Holding[]>([]);
const session = ref<SessionResponse | null>(null);

const existingHolding = computed<Holding | null>(
  () => holdings.value.find((h) => h.code === code.value) ?? null,
);
const marketNotice = computed<string | null>(() => {
  const s = session.value?.session;
  if (!s || s === 'regular') return null;
  if (s === 'pre_extended' || s === 'pre_auction') return '장 시작 전이에요. 지금 사기는 단일가매매 영역으로 들어가요.';
  if (s === 'close_auction' || s === 'post_extended' || s === 'after_single') return '장 마감 후예요. 지금 사기는 거절될 수 있어요 — 내일 시가에 사기를 추천해요.';
  return '장이 닫혀있어요. 지금 사기 대신 내일 시가에 사기로 자동 예약돼요.';
});

// 매수 폼 상태
const strategy = ref<'now' | 'mo'>('now');
const priceMode = ref<'market' | 'limit'>('market'); // 시장가 / 지정가
const limitPrice = ref<number>(0); // 지정가 (원)
const buyQty = ref<number>(1); // 사고 싶은 주식 수
const tpOn = ref(false);
const slOn = ref(false);
const tp = ref<string>('');
const sl = ref<string>('');

// 매도 폼 상태
const sellMode = ref<'all' | 'half' | 'shares'>('all');
const sellShares = ref<number>(1);

const submitting = ref(false);
const confirmOpen = ref(false);

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

const intervalCfg = computed(() => INTERVALS.find((i) => i.key === interval.value) ?? INTERVALS[2]);

async function loadCandles() {
  if (!code.value) return;
  try {
    const r = await api.candles(code.value, interval.value, intervalCfg.value.fetch);
    candles.value = r.candles;
  } catch (err) {
    console.warn('candles fail:', (err as Error).message);
  }
}

async function loadBalance() {
  try {
    const b = await api.balance();
    cash.value = b.cash;
    holdings.value = b.holdings;
  } catch { /* silent */ }
}

async function loadSession() {
  try {
    session.value = await api.session();
    const s = session.value?.session;
    if (s === 'closed' || s === 'holiday') strategy.value = 'mo';
  } catch { /* silent */ }
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
  // tick SSE가 살아있으면 빠른 폴링은 불필요 — 60초마다 백업 갱신만
  const intervalMs = tickStreamLive.value ? 30_000 : 2_500;
  pollTimer = setInterval(() => {
    loadQuote();
    chartTick++;
    if (chartTick % 4 === 0) loadCandles();
  }, intervalMs);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

// 체결가 실시간 SSE
const tickStreamLive = ref(false);
let tickEs: EventSource | null = null;
function openTickStream() {
  closeTickStream();
  if (!code.value) return;
  try {
    tickEs = new EventSource(`/api/stream/tick?code=${code.value}`);
    tickEs.addEventListener('tick', (ev) => {
      try {
        const snap = JSON.parse((ev as MessageEvent).data) as TickSnapshot;
        applyTick(snap);
        tickStreamLive.value = true;
      } catch { /* ignore */ }
    });
    tickEs.addEventListener('error', () => {
      tickStreamLive.value = false;
    });
  } catch {
    tickStreamLive.value = false;
  }
}
function closeTickStream() {
  if (tickEs) { try { tickEs.close(); } catch {} tickEs = null; }
  tickStreamLive.value = false;
}
function applyTick(snap: TickSnapshot) {
  if (snap.code !== code.value) return;
  // quote price/change 갱신
  if (quote.value) {
    quote.value = { ...quote.value, price: snap.price, change: snap.change, changeRate: snap.changePct };
  }
  // 차트 마지막 봉 close 갱신 (high/low/volume 따라 보정)
  if (candles.value.length > 0) {
    const last = candles.value[candles.value.length - 1]!;
    const newLast = {
      ...last,
      close: snap.price,
      high: Math.max(last.high, snap.price),
      low: Math.min(last.low > 0 ? last.low : snap.price, snap.price),
      volume: snap.cumVolume > 0 ? snap.cumVolume : last.volume,
    };
    candles.value = [...candles.value.slice(0, -1), newLast];
  }
}

function onVisibility() {
  if (document.hidden) {
    stopPolling();
    closeTickStream();
  } else {
    loadQuote();
    openTickStream();
    startPolling();
  }
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

// 매수 계산
const stepperStep = computed(() => {
  const p = quote.value?.price ?? 50_000;
  if (p < 1_000) return 1_000;
  if (p < 10_000) return 5_000;
  if (p < 100_000) return 10_000;
  return 50_000;
});
const buyBasePrice = computed(() => {
  if (priceMode.value === 'limit' && limitPrice.value > 0) return limitPrice.value;
  return quote.value?.price ?? 0;
});
const buyBudget = computed(() => buyQty.value * buyBasePrice.value);

// 매수 가능금액의 N% → 주식 수 자동 계산
function setBuyPercent(p: number) {
  if (buyBasePrice.value <= 0) return;
  const budget = (cash.value * p) / 100;
  buyQty.value = Math.max(1, Math.floor(budget / buyBasePrice.value));
}

// 호가 클릭 → 지정가 모드로 전환 + 가격 설정
function onAskingPriceClick(p: number) {
  if (tab.value !== 'buy') return;
  priceMode.value = 'limit';
  limitPrice.value = p;
}

// 매도 계산 — 매도 가능 수량 (orderable) 기준. 오늘 산 주식은 결제 후 매도 가능.
const sellableMax = computed(() => {
  if (!existingHolding.value) return 0;
  const o = existingHolding.value.orderable;
  return o > 0 ? o : existingHolding.value.qty;
});
const sellUnsettled = computed(() => {
  if (!existingHolding.value) return 0;
  return Math.max(0, existingHolding.value.qty - sellableMax.value);
});
const sellQty = computed(() => {
  const max = sellableMax.value;
  if (max <= 0) return 0;
  if (sellMode.value === 'all') return max;
  if (sellMode.value === 'half') return Math.max(1, Math.floor(max / 2));
  return Math.max(0, Math.min(sellShares.value, max));
});
const sellRevenue = computed(() => {
  if (!quote.value || !existingHolding.value) return 0;
  return sellQty.value * quote.value.price;
});

// 발주
function openConfirm() {
  if (!code.value) { toast.error('종목을 먼저 선택해 주세요'); return; }
  if (tab.value === 'buy') {
    if (buyQty.value <= 0) { toast.error('살 수 있는 수량이 0주예요'); return; }
  } else {
    if (!existingHolding.value) { toast.error('갖고 있는 주식이 없어요'); return; }
    if (sellQty.value <= 0) { toast.error('팔 수량이 0주예요'); return; }
  }
  confirmOpen.value = true;
}

async function submit() {
  if (submitting.value) return;
  submitting.value = true;

  const isBuy = tab.value === 'buy';
  try {
    if (isBuy) {
      const useLimit = priceMode.value === 'limit' && limitPrice.value > 0 && strategy.value === 'now';
      const body: TradeBuyBody = {
        code: code.value,
        strategy: strategy.value,
        amount: { mode: 'shares', value: buyQty.value },
        tp: tpOn.value && tp.value !== '' ? Number(tp.value) : null,
        sl: slOn.value && sl.value !== '' ? Number(sl.value) : null,
        limitPrice: useLimit ? limitPrice.value : null,
        execute: true, // 시가매매·즉시매수 모두 1 RT
      };
      const reg = await api.tradeBuy(body);
      if (reg.result) {
        if (reg.result.ok) {
          toast.success(reg.result.message || (strategy.value === 'mo' ? '내일 시가 매수 예약됨' : '주문 넣었어요'));
        } else {
          toast.error(reg.result.message || '주문이 거절됐어요');
        }
      } else {
        toast.success(strategy.value === 'mo' ? '내일 시가 매수 예약됨' : '주문 넣었어요');
      }
    } else {
      const reg = await api.tradeSell({
        code: code.value,
        qtyMode: sellMode.value,
        qtyValue: sellMode.value === 'shares' ? sellShares.value : undefined,
        execute: true,
      });
      if (reg.result?.ok) toast.success(reg.result.message || '주문 넣었어요');
      else toast.error(reg.result?.message || '주문이 거절됐어요');
    }

    // 주문 상태 즉시 반영 — Orders 화면이 fresh 데이터로 진입
    await ordersStore.refresh();
    loadBalance();
    confirmOpen.value = false;
    router.push('/orders');
  } catch (err) {
    toast.error((err as Error).message);
  } finally {
    submitting.value = false;
  }
}

watch(code, () => {
  loadQuote();
  loadCandles();
  loadWatchStatus();
  loadBalance();
  loadSession();
  closeTickStream();
  openTickStream();
  startPolling();
});
watch(interval, loadCandles);

onMounted(() => {
  loadQuote();
  loadCandles();
  loadWatchStatus();
  loadBalance();
  loadSession();
  openTickStream();
  startPolling();
  document.addEventListener('visibilitychange', onVisibility);
});
onUnmounted(() => {
  stopPolling();
  closeTickStream();
  document.removeEventListener('visibilitychange', onVisibility);
});
</script>

<template>
  <div :class="fullscreen ? 'fixed inset-0 z-30 bg-background overflow-y-auto' : ''">
    <div class="space-y-3" :class="fullscreen ? 'p-4' : ''">
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
        <div v-if="existingHolding" class="mt-3 flex items-center gap-2 rounded-xl bg-primary/8 px-3 py-2 text-[11px]">
          <Info class="h-3.5 w-3.5 shrink-0 text-primary" />
          <span class="text-foreground">
            이미 <span class="font-bold tabular-nums">{{ existingHolding.qty }}주</span> 갖고 있어요 ·
            <span :class="pflsColor(existingHolding.pflsAmt)">{{ fmtPct(existingHolding.pflsRt) }} ({{ fmtSigned(existingHolding.pflsAmt) }}원)</span>
          </span>
        </div>
      </Card>
      <p v-else-if="error" class="text-sm text-destructive">{{ error }}</p>

      <!-- 주문 ↔ 차트 상단 탭 -->
      <div v-if="code && !fullscreen" class="inline-flex w-full rounded-xl bg-muted p-1">
        <button
          class="flex-1 rounded-lg py-2 text-sm font-bold transition"
          :class="view === 'order' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'"
          @click="view = 'order'"
        >주문</button>
        <button
          class="flex-1 rounded-lg py-2 text-sm font-bold transition"
          :class="view === 'chart' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'"
          @click="view = 'chart'"
        >차트</button>
      </div>

      <!-- 차트 (차트 탭 또는 fullscreen) -->
      <Card v-if="code && (view === 'chart' || fullscreen)">
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex gap-1 overflow-x-auto">
              <button
                v-for="i in INTERVALS" :key="i.key"
                class="shrink-0 rounded-md px-2.5 py-1 text-[11px] font-semibold transition"
                :class="i.key === interval ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'"
                @click="interval = i.key"
              >
                {{ i.label }}
              </button>
            </div>
            <button class="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition hover:bg-accent" @click="fullscreen = !fullscreen">
              <template v-if="!fullscreen"><Maximize2 class="h-3.5 w-3.5" /></template>
              <template v-else><Minimize2 class="h-3.5 w-3.5" /><span>닫기</span></template>
            </button>
          </div>
        </template>
        <TradeChart :candles="candles" :height="fullscreen ? 560 : 360" :show-volume="true" :visible-bars="fullscreen ? null : intervalCfg.visible" />
      </Card>

      <!-- 사기 / 팔기 탭 (주문 탭에서만) -->
      <div v-if="code && !fullscreen && view === 'order'" class="inline-flex w-full rounded-xl bg-muted p-1">
        <button
          class="flex-1 rounded-lg py-2 text-sm font-bold transition"
          :class="tab === 'buy' ? 'bg-card text-up shadow-sm' : 'text-muted-foreground'"
          @click="tab = 'buy'"
        >사기</button>
        <button
          class="flex-1 rounded-lg py-2 text-sm font-bold transition"
          :class="tab === 'sell' ? 'bg-card text-down shadow-sm' : 'text-muted-foreground'"
          @click="tab = 'sell'"
        >팔기</button>
      </div>

      <!-- 장 마감/시작 안내 (사기 탭에서만) -->
      <div
        v-if="code && !fullscreen && view === 'order' && tab === 'buy' && marketNotice"
        class="flex items-start gap-2 rounded-2xl bg-amber-500/10 px-4 py-2.5 text-xs leading-relaxed text-amber-900 dark:text-amber-200"
      >
        <Info class="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <span>{{ marketNotice }}</span>
      </div>

      <!-- 전략 카드 (사기 탭만) -->
      <Card v-if="code && !fullscreen && view === 'order' && tab === 'buy'">
        <template #header>
          <h3 class="text-sm font-bold tracking-tight">언제 살까요?</h3>
        </template>
        <div class="grid grid-cols-2 gap-2">
          <button
            class="flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition"
            :class="strategy === 'now' ? 'border-primary bg-primary/5' : 'border-transparent bg-muted/50'"
            @click="strategy = 'now'"
          >
            <Zap class="h-4 w-4" :class="strategy === 'now' ? 'text-primary' : 'text-muted-foreground'" />
            <span class="text-sm font-semibold">지금 사기</span>
            <span class="text-[11px] leading-snug text-muted-foreground">현재 가격으로<br/>곧바로 매수</span>
          </button>
          <button
            class="flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition"
            :class="strategy === 'mo' ? 'border-primary bg-primary/5' : 'border-transparent bg-muted/50'"
            @click="strategy = 'mo'"
          >
            <Calendar class="h-4 w-4" :class="strategy === 'mo' ? 'text-primary' : 'text-muted-foreground'" />
            <span class="text-sm font-semibold">내일 시가에 사기</span>
            <span class="text-[11px] leading-snug text-muted-foreground">다음 거래일<br/>09:00 시작가</span>
          </button>
        </div>
      </Card>

      <!-- MTS split: 호가(좌) + 폼(우) -->
      <div v-if="code && !fullscreen && view === 'order'" class="grid grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] gap-2">
        <!-- 좌: 호가 10단계 (compact) -->
        <section class="rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 p-2">
          <div class="px-1 pb-1.5 text-[10px] font-semibold text-muted-foreground">
            호가 <span class="ml-0.5 font-normal">실시간</span>
          </div>
          <OrderBook :code="code" :interval-ms="1500" :levels="10" compact @pick-price="onAskingPriceClick" />
        </section>

        <!-- 우: 폼 -->
        <section class="flex flex-col gap-3 rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 p-3">
          <!-- 매수 -->
          <template v-if="tab === 'buy'">
            <!-- 1주 가격 -->
            <div>
              <p class="mb-1.5 text-[10px] font-semibold text-muted-foreground">1주 가격</p>
              <!-- 시장가/지정가 토글 (지금 사기일 때만) -->
              <div v-if="strategy === 'now'" class="mb-1.5 inline-flex w-full rounded-md bg-muted/50 p-0.5">
                <button
                  class="flex-1 rounded px-2 py-0.5 text-[10px] font-semibold transition"
                  :class="priceMode === 'market' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'"
                  @click="priceMode = 'market'"
                >시장가</button>
                <button
                  class="flex-1 rounded px-2 py-0.5 text-[10px] font-semibold transition"
                  :class="priceMode === 'limit' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'"
                  @click="priceMode = 'limit'"
                >지정가</button>
              </div>

              <!-- 시장가: read-only 현재가 표시 -->
              <div
                v-if="strategy === 'mo' || priceMode === 'market'"
                class="flex items-baseline justify-between rounded-xl bg-muted/30 px-3 py-2"
              >
                <span class="text-base font-bold tabular-nums">{{ fmtKrw(buyBasePrice) }}</span>
                <span class="text-[10px] text-muted-foreground">{{ strategy === 'mo' ? '내일 시가' : '현재가' }}</span>
              </div>

              <!-- 지정가: 가격 입력 -->
              <template v-else>
                <PriceStepper
                  v-model="limitPrice"
                  :step="stepperStep"
                  :min="0"
                  suffix="원"
                  compact
                />
                <p class="mt-1 text-center text-[10px] text-muted-foreground">← 호가를 눌러 가격을 정할 수 있어요</p>
              </template>
            </div>

            <!-- 사고 싶은 주식 수 -->
            <div>
              <p class="mb-1.5 text-[10px] font-semibold text-muted-foreground">사고 싶은 주식 수</p>
              <PriceStepper v-model="buyQty" :step="1" :min="1" suffix="주" compact />
              <div class="mt-1.5 grid grid-cols-4 gap-1">
                <button
                  v-for="p in [10, 25, 50, 100]" :key="p"
                  class="rounded-md bg-muted/50 py-1.5 text-[10px] font-semibold transition hover:bg-muted"
                  @click="setBuyPercent(p)"
                >
                  {{ p === 100 ? '전부' : `${p}%` }}
                </button>
              </div>
            </div>

            <!-- 총액 요약 -->
            <div class="rounded-xl bg-primary/8 px-3 py-2 tabular-nums">
              <div class="flex items-baseline justify-between">
                <span class="text-[11px] text-muted-foreground">총 매수 금액</span>
                <span class="text-base font-bold">{{ fmtKrw(buyBudget) }}</span>
              </div>
              <div class="mt-1 flex items-baseline justify-between text-[10px] text-muted-foreground">
                <span>매수 가능금액</span>
                <span>{{ fmtKrw(cash) }}</span>
              </div>
            </div>
          </template>

          <!-- 매도 -->
          <template v-else>
            <div v-if="existingHolding" class="rounded-lg bg-muted/30 px-2 py-1.5 text-[11px]">
              <p class="text-muted-foreground">갖고 있어요</p>
              <p class="font-bold tabular-nums">{{ existingHolding.qty }}주</p>
              <p class="mt-0.5 tabular-nums" :class="pflsColor(existingHolding.pflsAmt)">
                {{ fmtPct(existingHolding.pflsRt) }} · {{ fmtSigned(existingHolding.pflsAmt) }}원
              </p>
              <p
                v-if="sellUnsettled > 0"
                class="mt-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] leading-snug text-amber-700 dark:text-amber-300"
              >
                오늘 산 {{ sellUnsettled }}주는 결제 완료 후 팔 수 있어요. 지금은 {{ sellableMax }}주까지만 팔기 가능.
              </p>
            </div>
            <div v-else class="rounded-lg bg-muted/30 px-2 py-2 text-center text-[11px] text-muted-foreground">
              이 종목을 갖고 있지 않아요
            </div>

            <div class="grid grid-cols-3 gap-1">
              <button
                v-for="m in [{k:'all',l:'전부'},{k:'half',l:'반만'},{k:'shares',l:'직접'}]"
                :key="m.k"
                class="rounded-md py-1.5 text-[11px] font-semibold transition"
                :class="sellMode === m.k ? 'bg-primary text-primary-foreground' : 'bg-muted/50 hover:bg-muted'"
                :disabled="!existingHolding || sellableMax <= 0"
                @click="sellMode = m.k as 'all'|'half'|'shares'"
              >
                {{ m.l }}
              </button>
            </div>

            <PriceStepper
              v-if="sellMode === 'shares' && existingHolding"
              v-model="sellShares"
              :step="1"
              :min="0"
              :max="sellableMax"
              suffix="주"
              compact
            />

            <div class="rounded-lg bg-muted/30 px-2 py-1.5 text-center text-[11px] text-muted-foreground tabular-nums">
              <span class="font-bold text-foreground">{{ sellQty }}주</span> · 약 {{ fmtKrw(sellRevenue) }}
            </div>
          </template>
        </section>
      </div>

      <!-- 자동 매도 옵션 (사기 + 지금 사기에서만) — 스위치 ON/OFF -->
      <Card v-if="code && !fullscreen && view === 'order' && tab === 'buy' && strategy === 'now'">
        <template #header>
          <h3 class="text-sm font-bold tracking-tight">자동 매도 설정</h3>
        </template>
        <div class="space-y-3">
          <!-- 목표가 -->
          <div>
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                v-model="tpOn"
                class="peer sr-only"
              />
              <span class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-muted transition peer-checked:bg-primary">
                <span class="inline-block h-4 w-4 transform rounded-full bg-card shadow transition translate-x-0.5 peer-checked:translate-x-[1.125rem]" :class="tpOn ? 'translate-x-[1.125rem]' : 'translate-x-0.5'" />
              </span>
              <span class="flex flex-1 items-center gap-1 text-sm font-medium">
                목표가 도달 시 자동 매도
                <InfoTooltip title="목표가 자동 매도" description="매수한 가격 대비 입력한 % 만큼 오르면 자동으로 매도해요." />
              </span>
            </label>
            <div v-if="tpOn" class="mt-2 flex items-center gap-2">
              <input v-model="tp" type="number" step="0.5" placeholder="5"
                class="flex-1 rounded-lg bg-muted/40 px-3 py-2 text-base font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-primary" />
              <span class="text-sm font-semibold text-up">%</span>
            </div>
          </div>

          <!-- 손해 막기 -->
          <div>
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                v-model="slOn"
                class="peer sr-only"
              />
              <span class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-muted transition peer-checked:bg-primary">
                <span class="inline-block h-4 w-4 transform rounded-full bg-card shadow transition" :class="slOn ? 'translate-x-[1.125rem]' : 'translate-x-0.5'" />
              </span>
              <span class="flex flex-1 items-center gap-1 text-sm font-medium">
                손해 막기 자동 매도
                <InfoTooltip title="손해 막기" description="매수한 가격 대비 입력한 % 만큼 떨어지면 자동으로 매도해요." />
              </span>
            </label>
            <div v-if="slOn" class="mt-2 flex items-center gap-2">
              <input v-model="sl" type="number" step="0.5" placeholder="3"
                class="flex-1 rounded-lg bg-muted/40 px-3 py-2 text-base font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-primary" />
              <span class="text-sm font-semibold text-down">%</span>
            </div>
          </div>
        </div>
      </Card>

      <!-- 사기 / 팔기 버튼 -->
      <Button
        v-if="code && !fullscreen && view === 'order'"
        :variant="tab === 'buy' ? 'primary' : 'destructive'"
        size="lg"
        class="w-full"
        @click="openConfirm"
      >
        <template v-if="tab === 'buy'">사기 ({{ buyQty }}주)</template>
        <template v-else>팔기 ({{ sellQty }}주)</template>
      </Button>

      <!-- 오늘 흐름 -->
      <Card v-if="quote && !fullscreen">
        <template #header><h3 class="text-sm font-bold tracking-tight">오늘 흐름</h3></template>
        <div class="grid grid-cols-2 gap-3 text-sm">
          <div><p class="text-[10px] text-muted-foreground">시작</p><p class="mt-0.5 font-semibold tabular-nums">{{ fmtKrw(quote.open) }}</p></div>
          <div><p class="text-[10px] text-muted-foreground">최고</p><p class="mt-0.5 font-semibold tabular-nums text-up">{{ fmtKrw(quote.high) }}</p></div>
          <div><p class="text-[10px] text-muted-foreground">최저</p><p class="mt-0.5 font-semibold tabular-nums text-down">{{ fmtKrw(quote.low) }}</p></div>
          <div><p class="text-[10px] text-muted-foreground">거래량</p><p class="mt-0.5 font-semibold tabular-nums">{{ fmtNum(quote.volume) }}주</p></div>
        </div>
      </Card>

      <!-- 상세 정보 -->
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
            <span class="text-muted-foreground">PER</span><span class="font-semibold tabular-nums">{{ quote.per }}</span>
          </div>
          <div v-if="quote.pbr" class="flex items-center justify-between">
            <span class="text-muted-foreground">PBR</span><span class="font-semibold tabular-nums">{{ quote.pbr }}</span>
          </div>
          <div v-if="quote.foreignerRatio > 0" class="flex items-center justify-between">
            <span class="text-muted-foreground">외국인 비중</span>
            <span class="font-semibold tabular-nums">{{ quote.foreignerRatio.toFixed(2) }}%</span>
          </div>
        </div>
      </Card>
    </div>

    <!-- 발주 확인 -->
    <Modal :open="confirmOpen" title="확인할게요" @close="confirmOpen = false">
      <div class="space-y-3 text-sm">
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">종목</span>
          <span class="font-semibold">{{ quote?.name }}</span>
        </div>
        <template v-if="tab === 'buy'">
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground">언제</span>
            <span class="font-semibold">{{ strategy === 'now' ? '지금' : '내일 시가' }}</span>
          </div>
          <div v-if="strategy === 'now'" class="flex items-center justify-between">
            <span class="text-muted-foreground">가격</span>
            <span class="font-semibold tabular-nums">
              {{ priceMode === 'limit' && limitPrice > 0 ? `${fmtKrw(limitPrice)} 지정가` : '시장가' }}
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground">수량</span>
            <span class="font-semibold tabular-nums">{{ buyQty }}주 · 약 {{ fmtKrw(buyBudget) }}</span>
          </div>
          <div v-if="strategy === 'now' && ((tpOn && tp) || (slOn && sl))" class="border-t border-border pt-3">
            <p class="text-[11px] text-muted-foreground">자동 매도 설정</p>
            <p class="mt-1 text-xs tabular-nums">
              <span v-if="tpOn && tp" class="text-up">목표가 +{{ tp }}%</span>
              <span v-if="tpOn && tp && slOn && sl"> · </span>
              <span v-if="slOn && sl" class="text-down">손절 {{ sl }}%</span>
            </p>
          </div>
        </template>
        <template v-else>
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground">수량</span>
            <span class="font-semibold tabular-nums">{{ sellQty }}주</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground">받을 예정</span>
            <span class="font-semibold tabular-nums">약 {{ fmtKrw(sellRevenue) }}</span>
          </div>
        </template>
      </div>
      <div class="mt-5 grid grid-cols-2 gap-2">
        <Button variant="secondary" :disabled="submitting" @click="confirmOpen = false">취소</Button>
        <Button
          :variant="tab === 'buy' ? 'primary' : 'destructive'"
          :disabled="submitting"
          @click="submit"
        >
          {{ submitting ? '주문 중…' : (tab === 'buy' ? '주문 넣기' : '팔기') }}
        </Button>
      </div>
    </Modal>
  </div>
</template>
