<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { RefreshCw } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import SymbolSearch from '@/components/SymbolSearch.vue';
import TradeChart, { type TradeCandle } from '@/components/TradeChart.vue';
import { api, type SearchItem } from '@/api/client';

const INTERVALS = [
  { key: '1m', label: '1분' },
  { key: '5m', label: '5분' },
  { key: '15m', label: '15분' },
  { key: '30m', label: '30분' },
  { key: '1h', label: '1시간' },
  { key: '4h', label: '4시간' },
  { key: '1d', label: '일봉' },
] as const;

const route = useRoute();
const router = useRouter();
const code = ref<string>((route.query.code as string) ?? '');
const interval = ref<string>((route.query.interval as string) ?? '5m');
const candles = ref<TradeCandle[]>([]);
const loading = ref(false);

async function load() {
  if (!code.value) {
    candles.value = [];
    return;
  }
  loading.value = true;
  try {
    const r = await api.candles(code.value, interval.value, 200);
    candles.value = r.candles;
  } catch (err) {
    console.warn(err);
  } finally {
    loading.value = false;
  }
}

function pickSymbol(item: SearchItem) {
  code.value = item.code;
  router.replace({ query: { code: item.code, interval: interval.value } });
}
function selectInterval(k: string) {
  interval.value = k;
  router.replace({ query: { code: code.value, interval: k } });
}

let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  load();
  // 5초마다 갱신
  timer = setInterval(load, 5_000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});

watch(code, load);
watch(interval, load);
</script>

<template>
  <div class="space-y-3">
    <h2 class="text-lg font-bold">📈 차트</h2>

    <SymbolSearch @pick="pickSymbol" />

    <div v-if="code" class="flex gap-1 overflow-x-auto pb-1">
      <Button
        v-for="i in INTERVALS"
        :key="i.key"
        :variant="i.key === interval ? 'primary' : 'outline'"
        size="sm"
        @click="selectInterval(i.key)"
      >
        {{ i.label }}
      </Button>
      <Button variant="ghost" size="icon" class="ml-auto" :disabled="loading" @click="load">
        <RefreshCw class="h-4 w-4" :class="loading ? 'animate-spin' : ''" />
      </Button>
    </div>

    <Card v-if="code">
      <TradeChart :candles="candles" :height="480" :show-volume="true" />
      <p class="mt-2 text-[11px] text-muted-foreground text-center">
        터치로 zoom·pan · 5초마다 자동 갱신 · 캔들 {{ candles.length }}개
      </p>
    </Card>
    <Card v-else>
      <p class="text-sm text-muted-foreground">
        종목을 검색해서 차트를 보세요.
      </p>
    </Card>
  </div>
</template>
