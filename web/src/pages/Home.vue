<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { ArrowUpRight, ArrowDownRight, LineChart, Search } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import { api, type BalanceResponse } from '@/api/client';
import { fmtKrw, fmtPct, fmtSigned, pflsColor } from '@/lib/format';

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

onMounted(load);
</script>

<template>
  <div class="space-y-3">
    <!-- 총자산 큰 헤드라인 -->
    <section class="px-1 pt-4 pb-2">
      <p class="text-xs font-medium text-muted-foreground">총 자산</p>
      <p
        v-if="balance"
        class="mt-1 text-4xl font-bold tabular-nums tracking-tighter"
      >
        {{ fmtKrw(balance.totalEvlu) }}
      </p>
      <div v-else-if="loading" class="mt-1 h-10 w-48 animate-pulse rounded-md bg-muted" />
      <p v-else class="mt-1 text-sm text-destructive">{{ error }}</p>

      <div v-if="balance" class="mt-2 flex items-center gap-1.5 text-sm">
        <ArrowUpRight v-if="balance.totalPfls > 0" class="h-4 w-4 text-up" />
        <ArrowDownRight v-else-if="balance.totalPfls < 0" class="h-4 w-4 text-down" />
        <span class="font-semibold tabular-nums" :class="pflsColor(balance.totalPfls)">
          {{ fmtSigned(balance.totalPfls) }}원
        </span>
        <span class="tabular-nums text-xs" :class="pflsColor(balance.totalPfls)">
          ({{ fmtPct(balance.totalPflsRt) }})
        </span>
      </div>
    </section>

    <!-- 빠른 액션 -->
    <div class="grid grid-cols-3 gap-2">
      <RouterLink
        to="/trade/buy"
        class="flex flex-col items-center gap-1.5 rounded-2xl bg-card py-4 transition hover:bg-accent"
      >
        <ArrowUpRight class="h-5 w-5 text-up" :stroke-width="2.5" />
        <span class="text-xs font-semibold">매수</span>
      </RouterLink>
      <RouterLink
        to="/trade/sell"
        class="flex flex-col items-center gap-1.5 rounded-2xl bg-card py-4 transition hover:bg-accent"
      >
        <ArrowDownRight class="h-5 w-5 text-down" :stroke-width="2.5" />
        <span class="text-xs font-semibold">매도</span>
      </RouterLink>
      <RouterLink
        to="/quote"
        class="flex flex-col items-center gap-1.5 rounded-2xl bg-card py-4 transition hover:bg-accent"
      >
        <Search class="h-5 w-5" :stroke-width="2.5" />
        <span class="text-xs font-semibold">시세</span>
      </RouterLink>
    </div>

    <!-- 보유 종목 (있으면 top 5) -->
    <section v-if="balance && balance.holdings.length > 0" class="space-y-2 pt-2">
      <div class="flex items-center justify-between px-1">
        <h3 class="text-sm font-semibold">보유 종목</h3>
        <RouterLink to="/balance" class="text-xs text-muted-foreground hover:text-foreground">
          전체 {{ balance.holdings.length }}개 ›
        </RouterLink>
      </div>
      <RouterLink
        v-for="h in balance.holdings.slice(0, 5)"
        :key="h.code"
        :to="`/quote?code=${h.code}`"
        class="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 transition hover:bg-accent"
      >
        <div class="flex-1">
          <p class="text-sm font-semibold">{{ h.name }}</p>
          <p class="text-[11px] text-muted-foreground tabular-nums">
            {{ h.qty }}주 · 평단 {{ fmtKrw(h.avg) }}
          </p>
        </div>
        <div class="text-right tabular-nums">
          <p class="text-sm font-semibold">{{ fmtKrw(h.cur) }}</p>
          <p class="text-xs" :class="pflsColor(h.pflsAmt)">
            {{ fmtPct(h.pflsRt) }}
          </p>
        </div>
      </RouterLink>
    </section>

    <Card v-else-if="balance && !loading && !error">
      <p class="text-sm text-muted-foreground">보유 종목 없음</p>
    </Card>
  </div>
</template>
