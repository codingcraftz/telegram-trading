<script setup lang="ts">
import type { FunctionalComponent } from 'vue';

defineProps<{
  icon: FunctionalComponent;
  title: string;
  description?: string;
}>();
</script>

<template>
  <div class="flex flex-col items-center justify-center rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 px-6 py-10 text-center">
    <div class="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <component :is="icon" class="h-6 w-6" />
    </div>
    <p class="text-sm font-semibold">{{ title }}</p>
    <p v-if="description" class="mt-1.5 max-w-[16rem] text-xs leading-relaxed text-muted-foreground">{{ description }}</p>
    <div v-if="$slots.action" class="mt-4">
      <slot name="action" />
    </div>
  </div>
</template>
