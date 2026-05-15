<script setup lang="ts">
defineProps<{
  title: string;
  count?: number | null;
}>();
</script>

<template>
  <div class="flex items-center justify-between px-1">
    <h3 class="text-sm font-bold tracking-tight">
      {{ title }}
      <span v-if="count !== null && count !== undefined" class="ml-1 font-semibold text-muted-foreground tabular-nums">{{ count }}</span>
    </h3>
    <div class="text-xs">
      <slot name="action" />
    </div>
  </div>
</template>
