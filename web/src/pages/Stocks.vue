<script setup lang="ts">
// 종목 — 탐색 허브. 검색 + [관심 | 순위].
// 보유 종목은 홈에 흡수됨 (여기 X).
// 옛 톤(rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0) 유지.

import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Star, Trash2, ArrowUpRight, ArrowDownRight, Check, RefreshCw, Inbox } from 'lucide-vue-next';
import EmptyState from '@/components/EmptyState.vue';
import SectionHeader from '@/components/SectionHeader.vue';
import Button from '@/components/ui/Button.vue';
import Modal from '@/components/ui/Modal.vue';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import StockSearchBar from '@/components/stock/StockSearchBar.vue';
import QuickTradeSheet from '@/components/stock/QuickTradeSheet.vue';
import LoadingState from '@/components/ui/LoadingState.vue';
import BottomSheet from '@/components/ui/BottomSheet.vue';
import { useInfiniteScroll } from '@/composables/useInfiniteScroll';
import {
  api,
  type SearchItem,
  type QuotesItem,
  type RankingCategory,
  type RankingItem,
  type BalanceResponse,
  type Holding,
  type ThemeItem,
  type ThemeStock,
} from '@/api/client';
import { fmtKrw, fmtPct, fmtSigned, pflsColor } from '@/lib/format';
import { useWatchlistStore } from '@/stores/watchlist';
import { toast } from '@/lib/toast';

const route = useRoute();
const router = useRouter();
const watchlist = useWatchlistStore();

// ===== 검색 =====
const RECENT_KEY = 'owlim:recent-search';
const q = ref<string>((route.query.q as string) ?? '');
const searchFocused = ref(false);
const searchBarRef = ref<{ focus: () => void } | null>(null);

const searchResults = ref<SearchItem[]>([]);
const searchQuotes = ref<Map<string, QuotesItem>>(new Map());
const searching = ref(false);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

const searchActive = computed(() => q.value.trim().length > 0);
const recent = ref<string[]>(loadRecent());

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // 이전 버전이 객체 {code, name} 를 같은 key 에 섞어놓은 경우 가드.
    // 문자열만 통과시키고 객체는 name 만 추출. 기타 타입 무시.
    const out: string[] = [];
    for (const x of arr) {
      if (typeof x === 'string' && x.trim()) out.push(x);
      else if (x && typeof x === 'object' && typeof (x as { name?: unknown }).name === 'string') {
        out.push((x as { name: string }).name);
      }
      if (out.length >= 5) break;
    }
    return out;
  } catch { return []; }
}
function saveRecent(item: string) {
  const next = [item, ...recent.value.filter((x) => x !== item)].slice(0, 5);
  recent.value = next;
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
}
function clearRecent() {
  recent.value = [];
  try { localStorage.removeItem(RECENT_KEY); } catch {}
}

async function runSearch() {
  const v = q.value.trim();
  if (!v) {
    searchResults.value = [];
    searchQuotes.value = new Map();
    return;
  }
  if (/^\d{6}$/.test(v)) {
    searchResults.value = [{ code: v, name: '' }];
    fetchSearchQuotes([v]);
    return;
  }
  searching.value = true;
  try {
    const r = await api.search(v);
    searchResults.value = r.items;
    if (r.items.length > 0) fetchSearchQuotes(r.items.map((it) => it.code));
    else searchQuotes.value = new Map();
  } catch {} finally { searching.value = false; }
}
async function fetchSearchQuotes(codes: string[]) {
  try {
    const r = await api.quotes(codes);
    const m = new Map<string, QuotesItem>();
    for (const x of r.items) m.set(x.code, x);
    searchQuotes.value = m;
  } catch {}
}

// 검색어 변경 → URL 동기화 + 디바운스 fetch
watch(q, (v) => {
  if (v.trim()) router.replace({ query: { ...route.query, q: v } });
  else {
    const { q: _omit, ...rest } = route.query;
    void _omit;
    router.replace({ query: rest });
  }
  if (searchTimer) clearTimeout(searchTimer);
  if (!v.trim()) {
    searchResults.value = [];
    searchQuotes.value = new Map();
    return;
  }
  searchTimer = setTimeout(runSearch, 200);
});

