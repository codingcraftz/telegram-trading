<script setup lang="ts">
// 홈 — 세션·지수·자산·거래대기 (가벼움). 보유 종목은 종목 탭으로 이관.
// SWR(stale-while-revalidate): localStorage 캐시 즉시 표시 + 백그라운드 fetch.
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { RouterLink } from 'vue-router';
import {
  ArrowUpRight, ArrowDownRight, RefreshCw, Wallet, Clock, ChevronRight,
} from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import InfoTooltip from '@/components/InfoTooltip.vue';
import Sparkline from '@/components/Sparkline.vue';
import LoadingState from '@/components/ui/LoadingState.vue';
import { api, type BalanceResponse } from '@/api/client';
import { fmtKrw, fmtPct, fmtSigned, pflsColor } from '@/lib/format';
import { useOrdersStore } from '@/stores/orders';
import { useMarketSession } from '@/composables/useMarketSession';
import { useIndices } from '@/composables/useIndices';

const ordersStore = useOrdersStore();
const { session, nowKst } = useMarketSession();
const { items: indices } = useIndices();

// ===== 자산 (SWR) =====
const CACHE_KEY = 'owlim:balance-cache:v1';
const balance = ref<BalanceResponse | null>(loadCache());
const loading = ref(false);
const error = ref<string | null>(null);

function loadCache(): BalanceResponse | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as BalanceResponse) : null;
  } catch { return null; }
}
function saveCache(b: BalanceResponse) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(b)); } catch {}
}

function friendlyError(raw: string): string {
  if (/EGW00133|토큰.*1분|발급.*잠시/i.test(raw)) return '잠시 후 다시 불러올게요';
  if (/EGW0|KIS|tr_id|HTTP\s*\d/i.test(raw)) return '증권사 응답이 늦어요. 곧 다시 시도할게요';
  if (/network|fetch|ECONN/i.test(raw)) return '네트워크 연결을 확인해 주세요';
  return raw.length > 60 ? '잠시 후 다시 시도해 주세요' : raw;
}

let retryTimer: ReturnType<typeof setTimeout> | null = null;
async function load() {
  loading.value = true;
  error.value = null;
  try {
    const b = await api.balance();
    balance.value = b;
    saveCache(b);
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  } catch (err) {
    if (!balance.value) error.value = friendlyError((err as Error).message);
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => load(), 5_000);
  } finally { loading.value = false; }
}

// 폴링: 장중 30s / 장후 5min / 휴장 정지
let balTimer: ReturnType<typeof setInterval> | null = null;
function startBalPolling() {
  stopBalPolling();
  if (document.hidden) return;
  const ms =
    session.value === 'open' ? 30_000 :
    session.value === 'closed' ? 0 :
    300_000;
  if (ms > 0) balTimer = setInterval(load, ms);
}
function stopBalPolling() {
  if (balTimer) clearInterval(balTimer);
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  balTimer = null;
}
watch(session, () => startBalPolling());
function onVisibility() {
  if (document.hidden) stopBalPolling();
  else { load(); startBalPolling(); }
}

onMounted(() => {
  load(); // 캐시 있어도 백그라운드로 fresh fetch
  startBalPolling();
  document.addEventListener('visibilitychange', onVisibility);
});
onUnmounted(() => {
  stopBalPolling();
  document.removeEventListener('visibilitychange', onVisibility);
});

// ===== 세션 =====
const sessionDot = computed(() => {
  switch (session.value) {
    case 'open': return 'bg-emerald-500';
    case 'before': return 'bg-zinc-400';
    case 'after': return 'bg-amber-500';
    case 'closed': return 'bg-red-500';
  }
});
const sessionText = computed(() => {
  switch (session.value) {
    case 'open': return '장중';
    case 'before': return '장 시작 전';
    case 'after': return '장 마감';
    case 'closed': return '휴장';
  }
});
const timeText = computed(() => {
  if (!nowKst.value) return '';
  const d = new Date(nowKst.value);
  return d.toLocaleTimeString('ko-KR', {
    timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false,
  });
});

