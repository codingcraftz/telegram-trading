<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';
import { RefreshCw, Plus, Image } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import SymbolSearch from '@/components/SymbolSearch.vue';
import { api, type QuoteResponse, type SearchItem } from '@/api/client';
import { fmtKrw, fmtNum, fmtPct, pflsColor } from '@/lib/format';

const route = useRoute();
const router = useRouter();
const code = ref<string>((route.query.code as string) ?? '');
const quote = ref<QuoteResponse | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

async function load() {
  if (!code.value) return;
  loading.value = true;
  error.value = null;
  try {
    quote.value = await api.quote(code.value);
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

function pickSymbol(item: SearchItem) {
  code.value = item.code;
  router.replace({ query: { code: item.code } });
}

async function addWatchlist() {
  if (!code.value) return;
  try {
    const r = await api.watchlistAdd(code.value);
    alert(r.existed ? `이미 관심종목에 있음` : `✅ 추가됨: ${r.name}`);
  } catch (err) {
    alert(`❌ ${(err as Error).message}`);
  }
}

watch(code, load);
onMounted(load);
</script>

<template>
  <div class="space-y-3">
    <h2 class="text-lg font-bold">🔍 시세조회</h2>

    <SymbolSearch placeholder="종목명 또는 6자리 코드 입력" @pick="pickSymbol" />

    <p v-if="error" class="text-sm text-destructive">❌ {{ error }}</p>

    <Card v-if="quote">
      <template #header>
        <div class="flex items-start justify-between">
          <div>
            <h3 class="text-lg font-bold">{{ quote.name }}</h3>
            <p class="text-xs text-muted-foreground">
              {{ quote.code }}<span v-if="quote.industry"> · {{ quote.industry }}</span>
            </p>
          </div>
          <Button variant="ghost" size="icon" :disabled="loading" @click="load">
            <RefreshCw class="h-4 w-4" :class="loading ? 'animate-spin' : ''" />
          </Button>
        </div>
      </template>

      <div class="flex items-baseline gap-2">
        <span class="text-3xl font-bold">{{ fmtKrw(quote.price) }}</span>
        <span class="text-base font-semibold" :class="pflsColor(quote.change)">
          {{ quote.signLabel }} {{ fmtPct(quote.changeRate) }}
        </span>
      </div>
      <p class="mt-1 text-sm" :class="pflsColor(quote.change)">
        {{ quote.change >= 0 ? '+' : '' }}{{ fmtKrw(quote.change) }} (전일 대비)
      </p>

      <div class="mt-4 grid grid-cols-3 gap-2 text-xs">
        <div class="rounded-lg bg-muted/40 p-2">
          <p class="text-muted-foreground">시가</p>
          <p class="font-semibold">{{ fmtKrw(quote.open) }}</p>
        </div>
        <div class="rounded-lg bg-muted/40 p-2">
          <p class="text-muted-foreground">고가</p>
          <p class="font-semibold text-up">{{ fmtKrw(quote.high) }}</p>
        </div>
        <div class="rounded-lg bg-muted/40 p-2">
          <p class="text-muted-foreground">저가</p>
          <p class="font-semibold text-down">{{ fmtKrw(quote.low) }}</p>
        </div>
        <div class="col-span-3 rounded-lg bg-muted/40 p-2">
          <p class="text-muted-foreground">거래량</p>
          <p class="font-semibold">{{ fmtNum(quote.volume) }}주</p>
        </div>
        <div v-if="quote.week52High > 0" class="col-span-3 rounded-lg bg-muted/40 p-2">
          <p class="text-muted-foreground">52주 최저 ~ 최고</p>
          <p class="font-semibold">
            {{ fmtKrw(quote.week52Low) }} ~ {{ fmtKrw(quote.week52High) }}
          </p>
        </div>
        <div v-if="quote.per" class="rounded-lg bg-muted/40 p-2">
          <p class="text-muted-foreground">PER</p>
          <p class="font-semibold">{{ quote.per }}</p>
        </div>
        <div v-if="quote.pbr" class="rounded-lg bg-muted/40 p-2">
          <p class="text-muted-foreground">PBR</p>
          <p class="font-semibold">{{ quote.pbr }}</p>
        </div>
        <div v-if="quote.foreignerRatio > 0" class="rounded-lg bg-muted/40 p-2">
          <p class="text-muted-foreground">외인</p>
          <p class="font-semibold">{{ quote.foreignerRatio.toFixed(2) }}%</p>
        </div>
      </div>

      <div class="mt-4 grid grid-cols-3 gap-2">
        <RouterLink :to="`/chart?code=${code}`">
          <Button variant="outline" size="md" class="w-full">
            <Image class="mr-1 h-4 w-4" />차트
          </Button>
        </RouterLink>
        <RouterLink :to="`/trade/buy?code=${code}`">
          <Button variant="primary" size="md" class="w-full">매수</Button>
        </RouterLink>
        <Button variant="outline" size="md" class="w-full" @click="addWatchlist">
          <Plus class="mr-1 h-4 w-4" />관심
        </Button>
      </div>
    </Card>

    <Card v-else-if="!code">
      <p class="text-sm text-muted-foreground">
        위 검색창에서 종목을 선택하거나 6자리 코드를 입력하세요.
      </p>
    </Card>
  </div>
</template>
