<script setup lang="ts">
// StockDetailHeader — sticky top + 가격 헤드라인 + 실시간 인디케이터. 옛 톤.
import { computed } from 'vue';
import {
  ChevronLeft, ArrowUpRight, ArrowDownRight, Star, StarOff, RefreshCw,
} from 'lucide-vue-next';
import { fmtKrw, fmtPct, pflsColor } from '@/lib/format';

const props = defineProps<{
  code: string;
  name: string;
  price: number;
  changeAmount: number;
  changePct: number;
  isWatched: boolean;
  isStreamLive: boolean;
  loading?: boolean;
}>();

const emit = defineEmits<{ back: []; toggleWatch: []; refresh: [] }>();

const changeText = computed(() => `${props.changeAmount >= 0 ? '+' : ''}${fmtKrw(props.changeAmount)}`);
</script>

<template>
  <div class="sticky top-0 z-20 -mx-4 border-b border-border/60 bg-background/90 px-4 backdrop-blur">
    <!-- 상단 줄 -->
    <div class="flex items-center gap-1 py-2">
      <button
        class="-ml-2 rounded-md p-2 text-muted-foreground transition hover:bg-accent"
        @click="emit('back')"
      >
        <ChevronLeft class="h-5 w-5" />
      </button>
      <div class="min-w-0 flex-1 px-1">
        <h2 class="truncate text-base font-bold tracking-tight">{{ name }}</h2>
        <p class="text-[10px] text-muted-foreground tabular-nums">{{ code }}</p>
      </div>
      <button
        class="rounded-md p-2 text-muted-foreground transition hover:bg-accent"
        :disabled="loading"
        @click="emit('refresh')"
      >
        <RefreshCw class="h-4 w-4" :class="loading ? 'animate-spin' : ''" />
      </button>
      <button
        class="-mr-2 rounded-md p-2 text-muted-foreground transition hover:bg-accent"
        @click="emit('toggleWatch')"
      >
        <Star v-if="isWatched" class="h-5 w-5 fill-amber-400 text-amber-400" />
        <StarOff v-else class="h-5 w-5" />
      </button>
    </div>

    <!-- 가격 헤드라인 -->
    <div class="flex items-end justify-between gap-3 pb-3">
      <div class="min-w-0">
        <p class="text-[2.2rem] font-bold leading-none tabular-nums tracking-tighter">{{ fmtKrw(price) }}</p>
        <div class="mt-2 flex items-center gap-1.5 text-sm">
          <ArrowUpRight v-if="changeAmount > 0" class="h-4 w-4 text-up" />
          <ArrowDownRight v-else-if="changeAmount < 0" class="h-4 w-4 text-down" />
          <span class="font-semibold tabular-nums" :class="pflsColor(changeAmount)">{{ changeText }}</span>
          <span class="text-xs font-semibold tabular-nums" :class="pflsColor(changeAmount)">({{ fmtPct(changePct) }})</span>
          <span class="ml-1 text-[11px] text-muted-foreground">어제보다</span>
        </div>
      </div>
      <span class="inline-flex shrink-0 items-center gap-1 self-start rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
        <span class="inline-block h-1.5 w-1.5 rounded-full" :class="isStreamLive ? 'bg-emerald-500' : 'bg-zinc-400'" />
        {{ isStreamLive ? '실시간' : '지연' }}
      </span>
    </div>
  </div>
</template>