// 외부 변화 (글로벌 검색바 → router.push) → 동기화
watch(() => route.query.q, (newQ) => {
  const v = (newQ as string) ?? '';
  if (v !== q.value) q.value = v;
});

// ===== 세그먼트 =====
// 보유는 잔고 탭으로, 매매는 주문 탭으로 분리됨 → [관심 | 순위 | 테마주] 3개만.
type Seg = 'holding' | 'watch' | 'rank' | 'theme';
function parseSeg(v: unknown): Seg {
  if (v === 'rank') return 'rank';
  if (v === 'theme') return 'theme';
  return 'watch';
}
const seg = ref<Seg>(parseSeg(route.query.seg));
watch(seg, (v) => {
  if (route.query.seg === v) return;
  router.replace({ query: { ...route.query, seg: v } });
});
watch(() => route.query.seg, (v) => {
  const next = parseSeg(v);
  if (seg.value !== next) seg.value = next;
});

// ===== 보유 정보 (SWR — Home.vue와 같은 캐시 키 공유) =====
const BALANCE_CACHE_KEY = 'owlim:balance-cache:v1';
function loadBalanceCache(): BalanceResponse | null {
  try {
    const raw = localStorage.getItem(BALANCE_CACHE_KEY);
    return raw ? (JSON.parse(raw) as BalanceResponse) : null;
  } catch { return null; }
}
const balance = ref<BalanceResponse | null>(loadBalanceCache());
async function loadBalance() {
  try {
    const b = await api.balance();
    balance.value = b;
    try { localStorage.setItem(BALANCE_CACHE_KEY, JSON.stringify(b)); } catch {}
  } catch {}
}
function holdingFor(code: string): Holding | undefined {
  return balance.value?.holdings.find((h) => h.code === code);
}
function isHolding(code: string): boolean {
  return (holdingFor(code)?.qty ?? 0) > 0;
}
const holdings = computed<Holding[]>(() => {
  const all = balance.value?.holdings ?? [];
  return [...all].sort((a, b) => b.cur * b.qty - a.cur * a.qty);
});

// 보유 무한스크롤 (20건씩)
const {
  visibleItems: visibleHoldings,
  sentinelRef: holdingSentinel,
  hasMore: holdingHasMore,
} = useInfiniteScroll(holdings, 20);

// ===== Segmented 옵션 — 관심 / 순위 / 테마주 =====
const segOptions = computed(() => [
  { value: 'watch' as const, label: `관심${watchlist.count ? ` ${watchlist.count}` : ''}` },
  { value: 'rank' as const, label: '순위' },
  { value: 'theme' as const, label: '테마주' },
]);

// ===== 순위 =====
const rankCategory = ref<RankingCategory>(
  (['volume', 'change_up', 'change_down', 'qty'] as RankingCategory[]).includes(route.query.rank as RankingCategory)
    ? (route.query.rank as RankingCategory)
    : 'volume',
);
const rankItems = ref<RankingItem[]>([]);
const rankLoading = ref(false);
const rankLoadedAt = ref<number | null>(null);

async function loadRanking() {
  rankLoading.value = true;
  try {
    const r = await api.ranking(rankCategory.value);
    rankItems.value = r.items;
    rankLoadedAt.value = Date.now();
  } catch (err) { toast.error((err as Error).message); }
  finally { rankLoading.value = false; }
}
watch(rankCategory, (v) => {
  router.replace({ query: { ...route.query, rank: v } });
  if (seg.value === 'rank') loadRanking();
});
watch(seg, (v) => {
  if (v === 'rank' && rankItems.value.length === 0) loadRanking();
  if (v === 'theme' && themes.value.length === 0) loadThemes();
});

// ===== 테마주 (네이버 finance) =====
const themes = ref<ThemeItem[]>([]);
const themesLoading = ref(false);
const selectedTheme = ref<ThemeItem | null>(null);
const themeStocks = ref<ThemeStock[]>([]);
const themeStocksLoading = ref(false);

