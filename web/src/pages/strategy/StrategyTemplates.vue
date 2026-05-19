<script setup lang="ts">
// 전략 템플릿 — placeholder. 추후 본격 구성.
import { useRouter } from 'vue-router';
import { ChevronLeft, Sparkles, Plus } from 'lucide-vue-next';
import Button from '@/components/ui/Button.vue';
import { RouterLink } from 'vue-router';

const router = useRouter();

// 단순 시드 템플릿 — 새 전략 페이지로 전달
type Template = {
  key: string;
  name: string;
  desc: string;
  query: string; // URL query string for editor prefill (stringified definition)
};

const templates: Template[] = [
  {
    key: 'morning_amount',
    name: '시가매매 — 100만원어치',
    desc: '다음 영업일 09:00 시가에 100만원어치 시장가 매수',
    query: encodeURIComponent(
      JSON.stringify({
        entry: { type: 'morning' },
        order: { method: 'market' },
        quantity: { mode: 'fixed_amount', value: 1_000_000 },
        validity: { type: 'forever' },
      }),
    ),
  },
  {
    key: 'morning_tp_sl',
    name: '시가매매 + 자동매도',
    desc: '시가매매 + TP 5% / SL 3%',
    query: encodeURIComponent(
      JSON.stringify({
        entry: { type: 'morning' },
        order: { method: 'market' },
        quantity: { mode: 'cash_ratio', value: 0.25 },
        exit: {
          takeProfit: { enabled: true, pct: 5 },
          stopLoss: { enabled: true, pct: 3 },
        },
        validity: { type: 'forever' },
      }),
    ),
  },
  {
    key: 'limit_above',
    name: '지정가 돌파 매수',
    desc: '목표가 이상 도달 시 시장가 매수',
    query: encodeURIComponent(
      JSON.stringify({
        entry: { type: 'limit_price', targetPrice: 50_000, direction: 'above' },
        order: { method: 'market' },
        quantity: { mode: 'fixed_shares', value: 10 },
        validity: { type: 'once' },
      }),
    ),
  },
];
</script>

<template>
  <div class="space-y-4">
    <div class="sticky top-0 z-10 -mx-4 border-b border-border/60 bg-background/90 px-4 backdrop-blur">
      <div class="flex items-center gap-1 py-3">
        <button
          class="-ml-2 rounded-md p-2 text-muted-foreground transition hover:bg-accent"
          @click="router.push('/more/strategy')"
        >
          <ChevronLeft class="h-5 w-5" />
        </button>
        <h2 class="flex-1 truncate px-1 text-base font-bold tracking-tight">전략 템플릿</h2>
      </div>
    </div>

    <p class="px-1 text-[11px] text-muted-foreground">
      자주 쓰는 전략을 시작점으로 가져와 편집할 수 있어요.
    </p>

    <div class="space-y-1.5">
      <RouterLink
        v-for="t in templates"
        :key="t.key"
        :to="`/more/strategy/new?from=${t.query}`"
        class="block cursor-pointer rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 px-4 py-3.5 transition active:scale-[0.99]"
      >
        <div class="flex items-start gap-2.5">
          <Sparkles class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-bold">{{ t.name }}</p>
            <p class="mt-0.5 text-[11px] text-muted-foreground">{{ t.desc }}</p>
          </div>
        </div>
      </RouterLink>
    </div>

    <div class="pt-4 text-center">
      <RouterLink to="/more/strategy/new">
        <Button variant="secondary" size="md">
          <Plus class="mr-1 h-3.5 w-3.5" />
          빈 전략으로 시작
        </Button>
      </RouterLink>
    </div>
  </div>
</template>
