<script setup lang="ts" generic="T extends string | number">
defineProps<{
  modelValue: T;
  options: { value: T; label: string }[];
}>();
const emit = defineEmits<{ 'update:modelValue': [value: T] }>();
</script>

<template>
  <div class="inline-flex w-full rounded-xl bg-muted p-1">
    <button
      v-for="opt in options"
      :key="String(opt.value)"
      type="button"
      class="flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition"
      :class="modelValue === opt.value
        ? 'bg-card text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground'"
      @click="emit('update:modelValue', opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>