async function loadThemes() {
  themesLoading.value = true;
  try {
    const r = await api.themes(30);
    themes.value = r.items;
  } catch (err) { toast.error((err as Error).message); }
  finally { themesLoading.value = false; }
}

// ===== 관심 검색 (watchlist 내부 필터링) =====
const watchQ = ref('');
const filteredWatchlist = computed(() => {
  const list = watchlist.items;
  const q = watchQ.value.trim().toLowerCase();
  if (!q) return list;
  return list.filter((it) =>
    it.name.toLowerCase().includes(q) || it.code.includes(q),
  );
});

// ===== 테마 검색 (종목명 → 속한 테마) =====
const themeQ = ref('');
const themeSearchLoading = ref(false);
type ThemeMatch = ThemeItem & { matchedStocks: ThemeStock[] };
const themeSearchResults = ref<ThemeMatch[]>([]);
let themeSearchTimer: ReturnType<typeof setTimeout> | null = null;
watch(themeQ, (v) => {
  if (themeSearchTimer) clearTimeout(themeSearchTimer);
  const trimmed = v.trim();
  if (!trimmed) { themeSearchResults.value = []; return; }
  themeSearchTimer = setTimeout(async () => {
    themeSearchLoading.value = true;
    try {
      const r = await api.themeSearch(trimmed);
      themeSearchResults.value = r.items;
    } catch (err) { toast.error((err as Error).message); }
    finally { themeSearchLoading.value = false; }
  }, 350);
});

async function openTheme(t: ThemeItem) {
  selectedTheme.value = t;
  themeStocks.value = [];
  themeStocksLoading.value = true;
  try {
    const r = await api.themeDetail(t.no);
    themeStocks.value = r.items;
  } catch (err) { toast.error((err as Error).message); }
  finally { themeStocksLoading.value = false; }
}
function closeTheme() {
  selectedTheme.value = null;
  themeStocks.value = [];
}

// 사용자 요청: 거래대금 / 상승률 / 거래량 — 하락률 제거.
const rankCategories: { value: RankingCategory; label: string }[] = [
  { value: 'volume', label: '거래대금' },
  { value: 'change_up', label: '상승률' },
  { value: 'qty', label: '거래량' },
];

