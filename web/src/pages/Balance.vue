<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { RefreshCw, ArrowDownRight } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
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
    <div class="flex items-center justify-between px-1">
      <h2 class="text-base font-semibold tracking-tight">잔고</h2>
      <button class="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent" :disabled="loading" @click="load">
        <RefreshCw class="h-4 w-4" :class="loading ? 'animate-spin' : ''" />
      </button>
    </div>

    <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

    <Card v-if="balance">
      <div>
        <p class="text-xs text-muted-foreground">총 자산</p>
        <p class="mt-1 text-3xl font-bold tabular-nums tracking-tighter">{{ fmtKrw(balance.totalEvlu) }}</p>
        <p class="mt-2 text-sm font-semibold tabular-nums" :class="pflsColor(balance.totalPfls)">
          {{ fmtSigned(balance.totalPfls) }}원 ({{ fmtPct(balance.totalPflsRt) }})
        </p>
      </div>
      <div class="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
        예수금 <span class="ml-2 font-semibold text-foreground tabular-nums">{{ fmtKrw(balance.cash) }}</span>
      </div>
    </Card>

    <section v-if="balance && balance.holdings.length > 0" class="space-y-2 pt-1">
      <h3 class="px-1 text-sm font-semibold">보유 종목 <span class="text-muted-foreground">{{ balance.holdings.length }}</span></h3>
      <div
        v-for="h in balance.holdings"
        :key="h.code"
        class="rounded-2xl bg-card p-4"
      >
        <div class="flex items-start justify-between">
          <RouterLink :to="`/quote?code=${h.code}`" class="flex-1">
            <p class="text-sm font-semibold">{{ h.name }}</p>
            <p class="text-[11px] text-muted-foreground tabular-nums">{{ h.code }} · {{ h.qty }}주</p>
          </RouterLink>
          <div class="text-right tabular-nums">
            <p class="text-base font-bold" :class="pflsColor(h.pflsAmt)">
              {{ fmtPct(h.pflsRt) }}
            </p>
            <p class="text-xs" :class="pflsColor(h.pflsAmt)">{{ fmtSigned(h.pflsAmt) }}원</p>
          </div>
        </div>
        <div class="mt-2 grid grid-cols-2 gap-2 text-xs">
          <div class="rounded-lg bg-muted/50 px-2.5 py-1.5">
            <span class="text-muted-foreground">평단</span>
            <span class="ml-auto block text-right font-medium tabular-nums">{{ fmtKrw(h.avg) }}</span>
          </div>
          <div class="rounded-lg bg-muted/50 px-2.5 py-1.5">
            <span class="text-muted-foreground">현재</span>
            <span class="ml-auto block text-right font-medium tabular-nums">{{ fmtKrw(h.cur) }}</span>
          </div>
        </div>
        <RouterLink :to="`/trade/sell?code=${h.code}`" class="mt-3 block">
          <Button variant="secondary" size="md" class="w-full">
            <ArrowDownRight class="mr-1 h-4 w-4 text-down" />매도
          </Button>
        </RouterLink>
      </div>
    </section>

    <Card v-else-if="balance && balance.holdings.length === 0">
      <p class="text-sm text-muted-foreground">보유 종목 없음</p>
    </Card>
  </div>
</template>
