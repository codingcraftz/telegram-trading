<script setup lang="ts">
// 주문 — KIS MTS 주문 화면 스타일.
// 진입 즉시 마지막 본 종목 자동 선택. 상단 검색바로 종목 전환.
// 좌:호가 / 우:매매 폼 (지정가/시장가, 가격±, 수량±, TP/SL, 발주).

import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';
import { Search, Clock, X, NotebookPen, Plus } from 'lucide-vue-next';
import OrderBook from '@/components/OrderBook.vue';
import PriceStepper from '@/components/PriceStepper.vue';
import BottomSheet from '@/components/ui/BottomSheet.vue';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import OrdersView from './Orders.vue';
import { api, type SearchItem, type QuoteResponse, type BalanceResponse, type StrategyItem } from '@/api/client';
import { fmtKrw, fmtPct, pflsColor } from '@/lib/format';
import { useOrdersStore } from '@/stores/orders';
import { useWatchlistStore } from '@/stores/watchlist';
import { toast } from '@/lib/toast';

const route = useRoute();
const router = useRouter();
const ordersStore = useOrdersStore();
const watchlist = useWatchlistStore();

// 상단 탭 — '주문' (매수/매도 폼) / '내역' (대기+체결 통합)
type Tab = 'order' | 'history';
const tab = ref<Tab>(((route.query.tab as string) === 'history' ? 'history' : 'order'));
watch(tab, (v) => {
  if (route.query.tab === v) return;
  router.replace({ query: { ...route.query, tab: v } });
});
watch(() => route.query.tab, (v) => {
  const next: Tab = v === 'history' ? 'history' : 'order';
  if (tab.value !== next) tab.value = next;
});

// 차트/주문/잔고에서 마지막 본 종목 공유 — StockDetail.vue 와 같은 key.
const LAST_KEY = 'owlim:last-code';
const LEGACY_KEYS = ['owlim:last-trade-code', 'owlim:last-chart-code'];
const DEFAULT_CODE = '005930'; // 삼성전자 — 아무것도 없을 때 fallback

const code = computed(() => (route.query.code as string) ?? '');
const hasCode = computed(() => /^\d{6}$/.test(code.value));

function pickStock(c: string) {
  router.replace({ query: { ...route.query, code: c } });
}

// 페이지 진입 시 종목 자동 선택 — 마지막 본 거 > 보유 > 관심 > 디폴트
const balance = ref<BalanceResponse | null>(null);
async function loadBalance() {
  try { balance.value = await api.balance(); } catch {}
}

function pickAutoCode(): string {
  try {
    const candidates = [localStorage.getItem(LAST_KEY), ...LEGACY_KEYS.map((k) => localStorage.getItem(k))];
    for (const c of candidates) {
      if (c && /^\d{6}$/.test(c)) return c;
    }
  } catch {}
  const firstHold = balance.value?.holdings[0]?.code;
  if (firstHold && /^\d{6}$/.test(firstHold)) return firstHold;
  const firstWatch = watchlist.items[0]?.code;
  if (firstWatch && /^\d{6}$/.test(firstWatch)) return firstWatch;
  return DEFAULT_CODE;
}

// ============== 검색 (시트로 분리) ==============
const searchOpen = ref(false);
const searchQ = ref('');
const searchResults = ref<SearchItem[]>([]);
let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(searchQ, (v) => {
  if (searchTimer) clearTimeout(searchTimer);
  const trimmed = v.trim();
  if (!trimmed) { searchResults.value = []; return; }
  searchTimer = setTimeout(async () => {
    try {
      const r = await api.search(trimmed);
      searchResults.value = r.items.slice(0, 12);
    } catch { searchResults.value = []; }
  }, 200);
});

function openSearch() {
  searchOpen.value = true;
  searchQ.value = '';
  searchResults.value = [];
}
function closeSearch() {
  searchOpen.value = false;
}
function chooseSearchResult(s: SearchItem) {
  pickStock(s.code);
  closeSearch();
}

