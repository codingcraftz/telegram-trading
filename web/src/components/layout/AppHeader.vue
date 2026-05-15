<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { api, type SessionResponse } from '@/api/client';

const session = ref<SessionResponse | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;

async function load() {
  try {
    session.value = await api.session();
  } catch {
    /* silent */
  }
}

const dotColor = computed(() => {
  const s = session.value?.session;
  if (s === 'regular') return 'bg-emerald-400';
  if (s === 'closed' || s === 'holiday') return 'bg-zinc-500';
  return 'bg-amber-400';
});

onMounted(() => {
  load();
  timer = setInterval(load, 60_000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <header class="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-lg">
    <div class="flex h-14 items-center justify-between px-5">
      <h1 class="text-base font-bold tracking-tighter">OWLIM STOCK</h1>
      <div v-if="session" class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span class="relative flex h-2 w-2">
          <span
            v-if="session.session === 'regular'"
            class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60"
          />
          <span class="relative inline-flex h-2 w-2 rounded-full" :class="dotColor" />
        </span>
        <span>{{ session.label }}</span>
      </div>
    </div>
  </header>
</template>
