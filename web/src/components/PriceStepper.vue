<script setup lang="ts">
import { computed } from 'vue';
import { Minus, Plus } from 'lucide-vue-next';

const props = withDefaults(
  defineProps<{
    modelValue: number;
    step?: number;
    min?: number;
    max?: number;
    suffix?: string;
    compact?: boolean;
  }>(),
  { step: 10_000, min: 0, suffix: '원', compact: false },
);
const emit = defineEmits<{ 'update:modelValue': [v: number] }>();

const display = computed(() => Math.max(0, props.modelValue).toLocaleString());

function clamp(v: number) {
  let next = Math.max(props.min, v);
  if (props.max !== undefined) next = Math.min(props.max, next);
  return next;
}
function dec() { emit('update:modelValue', clamp(props.modelValue - props.step)); }
function inc() { emit('update:modelValue', clamp(props.modelValue + props.step)); }
function onInput(e: Event) {
  const t = e.target as HTMLInputElement;
  const v = Number(t.value.replace(/[^\d]/g, ''));
  emit('update:modelValue', clamp(isNaN(v) ? 0 : v));
}
</script>

<template>
  <div class="flex items-center" :class="compact ? 'gap-1' : 'gap-2'">
    <button
      type="button"
      class="shrink-0 rounded-full bg-muted text-foreground transition active:scale-95 hover:bg-accent flex items-center justify-center"
      :class="compact ? 'h-8 w-8' : 'h-12 w-12'"
      @click="dec"
    >
      <Minus :class="compact ? 'h-3.5 w-3.5' : 'h-5 w-5'" />
    </button>
    <div
      class="flex flex-1 items-baseline justify-center gap-1 rounded-xl bg-muted/40"
      :class="compact ? 'px-1.5 py-1.5' : 'px-3 py-3'"
    >
      <input
        :value="display"
        type="text"
        inputmode="numeric"
        class="w-full bg-transparent text-center font-bold tabular-nums tracking-tighter focus:outline-none"
        :class="compact ? 'text-sm' : 'text-2xl'"
        @input="onInput"
      />
      <span class="font-semibold text-muted-foreground" :class="compact ? 'text-[10px]' : 'text-sm'">{{ suffix }}</span>
    </div>
    <button
      type="button"
      class="shrink-0 rounded-full bg-muted text-foreground transition active:scale-95 hover:bg-accent flex items-center justify-center"
      :class="compact ? 'h-8 w-8' : 'h-12 w-12'"
      @click="inc"
    >
      <Plus :class="compact ? 'h-3.5 w-3.5' : 'h-5 w-5'" />
    </button>
  </div>
</template>