// ============== 종목 quote ==============
const quote = ref<QuoteResponse | null>(null);
async function loadQuote() {
  if (!hasCode.value) { quote.value = null; return; }
  try { quote.value = await api.quote(code.value); } catch { quote.value = null; }
}
let quoteTimer: ReturnType<typeof setInterval> | null = null;

watch(code, (c) => {
  if (c && /^\d{6}$/.test(c)) {
    try { localStorage.setItem(LAST_KEY, c); } catch {}
  }
  loadQuote();
  if (quoteTimer) clearInterval(quoteTimer);
  if (hasCode.value) quoteTimer = setInterval(loadQuote, 5000);
}, { immediate: true });

// ============== 매매 폼 ==============
const side = ref<'buy' | 'sell'>((route.query.side as string) === 'sell' ? 'sell' : 'buy');
watch(() => route.query.side, (v) => {
  if (v === 'sell' || v === 'buy') side.value = v;
});

const priceMode = ref<'limit' | 'market'>('limit'); // KIS 처럼 지정가 기본
const limitPrice = ref<number>(0);
const qty = ref<number>(0);
const tpEnabled = ref(false);
const tpPct = ref<number>(3);
const slEnabled = ref(false);
const slPct = ref<number>(3);
const submitting = ref(false);

watch(quote, (q) => {
  if (q && (limitPrice.value === 0 || limitPrice.value < 1)) limitPrice.value = q.price;
});
watch(code, () => { qty.value = 0; });

// 가격 호가 단위 — KRX 표준 (10원 미만 1원, 1만 미만 5원, …). 단순화: 가격대별 step.
const priceStep = computed(() => {
  const p = limitPrice.value || quote.value?.price || 0;
  if (p < 2000) return 1;
  if (p < 5000) return 5;
  if (p < 20_000) return 10;
  if (p < 50_000) return 50;
  if (p < 200_000) return 100;
  if (p < 500_000) return 500;
  return 1000;
});

function onPickPrice(p: number) {
  priceMode.value = 'limit';
  limitPrice.value = p;
}

const holding = computed(() =>
  balance.value?.holdings.find((h) => h.code === code.value) ?? null,
);

const maxQty = computed(() => {
  if (side.value === 'sell') return holding.value?.orderable ?? 0;
  if (!quote.value || !balance.value) return 0;
  const p = priceMode.value === 'limit' ? limitPrice.value : quote.value.price;
  return p > 0 ? Math.floor((balance.value.cash || 0) / p) : 0;
});

const canSubmit = computed(() => {
  if (!hasCode.value || !quote.value) return false;
  if (qty.value <= 0) return false;
  if (priceMode.value === 'limit' && limitPrice.value <= 0) return false;
  if (side.value === 'sell' && qty.value > (holding.value?.orderable ?? 0)) return false;
  return !submitting.value;
});

function setPct(p: number) {
  const m = maxQty.value;
  if (m <= 0) return;
  qty.value = Math.max(1, Math.floor((m * p) / 100));
}

// ============== 전략 ==============
const strategies = ref<StrategyItem[]>([]);
const strategiesLoaded = ref(false);
async function loadStrategies() {
  try {
    const r = await api.strategies();
    strategies.value = r.items.filter((s) => s.active);
  } catch { strategies.value = []; }
  finally { strategiesLoaded.value = true; }
}

