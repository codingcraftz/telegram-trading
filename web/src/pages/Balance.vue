<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { RefreshCw } from 'lucide-vue-next';
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
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-bold">💵 잔고</h2>
      <Button variant="ghost" size="icon" :disabled="loading" @click="load">
        <RefreshCw class="h-4 w-4" :class="loading ? 'animate-spin' : ''" />
      </Button>
    </div>

    <p v-if="error" class="text-sm text-destructive">❌ {{ error }}</p>

    <Card v-if="balance">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <p class="text-xs text-muted-foreground">총 평가</p>
          <p class="text-xl font-bold">{{ fmtKrw(balance.totalEvlu) }}</p>
        </div>
        <div>
          <p class="text-xs text-muted-foreground">예수금</p>
          <p class="text-base font-semibold">{{ fmtKrw(balance.cash) }}</p>
        </div>
      </div>
      <div class="mt-3 border-t border-border pt-3">
        <p class="text-xs text-muted-foreground">평가손익</p>
        <p class="text-lg font-bold" :class="pflsColor(balance.totalPfls)">
          {{ fmtSigned(balance.totalPfls) }}원
          <span class="text-sm">({{ fmtPct(balance.totalPflsRt) }})</span>
        </p>
      </div>
    </Card>

    <Card v-if="balance && balance.holdings.length > 0" title="📈 보유 종목" :subtitle="`${balance.holdings.length}개`">
      <div class="space-y-3">
        <div
          v-for="h in balance.holdings"
          :key="h.code"
          class="rounded-lg border border-border/50 p-3"
        >
          <div class="flex items-center justify-between">
            <div>
              <p class="font-semibold">{{ h.name }}</p>
              <p class="text-[11px] text-muted-foreground">{{ h.code }} · {{ h.qty }}주</p>
            </div>
            <div class="text-right">
              <p class="font-bold" :class="pflsColor(h.pflsAmt)">{{ fmtPct(h.pflsRt) }}</p>
              <p class="text-xs" :class="pflsColor(h.pflsAmt)">{{ fmtSigned(h.pflsAmt) }}원</p>
            </div>
          </div>
          <div class="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>매입 {{ fmtKrw(h.avg) }} → 현재 {{ fmtKrw(h.cur) }}</span>
          </div>
          <div class="mt-3 flex gap-2">
            <RouterLink :to="`/quote?code=${h.code}`" class="flex-1">
              <Button variant="outline" size="sm" class="w-full">시세</Button>
            </RouterLink>
            <RouterLink :to="`/trade/sell?code=${h.code}`" class="flex-1">
              <Button variant="destructive" size="sm" class="w-full">📤 매도</Button>
            </RouterLink>
          </div>
        </div>
      </div>
    </Card>

    <Card v-else-if="balance && balance.holdings.length === 0">
      <p class="text-sm text-muted-foreground">보유 종목 없음</p>
    </Card>
  </div>
</template>
