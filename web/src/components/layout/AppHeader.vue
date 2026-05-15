<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { api, type SessionResponse } from '@/api/client';

const session = ref<SessionResponse | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;

async function load() {
  try {
    session.value = await api.session();
  } catch (err) {
    console.warn('session load failed:', err);
  }
}

onMounted(() => {
  load();
  // 60초마다 세션 갱신 (KIS API 부담 X — 세션은 calendar 계산만)
  timer = setInterval(load, 60_000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <header class="sticky top-0 z-20 border-b border-border bg-card/80 backdrop-blur">
    <div class="flex h-14 items-center justify-between px-4">
      <h1 class="text-base font-bold tracking-tight">
        📈 OWLIM STOCK
        <span class="text-xs font-normal text-muted-foreground">매매도우미</span>
      </h1>
      <div v-if="session" class="text-xs font-medium">
        <span>{{ session.icon }}</span>
        <span class="ml-1">{{ session.label }}</span>
      </div>
    </div>
  </header>
</template>
