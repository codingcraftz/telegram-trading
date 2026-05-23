<script setup lang="ts">
// 종목 상세 (차트) — 차트 + 호가 + 정보 + 보유 안내. 매매는 /trade 페이지로 분리.
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Info, Loader2 } from 'lucide-vue-next';

import StockDetailHeader from '@/components/stock/StockDetailHeader.vue';
import ChartPanel from '@/components/stock/ChartPanel.vue';
import Modal from '@/components/ui/Modal.vue';

import { api, type Holding, type TickSnapshot } from '@/api/client';
import { fmtKrw } from '@/lib/format';
import { fmtPct, fmtSigned, pflsColor } from '@/lib/format';
import { useWatchlistStore } from '@/stores/watchlist';
import { useStockQuote } from '@/composables/useStockQuote';
import { useTickStream } from '@/composables/useTickStream';

const route = useRoute();
const router = useRouter();
const watchlist = useWatchlistStore();
const code = computed(() => (route.params.code as string) ?? '');

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
    // 차트/주문/잔고에서 마지막 본 종목 — 단일 키로 통합 (Trade.vue 와 공유).
    try { localStorage.setItem('owlim:last-code', c); } catch {}
    // 호환: 옛 키도 같이 갱신
    try { localStorage.setItem('owlim:last-chart-code', c); } catch {}
  }
  loadBalance();
}, { immediate: true });

// 종목 정보 모달
const stockInfoOpen = ref(false);
const stockInfoData = ref<{ industry: string; per: string; pbr: string; summary: string } | null>(null);
const stockInfoLoading = ref(false);

async function openStockInfo() {
  stockInfoOpen.value = true;
  stockInfoLoading.value = true;
  try {
    const r = await api.quote(code.value);
    stockInfoData.value = { industry: r.industry || '—', per: r.per ?? '—', pbr: r.pbr ?? '—', summary: '' };
    try {
      const res = await fetch(`/api/stock-info?code=${code.value}`);
      const d = await res.json();
      if (d.description) stockInfoData.value.summary = d.description;
    } catch { /* silent */ }
  } catch { /* silent */ }
  finally { stockInfoLoading.value = false; }
}

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
      @info="openStockInfo"
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

    <!-- 차트 + 거래량 (별도 패널, 시간축 동기화). 화면이 viewport 안에 fit 되도록 height 절제. -->
    <ChartPanel v-if="code" ref="chartPanelRef" :code="code" :height="240" />
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

  <!-- 종목 정보 모달 -->
  <Modal :open="stockInfoOpen" :title="`${quote?.name ?? code} (${code})`">
    <div class="space-y-3 py-1">
      <div v-if="stockInfoLoading" class="flex items-center justify-center py-8">
        <Loader2 class="h-6 w-6 animate-spin text-primary" />
      </div>
      <template v-else-if="stockInfoData">
        <div class="space-y-1.5 rounded-lg bg-muted/40 px-3 py-2.5 text-sm">
          <div class="flex justify-between">
            <span class="text-muted-foreground">업종</span>
            <span class="font-semibold">{{ stockInfoData.industry }}</span>
          </div>
        </div>
        <div v-if="stockInfoData.summary" class="rounded-lg bg-muted/40 px-3 py-2.5">
          <p class="text-[11px] font-semibold text-muted-foreground mb-1">기업개요</p>
          <p class="text-sm leading-relaxed">{{ stockInfoData.summary }}</p>
        </div>
      </template>
      <button
        type="button"
        class="w-full rounded-lg bg-muted py-2.5 text-sm font-semibold transition active:scale-[0.98]"
        @click="stockInfoOpen = false"
      >닫기</button>
    </div>
  </Modal>
  </div>
</template>
