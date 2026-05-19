<script setup lang="ts">
// 종목 상세 — sticky 헤더 + 차트 + 호가 + (정보) + sticky bottom 매매 + BuyForm/SellForm 시트.
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Info } from 'lucide-vue-next';

import StockDetailHeader from '@/components/stock/StockDetailHeader.vue';
import ChartPanel from '@/components/stock/ChartPanel.vue';
import OrderBookPanel from '@/components/stock/OrderBookPanel.vue';
import StockInfoPanel from '@/components/stock/StockInfoPanel.vue';
import OrderActions from '@/components/stock/OrderActions.vue';
import BuyForm from '@/components/stock/BuyForm.vue';
import SellForm from '@/components/stock/SellForm.vue';

import { api, type Holding, type TickSnapshot } from '@/api/client';
import { fmtPct, fmtSigned, pflsColor } from '@/lib/format';
import { useOrdersStore } from '@/stores/orders';
import { useWatchlistStore } from '@/stores/watchlist';
import { usePrefs } from '@/stores/prefs';
import { useStockQuote } from '@/composables/useStockQuote';
import { useTickStream } from '@/composables/useTickStream';

const route = useRoute();
const router = useRouter();
const ordersStore = useOrdersStore();
const watchlist = useWatchlistStore();
const prefs = usePrefs();

const code = computed(() => (route.params.code as string) ?? '');
const isAdvanced = computed(() => prefs.mode === 'advanced');

const { quote, isLive: tickStreamLive, loading: quoteLoading, refresh: refreshQuote } = useStockQuote(code);

const chartPanelRef = ref<InstanceType<typeof ChartPanel> | null>(null);
useTickStream(code, (snap: TickSnapshot) => {
  if (snap.code !== code.value) return;
  chartPanelRef.value?.patchLast({ price: snap.price, cumVolume: snap.cumVolume });
});