// ===== 지수 =====
function fmtIndex(v: number) {
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
const orderedIndices = computed(() => {
  const order: Record<string, number> = { kospi: 0, kosdaq: 1, nasdaq: 2, dow: 3 };
  return [...indices.value].sort((a, b) => (order[a.key] ?? 99) - (order[b.key] ?? 99));
});

const usSessionLabel = computed(() => {
  if (typeof window === 'undefined') return '현지';
  const kstHour = (new Date().getUTCHours() + 9) % 24;
  const isOpen = kstHour >= 22 || kstHour < 5;
  return isOpen ? '미장 거래중' : '미장 마감';
});
function isUsIndex(key: string) { return key === 'nasdaq' || key === 'dow'; }

const holdingCount = computed(() => balance.value?.holdings.length ?? 0);
</script>

<template>
  <div class="space-y-4">
    <!-- 세션 라인 -->
    <div class="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
      <span class="inline-block h-2 w-2 rounded-full" :class="sessionDot" />
      <span class="font-semibold">{{ sessionText }}</span>
      <span v-if="timeText" class="text-muted-foreground tabular-nums">{{ timeText }}</span>
    </div>

    <!-- 시장 지수 skeleton — 로딩 전 동일 사이즈 placeholder -->
    <section v-if="orderedIndices.length === 0" class="-mx-4 px-4">
      <div class="mb-2 px-1">
        <div class="h-4 w-20 animate-pulse rounded bg-muted/60" />
      </div>
      <div class="flex gap-2 overflow-hidden">
        <div v-for="n in 4" :key="n" class="min-w-[9.5rem] h-[78px] shrink-0 animate-pulse rounded-2xl bg-card" />
      </div>
    </section>

    <!-- 시장 지수 -->
    <section v-else class="-mx-4 px-4">
      <div class="mb-2 px-1">
        <h2 class="text-sm font-bold tracking-tight">오늘의 시장</h2>
      </div>
      <div class="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div
          v-for="idx in orderedIndices"
          :key="idx.key"
          class="min-w-[9.5rem] shrink-0 rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 px-3 py-2.5"
        >
          <div class="flex items-start justify-between">
            <div class="min-w-0">
              <p class="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                <span>{{ idx.label }}</span>
                <span
                  v-if="isUsIndex(idx.key)"
                  class="rounded-sm bg-muted px-1 py-px text-[9px]"
                  :class="usSessionLabel === '미장 거래중' ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'"
                >{{ usSessionLabel }}</span>
              </p>
              <p class="mt-0.5 text-sm font-bold tabular-nums tracking-tight">{{ fmtIndex(idx.price) }}</p>
            </div>
            <p class="flex shrink-0 items-center gap-0.5 text-[11px] font-semibold tabular-nums" :class="pflsColor(idx.change)">
              <ArrowUpRight v-if="idx.change > 0" class="h-3 w-3" />
              <ArrowDownRight v-else-if="idx.change < 0" class="h-3 w-3" />
              {{ fmtPct(idx.changePct) }}
            </p>
          </div>
          <Sparkline
            v-if="idx.series.length >= 2"
            :data="idx.series"
            :width="140"
            :height="36"
            class="mt-1.5 w-full"
          />
        </div>
      </div>
    </section>

    <!-- 내 자산 (거래 대기 카드는 자산 아래로 이동) -->
    <Card>
      <div class="flex items-start justify-between">
        <p class="text-xs font-medium text-muted-foreground">내 자산</p>
        <button
          class="-mr-1 -mt-1 rounded-md p-1.5 text-muted-foreground transition hover:bg-accent"
          :disabled="loading"
          aria-label="새로고침"
          @click="load"
        >
          <RefreshCw class="h-3.5 w-3.5" :class="loading ? 'animate-spin' : ''" />
        </button>
      </div>

      <p v-if="balance" class="mt-1 text-[2.6rem] font-bold leading-none tabular-nums tracking-tighter">
        {{ fmtKrw(balance.totalEvlu) }}
      </p>
      <div v-else-if="loading || !error" class="mt-1 animate-pulse">
        <div class="h-10 w-48 rounded bg-muted/60" />
        <div class="mt-3 h-4 w-32 rounded bg-muted/40" />
      </div>
      <p v-else class="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
        <RefreshCw class="h-3.5 w-3.5 animate-spin" />
        {{ error }}
      </p>

      <div v-if="balance" class="mt-3 flex items-center gap-1.5 text-sm">
        <ArrowUpRight v-if="balance.totalPfls > 0" class="h-4 w-4 text-up" />
        <ArrowDownRight v-else-if="balance.totalPfls < 0" class="h-4 w-4 text-down" />
        <span class="font-semibold tabular-nums" :class="pflsColor(balance.totalPfls)">
          {{ fmtSigned(balance.totalPfls) }}원
        </span>
        <span class="text-xs tabular-nums" :class="pflsColor(balance.totalPfls)">
          ({{ fmtPct(balance.totalPflsRt) }})
        </span>
        <span class="ml-1 text-[11px] text-muted-foreground">어제보다</span>
      </div>

      <div v-if="balance" class="mt-4 flex items-center gap-2 border-t border-border pt-3 text-xs">
        <Wallet class="h-3.5 w-3.5 text-muted-foreground" />
        <span class="flex items-center gap-1 text-muted-foreground">
          매수 가능금액
          <InfoTooltip title="매수 가능금액" description="지금 새로 주식을 사는 데 쓸 수 있는 잔금이에요. 전체 자산에서 이미 보유한 주식 가치를 뺀 금액이에요." />
        </span>
        <span class="ml-auto font-semibold tabular-nums">{{ fmtKrw(balance.cash) }}</span>
      </div>
    </Card>

    <!-- 거래 대기 — 자산 아래 위치. count>0 일 때만. -->
    <RouterLink
      v-if="ordersStore.count > 0"
      to="/trade?tab=history"
      class="flex items-center gap-3 rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 px-4 py-3 transition active:scale-[0.99]"
    >
      <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15">
        <Clock class="h-4 w-4 text-primary" />
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold">거래 대기 {{ ordersStore.count }}건</p>
        <p class="text-[11px] text-muted-foreground">진행 상황 · 미체결 · 전략 감시</p>
      </div>
      <ChevronRight class="h-4 w-4 text-muted-foreground" />
    </RouterLink>

    <!-- 보유 종목 — 잔고 페이지로 -->
    <RouterLink
      to="/holdings"
      class="flex items-center gap-3 rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 px-4 py-3 transition active:scale-[0.99]"
    >
      <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/60">
        <Wallet class="h-4 w-4 text-muted-foreground" />
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold">
          {{ holdingCount > 0 ? `보유 종목 ${holdingCount}개` : '보유 종목' }}
        </p>
        <p class="text-[11px] text-muted-foreground">평가손익 · 종목별 상세</p>
      </div>
      <ChevronRight class="h-4 w-4 text-muted-foreground" />
    </RouterLink>
  </div>
</template>
