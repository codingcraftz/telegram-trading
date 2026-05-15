<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { TrendingUp, TrendingDown, LineChart, ShoppingCart } from 'lucide-vue-next';
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
  <div class="space-y-4">
    <!-- 잔고 요약 카드 -->
    <Card>
      <template #header>
        <p class="text-xs text-muted-foreground">총 평가</p>
        <p v-if="balance" class="mt-1 text-2xl font-bold">
          {{ fmtKrw(balance.totalEvlu) }}
        </p>
        <p v-else-if="loading" class="mt-1 text-2xl font-bold text-muted-foreground">
          로딩 중...
        </p>
        <p v-else class="mt-1 text-sm text-destructive">{{ error }}</p>
      </template>
      <div v-if="balance" class="mt-2 flex items-baseline gap-2">
        <span
          class="text-sm font-semibold"
          :class="pflsColor(balance.totalPfls)"
        >
          {{ fmtSigned(balance.totalPfls) }}원
        </span>
        <span class="text-xs" :class="pflsColor(balance.totalPfls)">
          ({{ fmtPct(balance.totalPflsRt) }})
        </span>
      </div>
    </Card>

    <!-- 빠른 액션 -->
    <div class="grid grid-cols-3 gap-2">
      <RouterLink to="/trade/buy">
        <Button variant="primary" size="lg" class="w-full">
          <TrendingUp class="mr-1 h-4 w-4" />매수
        </Button>
      </RouterLink>
      <RouterLink to="/trade/sell">
        <Button variant="destructive" size="lg" class="w-full">
          <TrendingDown class="mr-1 h-4 w-4" />매도
        </Button>
      </RouterLink>
      <RouterLink to="/quote">
        <Button variant="outline" size="lg" class="w-full">
          <LineChart class="mr-1 h-4 w-4" />시세
        </Button>
      </RouterLink>
    </div>

    <!-- 보유 종목 미리보기 (상위 3) -->
    <Card v-if="balance && balance.holdings.length > 0" title="📈 보유 종목" :subtitle="`${balance.holdings.length}개`">
      <div class="space-y-2">
        <RouterLink
          v-for="h in balance.holdings.slice(0, 3)"
          :key="h.code"
          :to="`/quote?code=${h.code}`"
          class="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-accent"
        >
          <div>
            <p class="text-sm font-medium">{{ h.name }}</p>
            <p class="text-[11px] text-muted-foreground">{{ h.code }} · {{ h.qty }}주</p>
          </div>
          <div class="text-right">
            <p class="text-sm font-semibold" :class="pflsColor(h.pflsAmt)">
              {{ fmtPct(h.pflsRt) }}
            </p>
            <p class="text-[11px]" :class="pflsColor(h.pflsAmt)">
              {{ fmtSigned(h.pflsAmt) }}
            </p>
          </div>
        </RouterLink>
        <RouterLink
          v-if="balance.holdings.length > 3"
          to="/balance"
          class="block pt-1 text-center text-xs text-primary"
        >
          전체 보기 →
        </RouterLink>
      </div>
    </Card>

    <Card v-else-if="!loading && !error">
      <p class="text-sm text-muted-foreground">보유 종목 없음</p>
      <RouterLink to="/trade/buy" class="mt-2 inline-block">
        <Button variant="primary" size="sm">
          <ShoppingCart class="mr-1 h-3 w-3" />첫 매수하기
        </Button>
      </RouterLink>
    </Card>
  </div>
</template>
