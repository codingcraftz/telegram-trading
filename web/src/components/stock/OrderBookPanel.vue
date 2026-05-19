<script setup lang="ts">
// OrderBookPanel — 옛 OrderBook 컴포넌트를 5/10단 토글과 함께 wrap.
import { computed, ref, watch } from 'vue';
import OrderBook from '@/components/OrderBook.vue';
import Card from '@/components/ui/Card.vue';
import { usePrefs } from '@/stores/prefs';

const props = defineProps<{ code: string }>();
const emit = defineEmits<{ pickPrice: [number] }>();

const prefs = usePrefs();
const isAdvanced = computed(() => prefs.mode === 'advanced');

const depth = ref<5 | 10>(5);
watch(isAdvanced, (a) => { if (!a) depth.value = 5; });
</script>

<template>
  <Card>
    <template #header>
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-bold tracking-tight">호가</h3>
        <div v-if="isAdvanced" class="inline-flex rounded-full bg-muted p-0.5">
          <button
            v-for="d in [5, 10] as const"
            :key="d"
            class="rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition"
            :class="depth === d ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'"
            @click="depth = d"
          >
            {{ d }}단
          </button>
        </div>
      </div>
    </template>
    <OrderBook
      :code="code"
      :levels="depth"
      :interval-ms="1500"
      @pick-price="(p) => emit('pickPrice', p)"
    />
  </Card>
</template>
