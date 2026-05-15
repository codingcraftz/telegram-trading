<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';
import { RefreshCw, Plus, Pause, Play } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import SymbolSearch from '@/components/SymbolSearch.vue';
import { api, type QuoteResponse, type SearchItem } from '@/api/client';
import { fmtKrw, fmtNum, fmtPct, pflsColor } from '@/lib/format';

const INTERVALS = [
  { key: '1m', label: '1분' },
  { key: '5m', label: '5분' },
  { key: '15m', label: '15분' },
  { key: '1h', label: '1시간' },
  { key: '1d', label: '일봉' },
] as const;

const route = useRoute();
const router = useRouter();
const code = ref<string>((route.query.code as string) ?? '');
const interval = ref<string>('1d');
const quote = ref<QuoteResponse | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const chartTick = ref(0);

// 자동 폴링 (가격 + 차트)
const paused = ref(false);
const intervalSec = ref(3);
let pollTimer: ReturnType<typeof setInterval> | null = null;

const chartUrl = computed(() =>
  code.value ? `${api.chartUrl(code.value, interval.value)}&t=${chartTick.value}` : '',
);

async function load() {
  if (!code.value) {
    quote.value = null;
    return;
  }
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

async function refreshAll() {
  await load();
  chartTick.value++;
}

function startPolling() {
  stopPolling();
  if (paused.value || !code.value) return;
  pollTimer = setInterval(() => {
    // 가격만 폴링, 차트는 30초마다
    load();
    if (chartTick.value % 10 === 0) chartTick.value++;
    chartTick.value++;
  }, intervalSec.value * 1000);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
function togglePause() {
  paused.value = !paused.value;
  if (paused.value) stopPolling();
  else startPolling();
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

watch(code, () => {
  load();
  chartTick.value++;
  startPolling();
});
watch(intervalSec, () => startPolling());
watch(interval, () => chartTick.value++);

onMounted(() => {
  load();
  startPolling();
});
onUnmounted(stopPolling);
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
          <div class="flex gap-1">
            <Button variant="ghost" size="icon" :disabled="loading" @click="refreshAll">
              <RefreshCw class="h-4 w-4" :class="loading ? 'animate-spin' : ''" />
            </Button>
          </div>
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

      <!-- 폴링 컨트롤 -->
      <div class="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>🔄 {{ paused ? '일시정지' : `${intervalSec}초마다 자동 갱신` }}</span>
        <div class="flex gap-1">
          <Button
            v-for="sec in [1, 3, 5]"
            :key="sec"
            :variant="intervalSec === sec ? 'primary' : 'outline'"
            size="sm"
            @click="intervalSec = sec"
          >
            {{ sec }}s
          </Button>
          <Button variant="ghost" size="icon" @click="togglePause">
            <Pause v-if="!paused" class="h-4 w-4" />
            <Play v-else class="h-4 w-4" />
          </Button>
        </div>
      </div>

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

      <div class="mt-4 grid grid-cols-2 gap-2">
        <RouterLink :to="`/trade/buy?code=${code}`">
          <Button variant="primary" size="md" class="w-full">📥 매수</Button>
        </RouterLink>
        <Button variant="outline" size="md" class="w-full" @click="addWatchlist">
          <Plus class="mr-1 h-4 w-4" />관심 추가
        </Button>
      </div>
    </Card>

    <!-- 차트 인라인 -->
    <Card v-if="code">
      <template #header>
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold">📈 차트</h3>
          <div class="flex gap-1">
            <Button
              v-for="i in INTERVALS"
              :key="i.key"
              :variant="i.key === interval ? 'primary' : 'outline'"
              size="sm"
              @click="interval = i.key"
            >
              {{ i.label }}
            </Button>
          </div>
        </div>
      </template>
      <img :src="chartUrl" :alt="`${code} ${interval}`" class="w-full rounded-lg" loading="lazy" />
    </Card>

    <Card v-else>
      <p class="text-sm text-muted-foreground">
        위 검색창에서 종목을 선택하거나 6자리 코드를 입력하세요.
      </p>
    </Card>
  </div>
</template>
