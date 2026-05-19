<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { RouterLink } from 'vue-router';
import { ArrowUpRight, ArrowDownRight, Search, RefreshCw, Wallet, Clock } from 'lucide-vue-next';
import { useOrdersStore } from '@/stores/orders';
import Card from '@/components/ui/Card.vue';
import InfoTooltip from '@/components/InfoTooltip.vue';
import Sparkline from '@/components/Sparkline.vue';
import { api, type BalanceResponse, type IndexItem } from '@/api/client';
import { fmtKrw, fmtPct, fmtSigned, pflsColor } from '@/lib/format';

const ordersStore = useOrdersStore();
const balance = ref<BalanceResponse | null>(null);
const indices = ref<IndexItem[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

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
    balance.value = await api.balance();
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  } catch (err) {
    // balance가 한 번이라도 받아진 상태면 에러 숨김 (이전 값 유지)
    if (!balance.value) error.value = friendlyError((err as Error).message);
    // 일시 에러는 5초 후 자동 재시도
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => load(), 5_000);
  } finally {
    loading.value = false;
  }
}

async function loadIndices() {
  try {
    const r = await api.indices();
    indices.value = r.items;
  } catch { /* silent */ }
}

function fmtIndex(v: number) {
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
function startPolling() {
  stopPolling();
  if (document.hidden) return;
  pollTimer = setInterval(load, 10_000);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  pollTimer = null;
}
function onVisibility() {
  if (document.hidden) stopPolling();
  else { load(); loadIndices(); startPolling(); }
}

const hasHoldings = computed(() => (balance.value?.holdings?.length ?? 0) > 0);

onMounted(() => {
  load();
  loadIndices();
  startPolling();
  document.addEventListener('visibilitychange', onVisibility);
});
onUnmounted(() => {
  stopPolling();
  document.removeEventListener('visibilitychange', onVisibility);
});
</script>

<template>
  <div class="space-y-4">
    <!-- 시장 지수 -->
    <section v-if="indices.length > 0" class="-mx-4 px-4">
      <div class="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div
          v-for="idx in indices"
          :key="idx.key"
          class="min-w-[9.5rem] shrink-0 rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 px-3 py-2.5"
        >
          <div class="flex items-start justify-between">
            <div>
              <p class="text-[10px] font-medium text-muted-foreground">{{ idx.label }}</p>
              <p class="mt-0.5 text-sm font-bold tabular-nums tracking-tight">{{ fmtIndex(idx.price) }}</p>
            </div>
            <p class="flex items-center gap-0.5 text-[11px] font-semibold tabular-nums" :class="pflsColor(idx.change)">
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

    <!-- 거래 대기 알림 -->
    <RouterLink
      v-if="ordersStore.count > 0"
      to="/orders"
      class="flex items-center gap-3 rounded-2xl bg-primary/10 px-4 py-3 transition active:scale-[0.99]"
    >
      <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15">
        <Clock class="h-4 w-4 text-primary" />
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold">거래 대기 {{ ordersStore.count }}건</p>
        <p class="text-[11px] text-muted-foreground">눌러서 확인하기</p>
      </div>
      <ArrowUpRight class="h-4 w-4 -rotate-45 text-muted-foreground" />
    </RouterLink>

    <!-- 자산 헤드라인 -->
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
      <div v-else-if="loading" class="mt-2 h-10 w-48 animate-pulse rounded-md bg-muted" />
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

    <!-- 보유 / 종목 페이지로 -->
    <RouterLink
      to="/stocks"
      class="flex items-center gap-3 rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 px-4 py-3 transition active:scale-[0.99]"
    >
      <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
        <Search class="h-4 w-4 text-muted-foreground" />
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold">
          <template v-if="hasHoldings">갖고 있는 종목 {{ balance!.holdings.length }}개</template>
          <template v-else>종목 둘러보기</template>
        </p>
        <p class="text-[11px] text-muted-foreground">
          <template v-if="hasHoldings">눌러서 보유·관심 종목 보기</template>
          <template v-else>아직 갖고 있는 종목이 없어요</template>
        </p>
      </div>
      <ArrowUpRight class="h-4 w-4 -rotate-45 text-muted-foreground" />
    </RouterLink>
  </div>
</template>
