<script setup lang="ts">
// 주문 — KIS MTS 스타일 통합 매매 화면.
//   URL ?code 없음: 종목 선택 진입 (검색 + 최근 조회 + 보유 종목 + 대기 요약)
//   URL ?code 있음: 좌:호가 미니 / 우:매수·매도 인라인 폼

import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';
import { History, Briefcase, Clock, ListOrdered, ChevronLeft } from 'lucide-vue-next';
import StockSearchBar from '@/components/stock/StockSearchBar.vue';
import OrderBook from '@/components/OrderBook.vue';
import { api, type SearchItem, type QuoteResponse, type BalanceResponse } from '@/api/client';
import { fmtKrw, fmtPct, pflsColor } from '@/lib/format';
import { useOrdersStore } from '@/stores/orders';
import { toast } from '@/lib/toast';

const route = useRoute();
const router = useRouter();
const ordersStore = useOrdersStore();

const code = computed(() => (route.query.code as string) ?? '');
const hasCode = computed(() => /^\d{6}$/.test(code.value));

function pickStock(c: string) {
  router.replace({ query: { ...route.query, code: c } });
}
function clearStock() {
  const next = { ...route.query };
  delete next.code;
  router.replace({ query: next });
}

// ============== 종목 선택 진입 화면 ==============
// 키 분리 — Stocks 의 'owlim:recent-search' 는 검색어 string array. 여기는 종목 객체.
const RECENT_KEY = 'owlim:recent-stocks';
const recent = ref<{ code: string; name: string }[]>(loadRecent());
function loadRecent(): { code: string; name: string }[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, 10) : [];
  } catch { return []; }
}
function pushRecent(c: string, n: string) {
  const next = [{ code: c, name: n }, ...recent.value.filter((r) => r.code !== c)].slice(0, 10);
  recent.value = next;
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
}

// 검색
const q = ref('');
const searchResults = ref<SearchItem[]>([]);
let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(q, (v) => {
  if (searchTimer) clearTimeout(searchTimer);
  const trimmed = v.trim();
  if (!trimmed) { searchResults.value = []; return; }
  searchTimer = setTimeout(async () => {
    try {
      const r = await api.search(trimmed);
      searchResults.value = r.items.slice(0, 8);
    } catch { searchResults.value = []; }
  }, 250);
});

// 보유 종목
const balance = ref<BalanceResponse | null>(null);
async function loadBalance() {
  try { balance.value = await api.balance(); } catch {}
}

// ============== 종목 선택 후 매매 화면 ==============
const quote = ref<QuoteResponse | null>(null);
async function loadQuote() {
  if (!hasCode.value) { quote.value = null; return; }
  try {
    const q = await api.quote(code.value);
    quote.value = q;
    pushRecent(code.value, q.name);
  } catch { quote.value = null; }
}
let quoteTimer: ReturnType<typeof setInterval> | null = null;
watch(code, () => {
  loadQuote();
  if (quoteTimer) clearInterval(quoteTimer);
  if (hasCode.value) quoteTimer = setInterval(loadQuote, 5000);
}, { immediate: true });

// 폼 상태 — URL ?side= 로 초기 결정 (관심 페이지의 매수/매도 버튼이 전달).
const side = ref<'buy' | 'sell'>((route.query.side as string) === 'sell' ? 'sell' : 'buy');
watch(() => route.query.side, (v) => {
  if (v === 'sell' || v === 'buy') side.value = v;
});
const priceMode = ref<'limit' | 'market'>('market');
const limitPrice = ref<number>(0);
const qty = ref<number>(0);
const tpEnabled = ref(false);
const tpPct = ref<number>(3);
const slEnabled = ref(false);
const slPct = ref<number>(3);
const submitting = ref(false);

watch(quote, (q) => {
  if (q && limitPrice.value === 0) limitPrice.value = q.price;
});
watch(code, () => { qty.value = 0; });

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

onMounted(() => {
  loadBalance();
  ordersStore.subscribe(8000);
});
onUnmounted(() => {
  if (quoteTimer) clearInterval(quoteTimer);
  ordersStore.unsubscribe();
});
</script>

