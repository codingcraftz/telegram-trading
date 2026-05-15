<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { RefreshCw } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import SymbolSearch from '@/components/SymbolSearch.vue';
import { api, type SearchItem } from '@/api/client';

const INTERVALS = [
  { key: '1m', label: '1분' },
  { key: '5m', label: '5분' },
  { key: '15m', label: '15분' },
  { key: '1h', label: '1시간' },
  { key: '4h', label: '4시간' },
  { key: '1d', label: '일봉' },
] as const;

const route = useRoute();
const router = useRouter();
const code = ref<string>((route.query.code as string) ?? '');
const interval = ref<string>((route.query.interval as string) ?? '1d');
const tick = ref(0); // 새로고침 트리거

const imgSrc = computed(() =>
  code.value
    ? `${api.chartUrl(code.value, interval.value)}&t=${tick.value}`
    : '',
);

function pickSymbol(item: SearchItem) {
  code.value = item.code;
  router.replace({ query: { code: item.code, interval: interval.value } });
}

function selectInterval(k: string) {
  interval.value = k;
  router.replace({ query: { code: code.value, interval: k } });
  tick.value++;
}

function refresh() {
  tick.value++;
}

watch(() => route.query, (q) => {
  code.value = (q.code as string) ?? '';
  interval.value = (q.interval as string) ?? '1d';
});
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
      <Button variant="ghost" size="icon" class="ml-auto" @click="refresh">
        <RefreshCw class="h-4 w-4" />
      </Button>
    </div>

    <Card v-if="code">
      <img
        :src="imgSrc"
        :alt="`${code} ${interval} 차트`"
        class="w-full rounded-lg"
        loading="lazy"
      />
    </Card>
    <Card v-else>
      <p class="text-sm text-muted-foreground">
        종목을 검색해서 차트를 보세요.
      </p>
    </Card>
  </div>
</template>
