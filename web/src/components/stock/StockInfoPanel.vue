<script setup lang="ts">
// StockInfoPanel — 고급 모드 전용. PER/PBR/52주/거래량.
import { computed } from 'vue';
import type { QuoteResponse } from '@/api/client';
import Card from '@/components/ui/Card.vue';

const props = defineProps<{ quote: QuoteResponse | null }>();

function fmt(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '-';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('ko-KR');
}

const items = computed(() => {
  const q = props.quote;
  if (!q) return [];
  return [
    { label: 'PER', value: q.per ? fmt(q.per) : '-' },
    { label: 'PBR', value: q.pbr ? fmt(q.pbr) : '-' },
    {
      label: '52주 최고·최저',
      value: q.week52High > 0 ? `${fmt(q.week52High)} / ${fmt(q.week52Low)}` : '-',
    },
    {
      label: '거래량',
      value: q.volume > 0
        ? q.volume >= 1_000_000 ? `${(q.volume / 1_000_000).toFixed(2)}M` : fmt(q.volume)
        : '-',
    },
  ];
});
</script>

<template>
  <Card v-if="quote">
    <template #header><h3 class="text-sm font-bold tracking-tight">종목 정보</h3></template>
    <div class="grid grid-cols-2 gap-3 text-sm">
      <div v-for="it in items" :key="it.label">
        <p class="text-[10px] text-muted-foreground">{{ it.label }}</p>
        <p class="mt-0.5 font-semibold tabular-nums">{{ it.value }}</p>
      </div>
    </div>
  </Card>
</template>
