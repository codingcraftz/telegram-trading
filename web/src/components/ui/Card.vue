<script setup lang="ts">
defineProps<{ title?: string; subtitle?: string }>();
</script>

<template>
  <div class="rounded-xl border border-border bg-card text-card-foreground shadow-sm">
    <div v-if="title || subtitle || $slots.header" class="px-4 pt-4 pb-2">
      <slot name="header">
        <h3 v-if="title" class="text-base font-semibold">{{ title }}</h3>
        <p v-if="subtitle" class="text-xs text-muted-foreground">{{ subtitle }}</p>
      </slot>
    </div>
    <div class="px-4 pb-4 pt-2">
      <slot />
    </div>
  </div>
</template>
