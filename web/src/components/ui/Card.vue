<script setup lang="ts">
defineProps<{ title?: string; subtitle?: string }>();
</script>

<template>
  <section class="rounded-2xl bg-card">
    <div v-if="title || subtitle || $slots.header" class="px-4 pt-4 pb-2">
      <slot name="header">
        <h3 v-if="title" class="text-sm font-semibold tracking-tight text-foreground">{{ title }}</h3>
        <p v-if="subtitle" class="mt-0.5 text-xs text-muted-foreground">{{ subtitle }}</p>
      </slot>
    </div>
    <div class="px-4 pb-4 pt-2">
      <slot />
    </div>
  </section>
</template>
