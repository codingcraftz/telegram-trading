<script setup lang="ts">
// 잔고 — 보유 종목 + 평가손익 전용 페이지. 홈의 자산 카드와 분리되어 상세 표시.
// SWR: localStorage 캐시 즉시 표시 + 백그라운드 fetch + 세션 기반 폴링.

import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { RefreshCw, Inbox } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import EmptyState from '@/components/EmptyState.vue';
import LoadingState from '@/components/ui/LoadingState.vue';
import { api, type BalanceResponse } from '@/api/client';
import { fmtKrw, fmtPct, fmtSigned, pflsColor } from '@/lib/format';
import { useMarketSession } from '@/composables/useMarketSession';

const router = useRouter();
const { session } = useMarketSession();

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

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const b = await api.balance();
    balance.value = b;
    saveCache(b);
  } catch (err) {
    if (!balance.value) error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
function startPolling() {
  stopPolling();
  if (document.hidden) return;
  const ms =
    session.value === 'open' ? 30_000 :
    session.value === 'closed' ? 0 :
    300_000;
  if (ms > 0) timer = setInterval(load, ms);
}
function stopPolling() {
  if (timer) clearInterval(timer);
  timer = null;
}
watch(session, () => startPolling());

function onVisibility() {
  if (document.hidden) stopPolling();
  else { load(); startPolling(); }
}

onMounted(() => {
  load();
  startPolling();
  document.addEventListener('visibilitychange', onVisibility);
});
onUnmounted(() => {
  stopPolling();
  document.removeEventListener('visibilitychange', onVisibility);
});

const holdings = computed(() => balance.value?.holdings ?? []);
const totalCost = computed(() =>
  holdings.value.reduce((sum, h) => sum + Math.round(h.avg * h.qty), 0),
);
</script>

<template>
  <div class="space-y-3">
    <!-- 평가손익 요약 -->
    <Card>
      <div class="flex items-start justify-between">
        <p class="text-xs font-medium text-muted-foreground">평가손익</p>
        <button
          class="-mr-1 -mt-1 rounded-md p-1.5 text-muted-foreground transition hover:bg-accent"
          :disabled="loading"
          aria-label="새로고침"
          @click="load"
        >
          <RefreshCw class="h-3.5 w-3.5" :class="loading ? 'animate-spin' : ''" />
        </button>
      </div>
      <div v-if="balance" class="mt-1 flex items-baseline gap-2 flex-wrap">
        <p
          class="text-3xl font-bold tabular-nums tracking-tighter"
          :class="pflsColor(balance.totalPfls)"
        >
          {{ fmtSigned(balance.totalPfls) }}원
        </p>
        <p
          class="text-base font-semibold tabular-nums"
          :class="pflsColor(balance.totalPfls)"
        >
          {{ fmtPct(balance.totalPflsRt) }}
        </p>
      </div>
      <p v-if="balance" class="mt-2 text-xs text-muted-foreground">
        평가액
        <span class="font-semibold text-foreground tabular-nums">{{ fmtKrw(balance.totalEvlu) }}</span>
        · 거래가능금액
        <span class="font-semibold text-foreground tabular-nums">{{ fmtKrw(balance.cash) }}</span>
      </p>
      <div v-else class="mt-1 animate-pulse">
        <div class="h-8 w-40 rounded bg-muted/60" />
        <div class="mt-2 h-4 w-56 rounded bg-muted/40" />
      </div>
      <p v-if="error && !balance" class="mt-2 text-sm text-muted-foreground">{{ error }}</p>
    </Card>

    <!-- 보유 종목 -->
    <div>
      <div class="mb-2 flex items-center justify-between px-1">
        <h2 class="text-sm font-bold tracking-tight">
          보유 종목 <span class="text-muted-foreground font-normal">({{ holdings.length }})</span>
        </h2>
      </div>
      <!-- balance 로딩 전 skeleton -->
      <div v-if="!balance" class="space-y-2">
        <div v-for="n in 3" :key="n" class="h-[110px] animate-pulse rounded-2xl bg-card" />
      </div>
      <div
        v-else-if="holdings.length === 0"
        class="rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 px-4 py-10"
      >
        <EmptyState
          :icon="Inbox"
          title="보유 종목 없음"
          description="첫 매수를 시작해 보세요"
        />
      </div>
      <div v-else class="space-y-2">
        <button
          v-for="h in holdings"
          :key="h.code"
          class="block w-full rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 px-4 py-3 text-left transition active:scale-[0.99]"
          @click="router.push(`/stocks/${h.code}`)"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate text-sm font-bold tracking-tight">{{ h.name }}</p>
              <p class="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                {{ h.code }} · {{ h.qty }}주 · 총매입
                <span class="font-semibold text-foreground/80">{{ fmtKrw(Math.round(h.avg * h.qty)) }}</span>
              </p>
            </div>
            <div class="text-right shrink-0">
              <p
                class="text-sm font-bold tabular-nums"
                :class="pflsColor(h.pflsAmt)"
              >
                {{ fmtSigned(h.pflsAmt) }}
              </p>
              <p
                class="text-[11px] font-semibold tabular-nums"
                :class="pflsColor(h.pflsRt)"
              >
                {{ fmtPct(h.pflsRt) }}
              </p>
            </div>
          </div>
          <!-- 하단 — 매입단가 / 현재가 (1주당) -->
          <div class="mt-2 flex items-center justify-between border-t border-border/60 pt-2 text-[11px]">
            <span class="text-muted-foreground">
              매입단가 <span class="font-semibold text-foreground tabular-nums">{{ fmtKrw(h.avg) }}</span>
            </span>
            <span class="text-muted-foreground">
              현재가 <span class="font-semibold text-foreground tabular-nums">{{ fmtKrw(h.cur) }}</span>
            </span>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>
