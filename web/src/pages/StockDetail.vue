<script setup lang="ts">
// 종목 상세 (차트) — 차트 + 호가 + 정보 + 보유 안내. 매매는 /trade 페이지로 분리.
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Info } from 'lucide-vue-next';

import StockDetailHeader from '@/components/stock/StockDetailHeader.vue';
import ChartPanel from '@/components/stock/ChartPanel.vue';
import StockInfoPanel from '@/components/stock/StockInfoPanel.vue';

import { api, type Holding, type TickSnapshot } from '@/api/client';
import { fmtPct, fmtSigned, pflsColor } from '@/lib/format';
import { useWatchlistStore } from '@/stores/watchlist';
import { usePrefs } from '@/stores/prefs';
import { useStockQuote } from '@/composables/useStockQuote';
import { useTickStream } from '@/composables/useTickStream';

const route = useRoute();
const router = useRouter();
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
const holdings = ref<Holding[]>(cached?.holdings ?? []);
const existingHolding = computed<Holding | null>(
  () => holdings.value.find((h) => h.code === code.value) ?? null,
);

async function loadBalance() {
  try {
    const b = await api.balance();
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

// 차트 탭 빠른 진입용 — 마지막 본 종목 저장
watch(code, (c) => {
  if (c && /^\d{6}$/.test(c)) {
    try { localStorage.setItem('owlim:last-chart-code', c); } catch {}
  }
  loadBalance();
}, { immediate: true });

function goTrade(side?: 'buy' | 'sell') {
  if (!code.value) return;
  const query: Record<string, string> = { code: code.value };
  if (side) query.side = side;
  router.push({ path: '/trade', query });
}

onMounted(() => {
  watchlist.subscribe();
});
onUnmounted(() => watchlist.unsubscribe());
</script>

<template>
  <div>
  <!-- pb-32: 하단 sticky 매매 버튼바 + BottomNav 가리지 않도록 충분한 여백 -->
  <div class="space-y-3 pb-32">
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
        보유 <span class="font-bold tabular-nums">{{ existingHolding.qty }}주</span> ·
        평균 <span class="font-semibold tabular-nums">{{ existingHolding.avg.toLocaleString() }}원</span> ·
        <span :class="pflsColor(existingHolding.pflsAmt)">{{ fmtPct(existingHolding.pflsRt) }} ({{ fmtSigned(existingHolding.pflsAmt) }}원)</span>
      </span>
    </div>

    <ChartPanel v-if="code" ref="chartPanelRef" :code="code" :height="320" />

    <StockInfoPanel v-if="isAdvanced && quote" :quote="quote" />
  </div>

  <!-- 하단 sticky 매수/매도 액션바 — BottomNav(56px) 바로 위에 고정.
       스크롤해도 따라다니고, 누르면 /trade 의 해당 사이드로 진입. -->
  <div
    v-if="code"
    class="fixed inset-x-0 z-10 mx-auto max-w-md border-t border-border bg-background/95 px-4 py-2 backdrop-blur"
    style="bottom: calc(env(safe-area-inset-bottom) + 56px);"
  >
    <div class="grid grid-cols-2 gap-2">
      <button
        type="button"
        class="rounded-xl bg-up py-3 text-sm font-bold text-white shadow-sm transition active:scale-[0.98]"
        @click="goTrade('buy')"
      >매수</button>
      <button
        type="button"
        class="rounded-xl bg-down py-3 text-sm font-bold text-white shadow-sm transition active:scale-[0.98]"
        @click="goTrade('sell')"
      >매도</button>
    </div>
  </div>
  </div>
</template>