// 매수 폼 안 "전략 적용" 옵션 — immediate 모드 전략만 노출.
// 매수 발주 직후 그 체결로 application 생성 → 봇이 TP/SL/물타기 감시.
const immediateStrategies = computed(() =>
  strategies.value.filter((s) =>
    s.definition.entry.type === 'morning_staged' &&
    (s.definition.entry.triggerMode ?? 'morning') === 'immediate',
  ),
);
const morningStrategies = computed(() =>
  strategies.value.filter((s) => {
    if (s.definition.entry.type !== 'morning_staged') return true;
    return (s.definition.entry.triggerMode ?? 'morning') === 'morning';
  }),
);
const selectedImmediateStrategyId = ref<string>('');
const selectedImmediateStrategy = computed(() =>
  immediateStrategies.value.find((s) => s.id === selectedImmediateStrategyId.value) ?? null,
);
// 전략 적용 시 자금 입력 시트
const strategyApplying = ref(false);
const strategySheetOpen = ref(false);
const strategySheetTarget = ref<StrategyItem | null>(null);
const strategyBudget = ref<number>(1_000_000); // default 100만원

function openApplyStrategy(s: StrategyItem) {
  if (!hasCode.value) return;
  strategySheetTarget.value = s;
  strategyBudget.value = Math.min(balance.value?.cash ?? 1_000_000, 1_000_000);
  strategySheetOpen.value = true;
}
function closeApplyStrategy() {
  strategySheetOpen.value = false;
  strategySheetTarget.value = null;
}
async function confirmApplyStrategy() {
  const s = strategySheetTarget.value;
  if (!s || strategyApplying.value || !hasCode.value || !quote.value) return;
  if (strategyBudget.value < 1000) {
    toast.error('자금은 1,000원 이상');
    return;
  }
  const isImmediate =
    s.definition.entry.type === 'morning_staged' &&
    (s.definition.entry.triggerMode ?? 'morning') === 'immediate';
  strategyApplying.value = true;
  try {
    if (isImmediate) {
      // 일반 전략 — 즉시 시장가 매수 + 매수가 1차로 인식되어 감시 시작.
      const price = quote.value.price;
      const buyQty = Math.floor(strategyBudget.value / price);
      if (buyQty < 1) {
        toast.error('자금이 부족합니다.');
        return;
      }
      const r = await api.tradeBuy({
        code: code.value,
        strategy: 'now',
        amount: { mode: 'shares', value: buyQty },
        tp: null, sl: null, limitPrice: null, execute: true,
      });
      if (!(r.result?.ok ?? true)) {
        toast.error(r.result?.message || '매수 거절');
        return;
      }
      await api.applyStrategy(s.id, {
        stockCode: code.value,
        stage1Snapshot: { qty: buyQty, avgPrice: Math.round(price) },
      });
      toast.success(`'${s.name}' 매수 + 감시 시작`);
    } else {
      // 시가매매 — applyStrategy 만. 다음 영업일 09:00 자동 발동.
      await api.applyStrategy(s.id, {
        stockCode: code.value,
        budgetAmount: Math.floor(strategyBudget.value),
      });
      toast.success(`'${s.name}' 전략이 적용되었습니다`);
    }
    closeApplyStrategy();
  } catch (err) {
    const msg = (err as Error).message;
    if (/already_applied/i.test(msg)) toast.info('이미 적용된 전략이에요');
    else toast.error(msg);
  } finally { strategyApplying.value = false; }
}

async function submit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  try {
    if (side.value === 'buy') {
      const r = await api.tradeBuy({
        code: code.value,
        strategy: 'now',
        amount: { mode: 'shares', value: qty.value },
        tp: tpEnabled.value && tpPct.value > 0 ? tpPct.value : null,
        sl: slEnabled.value && slPct.value > 0 ? slPct.value : null,
        limitPrice: priceMode.value === 'limit' && limitPrice.value > 0 ? limitPrice.value : null,
        execute: true,
      });
      if (r.result?.ok ?? true) {
        toast.success('매수 주문이 접수되었습니다');
        qty.value = 0;
      } else {
        toast.error(r.result?.message || '매수 거절');
      }
    } else {
      const r = await api.tradeSell({
        code: code.value,
        qtyMode: 'shares',
        qtyValue: qty.value,
        execute: true,
      });
      if (r.result?.ok ?? true) {
        toast.success('매도 주문이 접수되었습니다');
        qty.value = 0;
      } else {
        toast.error(r.result?.message || '매도 거절');
      }
    }
    await loadBalance();
  } catch (err) {
    toast.error((err as Error).message);
  } finally { submitting.value = false; }
}