// SWR — Home/Stocks와 같은 캐시 키 공유
const BALANCE_CACHE_KEY = 'owlim:balance-cache:v1';
function loadBalanceCache() {
  try {
    const raw = localStorage.getItem(BALANCE_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { cash: number; holdings: Holding[] };
  } catch { return null; }
}
const cached = loadBalanceCache();
const cash = ref<number>(cached?.cash ?? 0);
const holdings = ref<Holding[]>(cached?.holdings ?? []);
const existingHolding = computed<Holding | null>(
  () => holdings.value.find((h) => h.code === code.value) ?? null,
);
const holdingQty = computed(() => existingHolding.value?.qty ?? 0);
const orderableQty = computed(() => existingHolding.value?.orderable ?? 0);
const canSell = computed(() => holdingQty.value > 0);

async function loadBalance() {
  try {
    const b = await api.balance();
    cash.value = b.cash;
    holdings.value = b.holdings;
    try { localStorage.setItem(BALANCE_CACHE_KEY, JSON.stringify(b)); } catch {}
  } catch {}
}

const isWatched = computed(() => watchlist.has(code.value));
async function toggleWatch() {
  if (!code.value) return;
  if (isWatched.value) await watchlist.removeByCode(code.value);
  else await watchlist.add(code.value);
}

// 시트
const buyOpen = ref(false);
const sellOpen = ref(false);
const initialPrice = ref<number>(0);
const initialPriceMode = ref<'market' | 'limit'>('market');

// 시트 열기는 push (브라우저 뒤로가기로 시트만 닫힘)
// 시트 닫기는 router.back() — push로 쌓은 entry를 되돌림.
// 단, ?tab=buy/sell로 직접 진입한 경우는 history entry가 없으므로 replace로 처리.
function openBuySheet(opts?: { price?: number; mode?: 'market' | 'limit' }) {
  initialPriceMode.value = opts?.mode ?? 'market';
  initialPrice.value = opts?.price ?? quote.value?.price ?? 0;
  sellOpen.value = false;
  buyOpen.value = true;
  if (route.query.tab === 'buy') return; // 이미 ?tab=buy면 stack 안 쌓음
  router.push({ query: { ...route.query, tab: 'buy' } });
}
function openSellSheet() {
  if (!canSell.value) return;
  buyOpen.value = false;
  sellOpen.value = true;
  if (route.query.tab === 'sell') return;
  router.push({ query: { ...route.query, tab: 'sell' } });
}
function closeSheet() {
  buyOpen.value = false;
  sellOpen.value = false;
  if (!route.query.tab) return; // 이미 ?tab 없으면 noop
  // 가능하면 history.back으로 push entry 되돌림. 첫 진입(직접 ?tab=…)이면 replace로 fallback.
  if (window.history.length > 1) {
    router.back();
  } else {
    const { tab: _omit, ...rest } = route.query;
    void _omit;
    router.replace({ query: rest });
  }
}

// 호가 셀 탭 → 매수 시트 + 지정가 + 가격
function onPriceSelect(price: number) {
  openBuySheet({ price, mode: 'limit' });
}

function onTradeSuccess() {
  // 시트 즉시 닫기 — KIS 응답 대기 안 함
  closeSheet();
  // 백그라운드로 갱신 (fire-and-forget)
  ordersStore.refresh();
  loadBalance();
}

// URL 동기화
watch(() => route.query.tab, (v) => {
  if (v === 'buy') {
    if (!buyOpen.value) {
      initialPriceMode.value = 'market';
      initialPrice.value = quote.value?.price ?? 0;
      buyOpen.value = true; sellOpen.value = false;
    }
  } else if (v === 'sell') {
    if (!sellOpen.value && canSell.value) {
      sellOpen.value = true; buyOpen.value = false;
    }
  } else {
    buyOpen.value = false; sellOpen.value = false;
  }
}, { immediate: true });

watch(code, () => loadBalance());

onMounted(() => {
  loadBalance();          // 보유/현금 즉시
  watchlist.subscribe();  // 백그라운드 — 관심 토글에만 영향
});
onUnmounted(() => watchlist.unsubscribe());
</script>

<template>
  <div class="space-y-3 pb-28">
    <StockDetailHeader
      v-if="code"
      :code="code"
      :name="quote?.name ?? code"
      :price="quote?.price ?? 0"
      :change-amount="quote?.change ?? 0"
      :change-pct="quote?.changeRate ?? 0"
      :is-watched="isWatched"
      :is-stream-live="tickStreamLive"
      :loading="quoteLoading"
      @back="router.back()"
      @toggle-watch="toggleWatch"
      @refresh="refreshQuote"
    />

    <!-- 보유 안내 -->
    <div
      v-if="existingHolding"
      class="flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2 text-[11px]"
    >
      <Info class="h-3.5 w-3.5 shrink-0 text-primary" />
      <span class="text-foreground">
        이미 <span class="font-bold tabular-nums">{{ existingHolding.qty }}주</span> 갖고 있어요 ·
        <span :class="pflsColor(existingHolding.pflsAmt)">{{ fmtPct(existingHolding.pflsRt) }} ({{ fmtSigned(existingHolding.pflsAmt) }}원)</span>
      </span>
    </div>

    <ChartPanel v-if="code" ref="chartPanelRef" :code="code" :height="300" />

    <OrderBookPanel v-if="code" :code="code" @pick-price="onPriceSelect" />

    <StockInfoPanel v-if="isAdvanced && quote" :quote="quote" />

    <OrderActions
      v-if="code"
      :can-sell="canSell"
      @buy="openBuySheet()"
      @sell="openSellSheet"
    />

    <BuyForm
      :open="buyOpen"
      :code="code"
      :name="quote?.name ?? code"
      :current-price="quote?.price ?? 0"
      :available-cash="cash"
      :initial-price="initialPrice"
      :initial-price-mode="initialPriceMode"
      @close="closeSheet"
      @success="onTradeSuccess"
    />

    <SellForm
      :open="sellOpen"
      :code="code"
      :name="quote?.name ?? code"
      :current-price="quote?.price ?? 0"
      :holding-qty="holdingQty"
      :orderable-qty="orderableQty"
      @close="closeSheet"
      @success="onTradeSuccess"
    />
  </div>
</template>
