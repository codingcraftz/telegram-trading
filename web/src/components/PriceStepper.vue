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
  }>(),
  { step: 10_000, min: 0, suffix: '원' },
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
  <div class="flex items-center gap-2">
    <button
      type="button"
      class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition active:scale-95 hover:bg-accent"
      @click="dec"
    >
      <Minus class="h-5 w-5" />
    </button>
    <div class="flex flex-1 items-baseline justify-center gap-1 rounded-2xl bg-muted/40 px-3 py-3">
      <input
        :value="display"
        type="text"
        inputmode="numeric"
        class="w-full bg-transparent text-center text-2xl font-bold tabular-nums tracking-tighter focus:outline-none"
        @input="onInput"
      />
      <span class="text-sm font-semibold text-muted-foreground">{{ suffix }}</span>
    </div>
    <button
      type="button"
      class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition active:scale-95 hover:bg-accent"
      @click="inc"
    >
      <Plus class="h-5 w-5" />
    </button>
  </div>
</template>