// 주문금액 (수량 × 가격)
const orderAmount = computed(() => {
  const p = priceMode.value === 'limit' ? limitPrice.value : (quote.value?.price ?? 0);
  return p > 0 && qty.value > 0 ? p * qty.value : 0;
});

onMounted(async () => {
  await loadBalance();
  loadStrategies();
  ordersStore.subscribe(8000);
  watchlist.subscribe();
  // URL ?code 없으면 마지막 본 종목 / 보유 / 관심 / 디폴트로 자동 진입
  if (!hasCode.value) {
    await nextTick();
    const auto = pickAutoCode();
    if (auto) pickStock(auto);
  }
});
onUnmounted(() => {
  if (quoteTimer) clearInterval(quoteTimer);
  ordersStore.unsubscribe();
  watchlist.unsubscribe();
});
</script>

<template>
  <!-- pt-2: 상단 NavBar 와 헤더 사이 여백. overscroll-behavior: contain 으로
       pull-to-refresh 같은 outer 드래그만 차단 (input 키보드 시 viewport 스크롤은 유지). -->
  <div
    class="space-y-3 pt-2"
    style="overscroll-behavior: contain;"
  >
    <!-- 상단 탭 — 주문 / 내역 -->
    <SegmentedControl
      v-model="tab"
      :options="[
        { value: 'order' as const, label: '주문' },
        { value: 'history' as const, label: ordersStore.count > 0 ? `내역 ${ordersStore.count}` : '내역' },
      ]"
    />

    <!-- 내역 탭 — 대기+체결 통합 -->
    <OrdersView v-if="tab === 'history'" :embedded="true" />

    <!-- 주문 탭 — 매수/매도 폼 -->
    <template v-else>
    <!-- 종목 헤더 + 돋보기 + 대기 N 배지 (대기/전략 통합 진입) -->
    <div v-if="quote" class="flex items-center gap-2 px-1">
      <div class="min-w-0">
        <div class="flex items-center gap-1.5">
          <p class="truncate text-base font-bold tracking-tight">{{ quote.name }}</p>
          <button
            class="rounded p-1 text-muted-foreground transition hover:bg-accent"
            aria-label="종목 검색"
            @click="openSearch"
          >
            <Search class="h-4 w-4" />
          </button>
          <RouterLink
            v-if="ordersStore.count > 0"
            to="/orders"
            class="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary transition hover:bg-primary/25"
            aria-label="대기 주문 보기"
          >
            <Clock class="h-3 w-3" />
            대기 {{ ordersStore.count }}
          </RouterLink>
        </div>
        <p class="text-[10px] text-muted-foreground tabular-nums">{{ code }}</p>
      </div>
      <div class="ml-auto text-right">
        <p class="text-base font-bold tabular-nums leading-tight" :class="pflsColor(quote.change)">
          {{ fmtKrw(quote.price) }}
        </p>
        <p class="text-[10px] font-semibold tabular-nums leading-tight" :class="pflsColor(quote.change)">
          {{ quote.signLabel }} {{ Math.abs(quote.change).toLocaleString() }} ({{ fmtPct(quote.changeRate) }})
        </p>
      </div>
    </div>

    <!-- 2-col: 좌 호가 / 우 매매 폼 -->
    <div v-if="hasCode" class="grid grid-cols-[5fr_6fr] gap-3">
      <!-- 좌: 호가 (잔량 합계 숨김) -->
      <div class="rounded-xl bg-card ring-1 ring-border/60 dark:ring-0 p-2">
        <OrderBook
          :code="code"
          :levels="5"
          :interval-ms="1500"
          :hide-totals="true"
          @pick-price="onPickPrice"
        />
      </div>

      <!-- 우: 매수/매도 폼 -->
      <div class="rounded-xl bg-card ring-1 ring-border/60 dark:ring-0 p-3 space-y-3">
        <!-- 매수/매도 토글 -->
        <div class="inline-flex w-full rounded-lg bg-muted p-0.5">
          <button
            type="button"
            class="flex-1 rounded-md py-1.5 text-xs font-bold transition"
            :class="side === 'buy' ? 'bg-up text-white shadow' : 'text-muted-foreground'"
            @click="side = 'buy'"
          >매수</button>
          <button
            type="button"
            class="flex-1 rounded-md py-1.5 text-xs font-bold transition"
            :class="side === 'sell' ? 'bg-down text-white shadow' : 'text-muted-foreground'"
            @click="side = 'sell'"
          >매도</button>
        </div>

        <!-- 가격 모드 -->
        <div class="inline-flex w-full rounded-lg bg-muted/60 p-0.5">
          <button
            type="button"
            class="flex-1 rounded-md py-1 text-[10px] font-semibold transition"
            :class="priceMode === 'limit' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'"
            @click="priceMode = 'limit'"
          >지정가</button>
          <button
            type="button"
            class="flex-1 rounded-md py-1 text-[10px] font-semibold transition"
            :class="priceMode === 'market' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'"
            @click="priceMode = 'market'"
          >시장가</button>
        </div>

        <!-- 가격 ± -->
        <div v-if="priceMode === 'limit'">
          <PriceStepper v-model="limitPrice" :step="priceStep" :min="0" suffix="원" compact />
        </div>
        <div v-else class="rounded-md bg-muted/30 px-2 py-2 text-center text-[10px] text-muted-foreground">
          {{ quote ? fmtKrw(quote.price) + '원' : '...' }} 즉시 체결
        </div>

        <!-- 수량 ± -->
        <div>
          <div class="flex items-center justify-between">
            <span class="text-[10px] text-muted-foreground">수량</span>
            <span class="text-[10px] text-muted-foreground tabular-nums">최대 {{ maxQty }}주</span>
          </div>
          <PriceStepper v-model="qty" :step="1" :min="0" :max="maxQty" suffix="주" compact />
          <div class="mt-1.5 grid grid-cols-4 gap-1">
            <button
              v-for="p in [25, 50, 75, 100]" :key="p"
              type="button"
              class="rounded bg-muted/50 py-1 text-[10px] font-semibold transition hover:bg-muted"
              @click="setPct(p)"
            >{{ p === 100 ? '전부' : `${p}%` }}</button>
          </div>
        </div>

        <!-- 주문금액 -->
        <div class="flex items-center justify-between rounded-md bg-muted/40 px-2.5 py-2 text-[11px]">
          <span class="text-muted-foreground">주문금액</span>
          <span class="font-bold tabular-nums">{{ orderAmount > 0 ? fmtKrw(orderAmount) + '원' : '—' }}</span>
        </div>

        <!-- 일반 전략은 매수 폼 아래 별도 섹션으로 분리됨. -->

        <!-- TP / SL — 한 줄 가로 배치 (매수만) -->
        <div v-if="side === 'buy'" class="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-2.5 py-2 text-xs">
          <!-- TP -->
          <div class="flex items-center gap-1.5">
            <button
              type="button"
              class="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition"
              :class="tpEnabled ? 'bg-up' : 'bg-muted-foreground/30'"
              @click="tpEnabled = !tpEnabled"
            >
              <span
                class="inline-block h-3 w-3 transform rounded-full bg-white shadow transition"
                :style="{ transform: tpEnabled ? 'translateX(14px)' : 'translateX(2px)' }"
              />
            </button>
            <span class="font-bold text-up">TP</span>
            <span class="flex items-center text-muted-foreground">
              +<input v-model.number="tpPct" type="number" min="0.1" max="100" step="0.1"
                :disabled="!tpEnabled"
                class="w-9 rounded border border-border bg-card px-1 py-0.5 text-right text-xs tabular-nums disabled:opacity-40" />%
            </span>
          </div>
          <!-- SL -->
          <div class="flex items-center gap-1.5">
            <button
              type="button"
              class="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition"
              :class="slEnabled ? 'bg-down' : 'bg-muted-foreground/30'"
              @click="slEnabled = !slEnabled"
            >
              <span
                class="inline-block h-3 w-3 transform rounded-full bg-white shadow transition"
                :style="{ transform: slEnabled ? 'translateX(14px)' : 'translateX(2px)' }"
              />
            </button>
            <span class="font-bold text-down">SL</span>
            <span class="flex items-center text-muted-foreground">
              -<input v-model.number="slPct" type="number" min="0.1" max="100" step="0.1"
                :disabled="!slEnabled"
                class="w-9 rounded border border-border bg-card px-1 py-0.5 text-right text-xs tabular-nums disabled:opacity-40" />%
            </span>
          </div>
        </div>

        <!-- 발주 버튼 -->
        <button
          type="button"
          :disabled="!canSubmit"
          :class="[
            'w-full rounded-lg py-2.5 text-sm font-bold text-white transition disabled:opacity-40',
            side === 'buy' ? 'bg-up' : 'bg-down',
          ]"
          @click="submit"
        >
          {{ submitting ? '발주 중…' : (side === 'buy' ? '매수 주문' : '매도 주문') }}
        </button>
      </div>
    </div>

    <!-- 시가매매 전략 — 다음 영업일 09:00 자동 매수 + 감시 -->
    <section v-if="hasCode && strategiesLoaded && morningStrategies.length > 0" class="space-y-2">
      <div class="flex items-center gap-1.5 px-1">
        <NotebookPen class="h-3.5 w-3.5 text-primary" />
        <h3 class="text-xs font-bold tracking-tight">시가매매 전략</h3>
      </div>
      <div class="space-y-1.5">
        <button
          v-for="s in morningStrategies" :key="s.id"
          type="button"
          :disabled="strategyApplying"
          class="flex w-full items-center justify-between gap-2 rounded-xl bg-card ring-1 ring-border/60 dark:ring-0 px-3 py-2.5 text-left transition active:scale-[0.99] disabled:opacity-50"
          @click="openApplyStrategy(s)"
        >
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold">{{ s.name }}</p>
            <p class="mt-0.5 text-[10px] text-muted-foreground">다음 영업일 09:00 시가 매수</p>
          </div>
          <span class="shrink-0 text-[11px] font-semibold text-primary">적용 ›</span>
        </button>
      </div>
    </section>

    <!-- 일반 전략 — 지금 즉시 시장가 매수 + 감시 시작 -->
    <section v-if="hasCode && strategiesLoaded && immediateStrategies.length > 0" class="space-y-2">
      <div class="flex items-center gap-1.5 px-1">
        <NotebookPen class="h-3.5 w-3.5 text-primary" />
        <h3 class="text-xs font-bold tracking-tight">일반 전략</h3>
      </div>
      <div class="space-y-1.5">
        <button
          v-for="s in immediateStrategies" :key="s.id"
          type="button"
          :disabled="strategyApplying"
          class="flex w-full items-center justify-between gap-2 rounded-xl bg-card ring-1 ring-border/60 dark:ring-0 px-3 py-2.5 text-left transition active:scale-[0.99] disabled:opacity-50"
          @click="openApplyStrategy(s)"
        >
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold">{{ s.name }}</p>
            <p class="mt-0.5 text-[10px] text-muted-foreground">지금 즉시 시장가 매수 + 감시</p>
          </div>
          <span class="shrink-0 text-[11px] font-semibold text-primary">적용 ›</span>
        </button>
      </div>
    </section>

    <!-- 전략 빈 상태 안내 -->
    <RouterLink
      v-if="hasCode && strategiesLoaded && morningStrategies.length === 0 && immediateStrategies.length === 0"
      to="/more/strategy/new"
      class="flex items-center gap-2 rounded-xl border border-dashed border-border bg-card/50 px-3 py-3 text-xs transition hover:bg-card"
    >
      <Plus class="h-3.5 w-3.5 text-muted-foreground" />
      <span class="flex-1 text-muted-foreground">저장된 전략이 없습니다.</span>
      <span class="font-semibold">전략 추가 ›</span>
    </RouterLink>

    </template>
    <!-- ↑ '주문' 탭 콘텐츠 끝 -->

    <!-- 전략 적용 — 자금 입력 시트 -->
    <BottomSheet
      :open="strategySheetOpen"
      :title="strategySheetTarget?.name ?? '전략 적용'"
      @close="closeApplyStrategy"
    >
      <div class="space-y-4">
        <p class="text-xs text-muted-foreground">
          <b class="text-foreground">{{ quote?.name ?? code }}</b> 에 적용할 자금을 입력해주세요.
        </p>
        <div>
          <label class="mb-1 block text-[11px] font-semibold text-muted-foreground">자금 (원)</label>
          <PriceStepper v-model="strategyBudget" :step="100_000" :min="1000" suffix="원" />
          <!-- 매수가능금액 (예수금) 비율 빠른 버튼 -->
          <div class="mt-1.5 grid grid-cols-4 gap-1">
            <button
              v-for="p in [25, 50, 75, 100]" :key="p"
              type="button"
              :disabled="!balance || balance.cash <= 0"
              class="rounded bg-muted/50 py-1.5 text-[10px] font-semibold transition hover:bg-muted disabled:opacity-40"
              @click="strategyBudget = Math.max(1000, Math.floor((balance!.cash * p) / 100))"
            >{{ p === 100 ? '전부' : `${p}%` }}</button>
          </div>
          <p v-if="balance" class="mt-1.5 text-[10px] text-muted-foreground tabular-nums">
            매수가능 {{ fmtKrw(balance.cash) }}원
          </p>
        </div>
        <button
          type="button"
          :disabled="strategyApplying || strategyBudget < 1000"
          class="w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground transition active:scale-[0.98] disabled:opacity-40"
          @click="confirmApplyStrategy"
        >
          {{ strategyApplying ? '적용 중…' : '전략 적용' }}
        </button>
      </div>
    </BottomSheet>

    <!-- 종목 검색 시트 -->
    <BottomSheet :open="searchOpen" title="종목 검색" @close="closeSearch">
      <div class="space-y-3">
        <div class="relative">
          <Search class="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            v-model="searchQ"
            type="text"
            placeholder="종목명 또는 6자리 코드"
            autofocus
            class="w-full rounded-xl bg-muted py-2.5 pl-9 pr-9 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            v-if="searchQ"
            class="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent"
            @click="searchQ = ''"
          >
            <X class="h-3.5 w-3.5" />
          </button>
        </div>
        <div v-if="searchResults.length > 0" class="max-h-[55vh] space-y-1 overflow-y-auto">
          <button
            v-for="r in searchResults" :key="r.code"
            class="flex w-full items-center justify-between rounded-xl bg-card ring-1 ring-border/60 dark:ring-0 px-3 py-2.5 text-left transition active:scale-[0.99]"
            @click="chooseSearchResult(r)"
          >
            <span class="text-sm font-semibold">{{ r.name }}</span>
            <span class="text-[11px] text-muted-foreground tabular-nums">{{ r.code }}</span>
          </button>
        </div>
        <p v-else-if="searchQ.trim()" class="py-6 text-center text-xs text-muted-foreground">
          검색 결과가 없어요
        </p>
      </div>
    </BottomSheet>
  </div>
</template>