<template>
  <div class="space-y-3">
    <!-- ────────── 종목 선택 진입 화면 ────────── -->
    <template v-if="!hasCode">
      <div class="flex items-center justify-between px-1">
        <h2 class="text-lg font-bold tracking-tight">주문</h2>
        <RouterLink
          to="/orders"
          class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
        >
          <ListOrdered class="h-3.5 w-3.5" />
          대기/체결 <span v-if="ordersStore.count > 0" class="font-bold">({{ ordersStore.count }})</span>
        </RouterLink>
      </div>

      <!-- 검색 -->
      <StockSearchBar v-model="q" placeholder="종목명 또는 6자리 코드 검색" />

      <div v-if="searchResults.length > 0" class="space-y-1">
        <button
          v-for="s in searchResults" :key="s.code"
          class="flex w-full items-center justify-between rounded-xl bg-card ring-1 ring-border/60 dark:ring-0 px-3 py-2.5 text-left transition active:scale-[0.99]"
          @click="pickStock(s.code)"
        >
          <span class="text-sm font-semibold">{{ s.name }}</span>
          <span class="text-[11px] text-muted-foreground tabular-nums">{{ s.code }}</span>
        </button>
      </div>

      <!-- 최근 조회 -->
      <section v-if="!q && recent.length > 0">
        <div class="mb-2 flex items-center gap-1.5 px-1">
          <History class="h-3.5 w-3.5 text-muted-foreground" />
          <h3 class="text-xs font-bold tracking-tight text-muted-foreground">최근 조회</h3>
        </div>
        <div class="space-y-1.5">
          <button
            v-for="r in recent" :key="r.code"
            class="flex w-full items-center justify-between rounded-xl bg-card ring-1 ring-border/60 dark:ring-0 px-3 py-2.5 text-left transition active:scale-[0.99]"
            @click="pickStock(r.code)"
          >
            <span class="text-sm font-semibold">{{ r.name }}</span>
            <span class="text-[11px] text-muted-foreground tabular-nums">{{ r.code }}</span>
          </button>
        </div>
      </section>

      <!-- 보유 종목 -->
      <section v-if="!q && balance && balance.holdings.length > 0">
        <div class="mb-2 flex items-center gap-1.5 px-1">
          <Briefcase class="h-3.5 w-3.5 text-muted-foreground" />
          <h3 class="text-xs font-bold tracking-tight text-muted-foreground">보유 종목</h3>
        </div>
        <div class="space-y-1.5">
          <button
            v-for="h in balance.holdings" :key="h.code"
            class="flex w-full items-center justify-between rounded-xl bg-card ring-1 ring-border/60 dark:ring-0 px-3 py-2.5 text-left transition active:scale-[0.99]"
            @click="pickStock(h.code)"
          >
            <div class="min-w-0">
              <p class="text-sm font-semibold">{{ h.name }}</p>
              <p class="text-[10px] text-muted-foreground tabular-nums">{{ h.qty }}주 보유 · {{ fmtKrw(h.cur) }}원</p>
            </div>
            <p class="text-[11px] font-semibold tabular-nums" :class="pflsColor(h.pflsRt)">
              {{ fmtPct(h.pflsRt) }}
            </p>
          </button>
        </div>
      </section>

      <!-- 거래 대기 요약 -->
      <RouterLink
        v-if="ordersStore.count > 0"
        to="/orders"
        class="flex items-center gap-3 rounded-xl bg-primary/10 px-3 py-2.5 transition active:scale-[0.99]"
      >
        <Clock class="h-4 w-4 text-primary" />
        <span class="text-sm font-semibold flex-1">거래 대기 {{ ordersStore.count }}건</span>
        <span class="text-[11px] text-muted-foreground">보기 ›</span>
      </RouterLink>
    </template>

    <!-- ────────── 종목 선택 후 KIS 2-col ────────── -->
    <template v-else>
      <!-- 헤더 -->
      <div class="flex items-center justify-between gap-2 px-1">
        <button class="flex items-center gap-1 text-left -ml-1" @click="clearStock">
          <ChevronLeft class="h-4 w-4 text-muted-foreground" />
          <div>
            <p class="text-base font-bold tracking-tight leading-tight">
              {{ quote?.name ?? code }}
            </p>
            <p class="text-[10px] text-muted-foreground tabular-nums">{{ code }}</p>
          </div>
        </button>
        <div v-if="quote" class="text-right">
          <p class="text-base font-bold tabular-nums leading-tight" :class="pflsColor(quote.change)">
            {{ fmtKrw(quote.price) }}
          </p>
          <p class="text-[10px] font-semibold tabular-nums" :class="pflsColor(quote.change)">
            {{ quote.signLabel }} {{ Math.abs(quote.change).toLocaleString() }} ({{ fmtPct(quote.changeRate) }})
          </p>
        </div>
      </div>

      <!-- 2-col: 좌 호가 / 우 매매 폼 -->
      <div class="grid grid-cols-[5fr_6fr] gap-2">
        <!-- 좌: 호가 미니 -->
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

          <!-- 가격 -->
          <div v-if="priceMode === 'limit'">
            <label class="text-[9px] text-muted-foreground">가격</label>
            <input
              v-model.number="limitPrice"
              type="number"
              class="mt-0.5 w-full rounded-md border border-border bg-muted/30 px-2 py-1.5 text-right text-sm font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p class="mt-0.5 text-center text-[9px] text-muted-foreground">호가 누르면 자동 입력</p>
          </div>
          <div v-else class="rounded-md bg-muted/30 px-2 py-2 text-center text-[10px] text-muted-foreground">
            {{ quote ? fmtKrw(quote.price) + '원' : '...' }} 즉시 체결
          </div>

          <!-- 수량 -->
          <div>
            <div class="flex items-center justify-between">
              <label class="text-[9px] text-muted-foreground">수량</label>
              <span class="text-[9px] text-muted-foreground tabular-nums">최대 {{ maxQty }}</span>
            </div>
            <input
              v-model.number="qty"
              type="number"
              min="1"
              :max="maxQty"
              class="mt-0.5 w-full rounded-md border border-border bg-muted/30 px-2 py-1.5 text-right text-sm font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
            />
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
            {{ submitting ? '발주 중…' : (side === 'buy' ? '🚀 매수 주문' : '📤 매도 주문') }}
          </button>
        </div>
      </div>

      <!-- 대기 주문 요약 -->
      <RouterLink
        v-if="ordersStore.count > 0"
        to="/orders"
        class="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-xs"
      >
        <Clock class="h-3.5 w-3.5 text-primary" />
        <span class="flex-1 font-semibold">대기 주문 {{ ordersStore.count }}건</span>
        <span class="text-muted-foreground">›</span>
      </RouterLink>
    </template>
  </div>
</template>
