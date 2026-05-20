<script setup lang="ts">
// 전략 목록. 옛 톤.
import { ref, onMounted } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { ChevronLeft, Plus, NotebookPen, AlertTriangle } from 'lucide-vue-next';
import Button from '@/components/ui/Button.vue';
import EmptyState from '@/components/EmptyState.vue';
import { api, type StrategyItem, type StrategyDefinition } from '@/api/client';
import { toast } from '@/lib/toast';

const router = useRouter();

const items = ref<StrategyItem[]>([]);
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    const r = await api.strategies();
    items.value = r.items;
  } catch (err) {
    toast.error((err as Error).message);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// 카드 요약 문자열
function summarize(def: StrategyDefinition): string {
  const parts: string[] = [];

  // entry + quantity + exit (entry type별 다름)
  if (def.entry.type === 'morning_staged') {
    const e = def.entry;
    const bud = e.budget.mode === 'fixed_amount'
      ? `${e.budget.value.toLocaleString()}원`
      : `예수금 ${Math.round(e.budget.value * 100)}%`;
    parts.push(`시가매매 · ${bud}`);
    if (e.stages.length > 1 && e.stages[1]?.triggerDropPct) {
      parts.push(`${e.stages[0]?.entryPct}/${e.stages[1]?.entryPct}% · 물타기 -${e.stages[1].triggerDropPct}%`);
    }
    const tp1 = e.takeProfit?.tp1?.enabled ? `TP1 +${e.takeProfit.tp1.atPct}% (${e.takeProfit.tp1.sellPct}%)` : '';
    const tp2 = e.takeProfit?.tp2?.enabled ? `TP2 +${e.takeProfit.tp2.atPct}%` : '';
    const sl = e.stopLoss?.enabled ? `SL -${e.stopLoss.atPct}%` : '';
    const exit = [tp1, tp2, sl].filter(Boolean).join(' / ');
    if (exit) parts.push(exit);
    return parts.join(' · ');
  }

  if (def.entry.type === 'morning') parts.push('시가매매(단순)');
  else parts.push(`지정가 ${def.entry.targetPrice.toLocaleString()}원 ${def.entry.direction === 'above' ? '↑' : '↓'}`);

  if (def.quantity.mode === 'fixed_shares') parts.push(`${def.quantity.value}주`);
  else if (def.quantity.mode === 'fixed_amount') parts.push(`${def.quantity.value.toLocaleString()}원어치`);
  else parts.push(`예수금 ${Math.round(def.quantity.value * 100)}%`);

  const tp = def.exit?.takeProfit?.enabled ? `TP +${def.exit.takeProfit.pct}%` : '';
  const sl = def.exit?.stopLoss?.enabled ? `SL -${def.exit.stopLoss.pct}%` : '';
  if (tp || sl) parts.push([tp, sl].filter(Boolean).join(' / '));

  return parts.join(' · ');
}

async function toggleActive(s: StrategyItem) {
  // optimistic
  const prev = s.active;
  s.active = !prev;
  try {
    const r = await api.toggleStrategy(s.id, !prev);
    s.active = r.active;
  } catch (err) {
    s.active = prev;
    toast.error((err as Error).message);
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- 헤더 -->
    <div class="sticky top-0 z-10 -mx-4 border-b border-border/60 bg-background/90 px-4 backdrop-blur">
      <div class="flex items-center gap-1 py-3">
        <button
          class="-ml-2 rounded-md p-2 text-muted-foreground transition hover:bg-accent"
          @click="router.push('/settings')"
        >
          <ChevronLeft class="h-5 w-5" />
        </button>
        <h2 class="flex-1 truncate px-1 text-base font-bold tracking-tight">내 전략</h2>
        <RouterLink
          to="/more/strategy/new"
          class="-mr-2 flex h-9 w-9 items-center justify-center rounded-full text-primary transition hover:bg-accent"
          aria-label="새 전략"
        >
          <Plus class="h-5 w-5" />
        </RouterLink>
      </div>
    </div>

    <!-- 리스트 -->
    <div v-if="items.length > 0" class="space-y-1.5">
      <div
        v-for="s in items"
        :key="s.id"
        class="cursor-pointer rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 px-4 py-3.5 transition active:scale-[0.99]"
        @click="router.push(`/more/strategy/${s.id}`)"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="truncate text-base font-bold tracking-tight">{{ s.name }}</p>
            <p class="mt-0.5 truncate text-[11px] text-muted-foreground">{{ summarize(s.definition) }}</p>
            <p class="mt-1.5 text-[10px] text-muted-foreground tabular-nums">
              <span v-if="s.applicationCount > 0">적용 종목 {{ s.applicationCount }}개</span>
              <span v-else>적용 안 됨</span>
            </p>
          </div>
          <!-- 토글 -->
          <label class="shrink-0 self-start pt-1" @click.stop>
            <input
              type="checkbox"
              :checked="s.active"
              class="peer sr-only"
              @change="toggleActive(s)"
            />
            <span class="relative inline-flex h-5 w-9 cursor-pointer items-center rounded-full bg-muted transition peer-checked:bg-primary">
              <span
                class="inline-block h-4 w-4 transform rounded-full bg-card shadow transition"
                :class="s.active ? 'translate-x-[1.125rem]' : 'translate-x-0.5'"
              />
            </span>
          </label>
        </div>
      </div>
    </div>

    <EmptyState
      v-else-if="!loading"
      :icon="NotebookPen"
      title="아직 만든 전략이 없어요"
      description="자주 쓰는 매수 패턴을 전략으로 만들어두면 종목에 적용해 자동으로 발동시킬 수 있어요."
    >
      <template #action>
        <div class="flex flex-col items-center gap-2">
          <RouterLink to="/more/strategy/new">
            <Button variant="primary" size="md">
              <Plus class="mr-1 h-3.5 w-3.5" />
              새 전략 만들기
            </Button>
          </RouterLink>
          <RouterLink to="/more/strategy/templates" class="text-[11px] text-muted-foreground transition hover:text-foreground">
            템플릿 둘러보기
          </RouterLink>
        </div>
      </template>
    </EmptyState>

    <div v-else class="space-y-1.5">
      <div v-for="n in 3" :key="n" class="h-[100px] animate-pulse rounded-2xl bg-card" />
    </div>
  </div>
</template>
