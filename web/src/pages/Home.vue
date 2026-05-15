<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { ArrowUpRight, ArrowDownRight, Search, RefreshCw, Wallet } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import EmptyState from '@/components/EmptyState.vue';
import SectionHeader from '@/components/SectionHeader.vue';
import InfoTooltip from '@/components/InfoTooltip.vue';
import { api, type BalanceResponse } from '@/api/client';
import { fmtKrw, fmtPct, fmtSigned, pflsColor } from '@/lib/format';

const router = useRouter();
const balance = ref<BalanceResponse | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    balance.value = await api.balance();
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
function startPolling() {
  stopPolling();
  if (document.hidden) return;
  pollTimer = setInterval(load, 10_000);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
function onVisibility() {
  if (document.hidden) stopPolling();
  else { load(); startPolling(); }
}

const hasHoldings = computed(() => (balance.value?.holdings?.length ?? 0) > 0);

onMounted(() => {
  load();
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
      <p v-else class="mt-2 text-sm text-destructive">{{ error }}</p>

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
          살 수 있는 돈
          <InfoTooltip title="살 수 있는 돈" description="지금 새로 주식을 사는 데 쓸 수 있는 잔금이에요. 전체 자산에서 이미 보유한 주식 가치를 뺀 금액이에요." />
        </span>
        <span class="ml-auto font-semibold tabular-nums">{{ fmtKrw(balance.cash) }}</span>
      </div>
    </Card>

    <!-- 보유 종목 -->
    <section v-if="hasHoldings" class="space-y-2">
      <SectionHeader title="갖고 있는 종목" :count="balance!.holdings.length">
        <template #action>
          <RouterLink to="/stocks" class="text-muted-foreground hover:text-foreground">
            종목 둘러보기 ›
          </RouterLink>
        </template>
      </SectionHeader>

      <div
        v-for="h in balance!.holdings"
        :key="h.code"
        class="rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 px-4 py-3.5 transition active:scale-[0.99]"
      >
        <div
          class="flex items-start justify-between gap-3"
          role="link"
          tabindex="0"
          @click="router.push(`/stocks/${h.code}`)"
        >
          <div class="min-w-0 flex-1">
            <p class="truncate text-base font-bold tracking-tight">{{ h.name }}</p>
            <p class="mt-0.5 truncate text-xs text-muted-foreground tabular-nums">
              {{ h.qty }}주 · 내 매수가 {{ fmtKrw(h.avg) }}
            </p>
          </div>
          <div class="shrink-0 text-right tabular-nums">
            <p class="flex items-center justify-end gap-0.5 text-lg font-bold leading-none" :class="pflsColor(h.pflsAmt)">
              <ArrowUpRight v-if="h.pflsAmt > 0" class="h-4 w-4" />
              <ArrowDownRight v-else-if="h.pflsAmt < 0" class="h-4 w-4" />
              {{ fmtPct(h.pflsRt) }}
            </p>
            <p class="mt-1 text-xs font-medium" :class="pflsColor(h.pflsAmt)">
              {{ fmtSigned(h.pflsAmt) }}원
            </p>
          </div>
        </div>

        <div class="mt-3 flex items-center justify-between border-t border-border pt-3">
          <div>
            <p class="text-[10px] text-muted-foreground">지금</p>
            <p class="text-sm font-semibold tabular-nums">{{ fmtKrw(h.cur) }}</p>
          </div>
          <RouterLink :to="`/sell?code=${h.code}`" @click.stop>
            <Button variant="secondary" size="sm">팔기</Button>
          </RouterLink>
        </div>
      </div>
    </section>

    <!-- 보유 없을 때 -->
    <EmptyState
      v-else-if="balance && !loading && !error"
      :icon="Search"
      title="아직 갖고 있는 종목이 없어요"
      description="관심 가는 종목을 둘러보고 사고 싶을 때 손쉽게 매수해 보세요."
    >
      <template #action>
        <RouterLink to="/stocks">
          <Button variant="primary" size="md">종목 둘러보기</Button>
        </RouterLink>
      </template>
    </EmptyState>
  </div>
</template>