const rankUpdatedText = computed(() => {
  if (!rankLoadedAt.value) return '';
  return new Date(rankLoadedAt.value).toLocaleTimeString('ko-KR', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
});

// ===== Quick trade sheet =====
type QuickTrade = {
  open: boolean;
  code: string;
  name: string;
  side: 'buy' | 'sell';
  currentPrice: number;
  holdingQty: number;
  sellableQty: number;
};
const quick = ref<QuickTrade>({
  open: false, code: '', name: '', side: 'buy',
  currentPrice: 0, holdingQty: 0, sellableQty: 0,
});

function openQuick(code: string, name: string, side: 'buy' | 'sell', price: number) {
  const h = holdingFor(code);
  quick.value = {
    open: true, code, name, side, currentPrice: price,
    holdingQty: h?.qty ?? 0,
    sellableQty: h?.orderable ?? 0,
  };
}
function closeQuick() { quick.value.open = false; }

// 관심 카드의 매수/매도 → 통합 /trade 페이지로 이동
function goTrade(code: string, side: 'buy' | 'sell') {
  router.push({ path: '/trade', query: { code, side } });
}

// ===== 관심 편집 모드 =====
const editing = ref(false);
const selectedIds = ref<Set<number>>(new Set());
const removeOpen = ref(false);
const selectedCount = computed(() => selectedIds.value.size);

function toggleEditing() {
  editing.value = !editing.value;
  selectedIds.value.clear();
}
function toggleSelect(id: number) {
  if (selectedIds.value.has(id)) selectedIds.value.delete(id);
  else selectedIds.value.add(id);
  selectedIds.value = new Set(selectedIds.value);
}
async function confirmRemove() {
  removeOpen.value = false;
  const ids = Array.from(selectedIds.value);
  await watchlist.removeByIds(ids);
  selectedIds.value.clear();
  editing.value = false;
}

// 관심 토글 — 검색 결과/관심 카드 공용
async function toggleWatch(code: string) {
  if (watchlist.has(code)) await watchlist.removeByCode(code);
  else await watchlist.add(code);
}

// ===== 카드 동선 헬퍼 =====
function go(code: string) {
  if (editing.value) return;
  if (searchActive.value && q.value.trim()) saveRecent(q.value.trim());
  router.push(`/stocks/${code}`);
}

// 길게 누름 (관심 카드)
const pressTimers = new Map<number | string, ReturnType<typeof setTimeout>>();
function onPressDown(key: number | string, code: string, name: string, price: number) {
  clearPress(key);
  const t = setTimeout(() => {
    const side = isHolding(code) ? 'sell' : 'buy';
    openQuick(code, name, side, price);
    pressTimers.delete(key);
  }, 500);
  pressTimers.set(key, t);
}
function clearPress(key: number | string) {
  const t = pressTimers.get(key);
  if (t) { clearTimeout(t); pressTimers.delete(key); }
}
function onPressUp(key: number | string, code: string) {
  if (pressTimers.has(key)) {
    clearPress(key);
    if (editing.value && typeof key === 'number') toggleSelect(key);
    else go(code);
  }
}

// ===== 라이프사이클 =====
onMounted(async () => {
  // balance 먼저 즉시 시작 — 보유 세그먼트가 이 데이터 기다림.
  // watchlist는 백그라운드. 관심 세그먼트만 의존.
  loadBalance();
  watchlist.subscribe();
  // ?focus=1 처리
  if (route.query.focus === '1') {
    await nextTick();
    searchBarRef.value?.focus();
    const { focus: _o, ...rest } = route.query;
    void _o;
    router.replace({ query: rest });
  }
  if (q.value.trim()) runSearch();
  if (seg.value === 'rank') loadRanking();
});
onUnmounted(() => {
  watchlist.unsubscribe();
  if (searchTimer) clearTimeout(searchTimer);
});
</script>

<template>
  <div class="space-y-4">
    <div class="px-1">
      <h2 class="text-lg font-bold tracking-tight">종목</h2>
    </div>

    <SegmentedControl v-model="seg" :options="segOptions" />

    <!-- 사용자 요청: 페이지 상단 글로벌 검색바 제거.
         관심 탭은 watchlist 안 검색, 테마 탭은 종목→테마 매칭 검색.
         순위 탭은 검색바 없음. 검색바는 각 탭 내부에. -->

      <!-- 보유 -->
      <section v-if="seg === 'holding'" class="space-y-2">
        <SectionHeader title="갖고 있는 종목" :count="holdings.length" />

        <div v-if="holdings.length > 0" class="space-y-1.5">
          <div
            v-for="h in visibleHoldings"
            :key="h.code"
            class="select-none rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 px-4 py-3.5 transition active:scale-[0.99]"
            role="button"
            tabindex="0"
            @pointerdown="onPressDown(h.code, h.code, h.name, h.cur)"
            @pointerup="onPressUp(h.code, h.code)"
            @pointerleave="clearPress(h.code)"
            @pointercancel="clearPress(h.code)"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <p class="truncate text-base font-bold tracking-tight">{{ h.name }}</p>
                <p class="mt-0.5 truncate text-[11px] text-muted-foreground tabular-nums">
                  {{ h.qty }}주 · 매수가 {{ fmtKrw(h.avg) }}
                </p>
              </div>
              <div class="shrink-0 text-right tabular-nums">
                <p class="flex items-center justify-end gap-0.5 text-base font-bold leading-none" :class="pflsColor(h.pflsAmt)">
                  <ArrowUpRight v-if="h.pflsAmt > 0" class="h-3.5 w-3.5" />
                  <ArrowDownRight v-else-if="h.pflsAmt < 0" class="h-3.5 w-3.5" />
                  {{ fmtPct(h.pflsRt) }}
                </p>
                <p class="mt-0.5 text-[11px] font-medium" :class="pflsColor(h.pflsAmt)">
                  {{ fmtSigned(h.pflsAmt) }}원
                </p>
              </div>
            </div>

            <div class="mt-3 flex items-center justify-between border-t border-border/60 pt-2.5 text-[11px]" @click.stop>
              <span class="text-muted-foreground">지금 <span class="font-semibold text-foreground tabular-nums">{{ fmtKrw(h.cur) }}</span></span>
              <div class="flex gap-1">
                <button
                  type="button"
                  class="rounded-md bg-up px-3 py-1 text-[11px] font-semibold text-white transition hover:brightness-110"
                  @click.stop="openQuick(h.code, h.name, 'buy', h.cur)"
                >매수</button>
                <button
                  type="button"
                  class="rounded-md bg-down px-3 py-1 text-[11px] font-semibold text-white transition hover:brightness-110"
                  @click.stop="openQuick(h.code, h.name, 'sell', h.cur)"
                >매도</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 무한스크롤 sentinel -->
        <div v-if="holdingHasMore" ref="holdingSentinel" class="h-2" />

        <EmptyState
          v-else-if="balance && holdings.length === 0"
          :icon="Inbox"
          title="아직 보유 종목이 없어요"
          description="관심 종목을 등록하거나 순위에서 골라 첫 매수를 시작해보세요."
        />

        <LoadingState v-else-if="!balance" :compact="true" />
      </section>

      <!-- 관심 -->
      <section v-else-if="seg === 'watch'" class="space-y-2">
        <SectionHeader title="관심 종목" :count="watchlist.items.length">
          <template #action>
            <button
              v-if="watchlist.items.length > 0"
              class="rounded-full px-2.5 py-1 text-xs font-semibold transition"
              :class="editing ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="toggleEditing"
            >
              {{ editing ? '완료' : '편집' }}
            </button>
          </template>
        </SectionHeader>

        <!-- 관심 검색 — watchlist 안 종목명/코드 필터링 -->
        <div v-if="watchlist.items.length > 0" class="relative">
          <input
            v-model="watchQ"
            type="text"
            placeholder="관심 종목 검색"
            class="w-full rounded-xl bg-muted px-3.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div v-if="filteredWatchlist.length > 0" class="space-y-1.5">
          <div
            v-for="item in filteredWatchlist"
            :key="item.id"
            class="select-none rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 px-4 py-3.5 transition active:scale-[0.99]"
            role="button"
            tabindex="0"
            @pointerdown="onPressDown(item.id, item.code, item.name, watchlist.quotes.get(item.code)?.price ?? 0)"
            @pointerup="onPressUp(item.id, item.code)"
            @pointerleave="clearPress(item.id)"
            @pointercancel="clearPress(item.id)"
          >
            <div class="flex items-center gap-3">
              <div
                v-if="editing"
                class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
                :class="selectedIds.has(item.id) ? 'border-destructive bg-destructive text-destructive-foreground' : 'border-border'"
              >
                <Check v-if="selectedIds.has(item.id)" class="h-3 w-3" />
              </div>

              <div class="min-w-0 flex-1">
                <p class="truncate text-base font-bold tracking-tight">{{ item.name }}</p>
                <p class="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                  {{ item.code }}
                  <span v-if="holdingFor(item.code)" class="ml-1 text-foreground">· 보유 {{ holdingFor(item.code)!.qty }}주</span>
                </p>
              </div>

              <div v-if="watchlist.quotes.get(item.code)?.ok" class="shrink-0 text-right tabular-nums">
                <p class="text-base font-bold">{{ fmtKrw(watchlist.quotes.get(item.code)!.price) }}</p>
                <p class="flex items-center justify-end gap-0.5 text-xs font-medium" :class="pflsColor(watchlist.quotes.get(item.code)!.changePct)">
                  <ArrowUpRight v-if="watchlist.quotes.get(item.code)!.changePct > 0" class="h-3 w-3" />
                  <ArrowDownRight v-else-if="watchlist.quotes.get(item.code)!.changePct < 0" class="h-3 w-3" />
                  {{ fmtPct(watchlist.quotes.get(item.code)!.changePct) }}
                </p>
              </div>
              <span v-else class="shrink-0 text-[11px] text-muted-foreground">—</span>

              <button
                v-if="!editing"
                class="rounded-full p-1.5 text-amber-400 transition hover:bg-accent"
                aria-label="관심 제거"
                @click.stop="watchlist.removeByCode(item.code)"
              >
                <Star class="h-4 w-4 fill-amber-400" />
              </button>
            </div>

            <div
              v-if="!editing"
              class="mt-3 flex items-center justify-end gap-1 border-t border-border/60 pt-2.5"
              @click.stop
            >
              <button
                type="button"
                class="rounded-md bg-up px-3.5 py-1 text-[11px] font-bold text-white transition hover:brightness-110"
                @click.stop="goTrade(item.code, 'buy')"
              >매수</button>
              <button
                type="button"
                class="rounded-md bg-down px-3.5 py-1 text-[11px] font-bold text-white transition hover:brightness-110"
                @click.stop="goTrade(item.code, 'sell')"
              >매도</button>
            </div>
          </div>
        </div>

        <!-- 검색어 있는데 매칭 없을 때 -->
        <EmptyState
          v-else-if="watchQ.trim() && watchlist.loaded"
          :icon="Inbox"
          title="검색 결과가 없어요"
          description="이름이나 종목 코드의 일부로 다시 검색해 보세요."
        />

        <EmptyState
          v-else-if="watchlist.loaded"
          :icon="Star"
          title="관심 종목을 등록해보세요"
          description="종목 화면에서 별표 ★를 눌러 관심 종목으로 담아보세요."
        />

        <div v-else class="space-y-1.5">
          <div v-for="n in 3" :key="n" class="h-[110px] animate-pulse rounded-2xl bg-card" />
        </div>

        <div
          v-if="editing && selectedCount > 0"
          class="sticky bottom-20 z-10 mt-3 flex items-center gap-2 rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 px-4 py-3 shadow-lg"
        >
          <span class="text-sm font-medium">{{ selectedCount }}개 선택됨</span>
          <Button variant="destructive" size="sm" class="ml-auto" @click="removeOpen = true">
            <Trash2 class="mr-1 h-3.5 w-3.5" />
            관심에서 빼기
          </Button>
        </div>
      </section>

      <!-- 순위 -->
      <section v-else-if="seg === 'rank'" class="space-y-2">
        <div class="flex gap-1.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            v-for="c in rankCategories" :key="c.value"
            type="button"
            class="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition"
            :class="rankCategory === c.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'"
            @click="rankCategory = c.value"
          >
            {{ c.label }}
          </button>
        </div>

        <div class="flex items-center justify-between px-1 text-[10px] text-muted-foreground">
          <span v-if="rankUpdatedText">마지막 갱신 <span class="tabular-nums">{{ rankUpdatedText }}</span></span>
          <span v-else />
          <button
            class="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent"
            :disabled="rankLoading"
            @click="loadRanking"
          >
            <RefreshCw class="h-3.5 w-3.5" :class="rankLoading ? 'animate-spin' : ''" />
          </button>
        </div>

        <div v-if="rankItems.length > 0" class="space-y-1.5">
          <div
            v-for="r in rankItems"
            :key="r.code"
            class="select-none rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 px-4 py-3.5 transition active:scale-[0.99]"
            role="button"
            tabindex="0"
            @click="go(r.code)"
          >
            <div class="flex items-center gap-3">
              <span class="w-5 shrink-0 text-center text-[11px] font-bold text-muted-foreground tabular-nums">{{ r.rank }}</span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-base font-bold tracking-tight">{{ r.name }}</p>
                <p class="mt-0.5 text-[11px] text-muted-foreground tabular-nums">{{ r.code }}</p>
              </div>
              <div class="shrink-0 text-right tabular-nums">
                <p class="text-base font-bold">{{ fmtKrw(r.price) }}</p>
                <p class="text-xs font-medium" :class="pflsColor(r.changePct)">
                  {{ fmtPct(r.changePct) }}
                </p>
              </div>
            </div>
            <div
              class="mt-3 flex items-center justify-end gap-1 border-t border-border/60 pt-2.5"
              @click.stop
            >
              <button
                type="button"
                class="rounded-md bg-up px-3 py-1 text-[11px] font-semibold text-white transition hover:brightness-110"
                @click.stop="openQuick(r.code, r.name, 'buy', r.price)"
              >매수</button>
              <button
                type="button"
                class="rounded-md bg-down px-3 py-1 text-[11px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
                :disabled="!isHolding(r.code)"
                @click.stop="openQuick(r.code, r.name, 'sell', r.price)"
              >매도</button>
            </div>
          </div>
        </div>

        <div v-else-if="!rankLoading" class="rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 px-5 py-8 text-center">
          <p class="text-[11px] text-muted-foreground">순위 데이터가 없어요</p>
        </div>

        <div v-else class="space-y-1.5">
          <div v-for="n in 5" :key="n" class="h-[110px] animate-pulse rounded-2xl bg-card" />
        </div>
      </section>

      <!-- 테마주 — 네이버 finance 테마 랭킹 -->
      <section v-else-if="seg === 'theme'" class="space-y-2">
        <!-- 테마 검색 — 종목명/코드 → 그 종목이 속한 테마 -->
        <input
          v-model="themeQ"
          type="text"
          placeholder="종목명/테마명"
          class="w-full rounded-xl bg-muted px-3.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />

        <!-- 검색 모드 -->
        <template v-if="themeQ.trim()">
          <div v-if="themeSearchLoading" class="space-y-1.5">
            <div v-for="n in 3" :key="n" class="h-[72px] animate-pulse rounded-2xl bg-card" />
          </div>
          <div v-else-if="themeSearchResults.length > 0" class="space-y-1.5">
            <p class="px-1 text-[11px] text-muted-foreground">
              검색 결과 <span class="tabular-nums">{{ themeSearchResults.length }}</span>개 테마
            </p>
            <button
              v-for="t in themeSearchResults" :key="t.no"
              type="button"
              class="w-full rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 px-4 py-3 text-left transition active:scale-[0.99]"
              @click="openTheme(t)"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-bold tracking-tight">{{ t.name }}</p>
                  <p class="mt-0.5 truncate text-[10px] text-muted-foreground">
                    매칭 종목: {{ t.matchedStocks.map((s) => s.name).join(' · ') }}
                  </p>
                </div>
                <p class="shrink-0 text-sm font-bold tabular-nums" :class="pflsColor(t.changePct)">
                  {{ fmtPct(t.changePct) }}
                </p>
              </div>
            </button>
          </div>
          <EmptyState
            v-else
            :icon="Inbox"
            title="속한 테마가 없어요"
            description="다른 종목으로 다시 시도해보세요."
          />
        </template>

        <!-- 검색 없을 때: 랭킹 모드 -->
        <template v-else>
        <div class="flex items-center justify-end px-1">
          <button
            class="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent"
            :disabled="themesLoading"
            @click="loadThemes"
          >
            <RefreshCw class="h-3.5 w-3.5" :class="themesLoading ? 'animate-spin' : ''" />
          </button>
        </div>

        <div v-if="themes.length > 0" class="space-y-1.5">
          <button
            v-for="(t, i) in themes" :key="t.no"
            type="button"
            class="w-full rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 px-4 py-3 text-left transition active:scale-[0.99]"
            @click="openTheme(t)"
          >
            <div class="flex items-center gap-3">
              <span class="w-6 shrink-0 text-center text-[11px] font-bold tabular-nums"
                :class="i < 3 ? 'text-primary' : 'text-muted-foreground'"
              >{{ i + 1 }}</span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-bold tracking-tight">{{ t.name }}</p>
                <p class="mt-0.5 truncate text-[10px] text-muted-foreground">
                  주도주: {{ t.leadingStocks.join(' · ') || '—' }}
                </p>
              </div>
              <div class="shrink-0 text-right tabular-nums">
                <p class="text-sm font-bold" :class="pflsColor(t.changePct)">
                  {{ fmtPct(t.changePct) }}
                </p>
                <p class="mt-0.5 text-[10px] text-muted-foreground">
                  <span class="text-up">▲{{ t.upCount }}</span>
                  <span class="mx-0.5">·</span>
                  <span class="text-down">▼{{ t.downCount }}</span>
                </p>
              </div>
            </div>
          </button>
        </div>

        <div v-else-if="themesLoading" class="space-y-1.5">
          <div v-for="n in 5" :key="n" class="h-[68px] animate-pulse rounded-2xl bg-card" />
        </div>

        <EmptyState
          v-else
          :icon="Inbox"
          title="테마 데이터를 불러오지 못했어요"
          description="새로고침을 눌러 다시 시도해 보세요."
        />
        </template>
      </section>

      <Modal :open="removeOpen" title="관심 종목에서 뺄까요?" @close="removeOpen = false">
        <p class="text-sm text-muted-foreground">
          선택한 <span class="font-semibold text-foreground">{{ selectedCount }}개</span> 종목을 관심에서 뺄게요.
        </p>
        <div class="mt-5 grid grid-cols-2 gap-2">
          <Button variant="secondary" @click="removeOpen = false">아니요</Button>
          <Button variant="destructive" @click="confirmRemove">빼기</Button>
        </div>
      </Modal>

    <QuickTradeSheet
      :open="quick.open"
      :code="quick.code"
      :name="quick.name"
      :side="quick.side"
      :current-price="quick.currentPrice"
      :holding-qty="quick.holdingQty"
      :sellable-qty="quick.sellableQty"
      :available-cash="balance?.cash ?? 0"
      @close="closeQuick"
    />

    <!-- 테마 상세 — 소속 종목 list -->
    <BottomSheet
      :open="!!selectedTheme"
      :title="selectedTheme?.name ?? ''"
      @close="closeTheme"
    >
      <div v-if="selectedTheme" class="space-y-3">
        <div class="flex items-center gap-2 text-[11px]">
          <span :class="pflsColor(selectedTheme.changePct)" class="font-bold tabular-nums">
            {{ fmtPct(selectedTheme.changePct) }}
          </span>
          <span class="text-muted-foreground">
            상승 <span class="text-up font-semibold">{{ selectedTheme.upCount }}</span> ·
            보합 <span class="font-semibold">{{ selectedTheme.flatCount }}</span> ·
            하락 <span class="text-down font-semibold">{{ selectedTheme.downCount }}</span>
          </span>
        </div>

        <div v-if="themeStocks.length > 0" class="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
          <button
            v-for="s in themeStocks" :key="s.code"
            type="button"
            class="flex w-full items-center gap-3 rounded-xl bg-card ring-1 ring-border/60 dark:ring-0 px-3 py-2.5 text-left transition active:scale-[0.99]"
            @click="closeTheme(); router.push(`/stocks/${s.code}`)"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-bold">{{ s.name }}</p>
              <p class="mt-0.5 text-[10px] text-muted-foreground tabular-nums">{{ s.code }}</p>
            </div>
            <div class="shrink-0 text-right tabular-nums">
              <p class="text-sm font-bold">{{ fmtKrw(s.price) }}</p>
              <p class="text-[11px] font-semibold" :class="pflsColor(s.changePct)">
                {{ fmtPct(s.changePct) }}
              </p>
            </div>
          </button>
        </div>
        <div v-else-if="themeStocksLoading" class="space-y-1.5">
          <div v-for="n in 4" :key="n" class="h-[60px] animate-pulse rounded-xl bg-card" />
        </div>
        <p v-else class="py-6 text-center text-xs text-muted-foreground">
          종목 정보를 불러오지 못했어요.
        </p>
      </div>
    </BottomSheet>
  </div>
</template>
