<script setup lang="ts">
// OrderCard — 대기 주문 통합 카드 (unfilled / morning / strategy). 옛 톤.
import { computed } from 'vue';
import Button from '@/components/ui/Button.vue';

export type OrderCardType = 'unfilled' | 'morning' | 'strategy';

const props = defineProps<{
  type: OrderCardType;
  side: 'buy' | 'sell';
  name: string;
  code: string;
  typeLabel: string;
  middleLine: string;
  action1Label?: string;
  action2Label?: string;
  trailingMeta?: string;
}>();
const emit = defineEmits<{ open: []; action1: []; action2: [] }>();

const dotColor = computed(() => {
  switch (props.type) {
    case 'unfilled': return 'bg-zinc-400';
    case 'morning': return 'bg-amber-500';
    case 'strategy': return 'bg-primary';
  }
});

const sideStyle = computed(() => props.side === 'buy' ? 'bg-up text-white' : 'bg-down text-white');
</script>

<template>
  <div
    class="relative flex cursor-pointer gap-3 rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 px-4 py-3.5 transition active:scale-[0.99]"
    role="button"
    tabindex="0"
    @click="emit('open')"
  >
    <div class="my-1 w-[3px] shrink-0 rounded-full" :class="dotColor" />
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-1.5">
        <span class="text-[10px] text-muted-foreground">{{ typeLabel }}</span>
        <span
          class="rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none"
          :class="sideStyle"
        >
          {{ side === 'buy' ? '매수' : '매도' }}
        </span>
        <span v-if="trailingMeta" class="ml-auto text-[10px] text-muted-foreground tabular-nums">{{ trailingMeta }}</span>
      </div>
      <div class="mt-1 flex items-baseline gap-1.5">
        <p class="truncate text-sm font-bold">{{ name }}</p>
        <span class="text-[10px] text-muted-foreground tabular-nums">{{ code }}</span>
      </div>
      <p class="mt-0.5 text-xs text-muted-foreground tabular-nums">{{ middleLine }}</p>

      <div
        v-if="action1Label || action2Label"
        class="mt-3 flex items-center justify-end gap-1.5"
        @click.stop
      >
        <Button v-if="action1Label" variant="secondary" size="sm" @click.stop="emit('action1')">{{ action1Label }}</Button>
        <Button v-if="action2Label" variant="ghost" size="sm" @click.stop="emit('action2')">{{ action2Label }}</Button>
      </div>
    </div>
  </div>
</template>
