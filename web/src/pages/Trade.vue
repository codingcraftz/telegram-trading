<script setup lang="ts">
// 주문 — KIS MTS 주문 화면 스타일.
// 진입 즉시 마지막 본 종목 자동 선택. 상단 검색바로 종목 전환.
// 좌:호가 / 우:매매 폼 (지정가/시장가, 가격±, 수량±, TP/SL, 발주).

import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';
import { Search, Clock, X } from 'lucide-vue-next';
import OrderBook from '@/components/OrderBook.vue';
import PriceStepper from '@/components/PriceStepper.vue';
import { api, type SearchItem, type QuoteResponse, type BalanceResponse } from '@/api/client';
import { fmtKrw, fmtPct, pflsColor } from '@/lib/format';
import { useOrdersStore } from '@/stores/orders';
import { useWatchlistStore } from '@/stores/watchlist';
import { toast } from '@/lib/toast';

const route = useRoute();
const router = useRouter();
const ordersStore = useOrdersStore();
const watchlist = useWatchlistStore();

const LAST_KEY = 'owlim:last-trade-code';
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
    const last = localStorage.getItem(LAST_KEY);
    if (last && /^\d{6}$/.test(last)) return last;
  } catch {}
  const firstHold = balance.value?.holdings[0]?.code;
  if (firstHold && /^\d{6}$/.test(firstHold)) return firstHold;
  const firstWatch = watchlist.items[0]?.code;
  if (firstWatch && /^\d{6}$/.test(firstWatch)) return firstWatch;
  return DEFAULT_CODE;
}

// ============== 검색 ==============
const searchQ = ref('');
const searchFocused = ref(false);
const searchResults = ref<SearchItem[]>([]);
let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(searchQ, (v) => {
  if (searchTimer) clearTimeout(searchTimer);
  const trimmed = v.trim();
  if (!trimmed) { searchResults.value = []; return; }
  searchTimer = setTimeout(async () => {
    try {
      const r = await api.search(trimmed);
      searchResults.value = r.items.slice(0, 6);
    } catch { searchResults.value = []; }
  }, 200);
});

function chooseSearchResult(s: SearchItem) {
  pickStock(s.code);
  searchQ.value = '';
  searchResults.value = [];
  searchFocused.value = false;
}

// blur 시 결과 클릭 처리할 시간 확보 후 닫기
function onSearchBlur() {
  setTimeout(() => { searchFocused.value = false; }, 150);
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

onMounted(async () => {
  await loadBalance();
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
  <div class="space-y-2">
    <!-- 상단 검색바 + 종목 헤더 -->
    <div class="space-y-1.5">
      <div class="relative">
        <Search class="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          v-model="searchQ"
          type="text"
          placeholder="종목명 또는 6자리 코드"
          class="w-full rounded-xl bg-muted py-2 pl-9 pr-9 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          @focus="searchFocused = true"
          @blur="onSearchBlur"
        />
        <button
          v-if="searchQ"
          class="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent"
          @click="searchQ = ''"
        >
          <X class="h-3.5 w-3.5" />
        </button>

        <!-- 검색 결과 드롭다운 -->
        <div
          v-if="searchFocused && searchResults.length > 0"
          class="absolute inset-x-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-card shadow-lg"
        >
          <button
            v-for="r in searchResults" :key="r.code"
            class="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition hover:bg-accent"
            @mousedown.prevent="chooseSearchResult(r)"
          >
            <span class="font-semibold">{{ r.name }}</span>
            <span class="text-[11px] text-muted-foreground tabular-nums">{{ r.code }}</span>
          </button>
        </div>
      </div>

      <!-- 종목 헤더 -->
      <div v-if="quote" class="flex items-baseline gap-2 px-1">
        <p class="text-base font-bold tracking-tight">{{ quote.name }}</p>
        <p class="text-[10px] text-muted-foreground tabular-nums">{{ code }}</p>
        <div class="ml-auto text-right">
          <p class="text-base font-bold tabular-nums leading-tight" :class="pflsColor(quote.change)">
            {{ fmtKrw(quote.price) }}
          </p>
          <p class="text-[10px] font-semibold tabular-nums leading-tight" :class="pflsColor(quote.change)">
            {{ quote.signLabel }} {{ Math.abs(quote.change).toLocaleString() }} ({{ fmtPct(quote.changeRate) }})
          </p>
        </div>
      </div>
    </div>

    <!-- 2-col: 좌 호가 / 우 매매 폼 -->
    <div v-if="hasCode" class="grid grid-cols-[5fr_6fr] gap-2">
      <!-- 좌: 호가 -->
      <div class="rounded-xl bg-card ring-1 ring-border/60 dark:ring-0 p-2">
        <OrderBook
          :code="code"
          :levels="5"
          :interval-ms="1500"
          @pick-price="onPickPrice"
        />
      </div>

      <!-- 우: 매수/매도 폼 -->
      <div class="rounded-xl bg-card ring-1 ring-border/60 dark:ring-0 p-2.5 space-y-2.5">
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
          <p class="mt-1 text-center text-[9px] text-muted-foreground">호가 누르면 자동 입력</p>
        </div>
        <div v-else class="rounded-md bg-muted/30 px-2 py-2 text-center text-[10px] text-muted-foreground">
          {{ quote ? fmtKrw(quote.price) + '원' : '...' }} 즉시 체결
        </div>

        <!-- 수량 ± -->
        <div>
          <div class="flex items-center justify-between">
            <span class="text-[9px] text-muted-foreground">수량</span>
            <span class="text-[9px] text-muted-foreground tabular-nums">최대 {{ maxQty }}주</span>
          </div>
          <PriceStepper v-model="qty" :step="1" :min="0" :max="maxQty" suffix="주" compact />
          <div class="mt-1 grid grid-cols-4 gap-1">
            <button
              v-for="p in [25, 50, 75, 100]" :key="p"
              type="button"
              class="rounded bg-muted/50 py-1 text-[9px] font-semibold transition hover:bg-muted"
              @click="setPct(p)"
            >{{ p === 100 ? '전부' : `${p}%` }}</button>
          </div>
        </div>

        <!-- TP/SL (매수만) -->
        <div v-if="side === 'buy'" class="space-y-1 rounded-md bg-muted/30 p-2 text-[10px]">
          <label class="flex items-center gap-1.5">
            <input v-model="tpEnabled" type="checkbox" class="rounded">
            <span class="flex-1">익절</span>
            <span class="flex items-center gap-0.5">
              +<input v-model.number="tpPct" type="number" min="0.1" max="100" step="0.1"
                class="w-12 rounded border border-border bg-card px-1 py-0.5 text-right tabular-nums" />%
            </span>
          </label>
          <label class="flex items-center gap-1.5">
            <input v-model="slEnabled" type="checkbox" class="rounded">
            <span class="flex-1">손절</span>
            <span class="flex items-center gap-0.5">
              -<input v-model.number="slPct" type="number" min="0.1" max="100" step="0.1"
                class="w-12 rounded border border-border bg-card px-1 py-0.5 text-right tabular-nums" />%
            </span>
          </label>
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

    <!-- 대기 주문 진입 링크 -->
    <RouterLink
      v-if="ordersStore.count > 0"
      to="/orders"
      class="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-xs"
    >
      <Clock class="h-3.5 w-3.5 text-primary" />
      <span class="flex-1 font-semibold">대기 주문 {{ ordersStore.count }}건</span>
      <span class="text-muted-foreground">›</span>
    </RouterLink>
  </div>
</template>
