<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterView } from 'vue-router';
import AppHeader from '@/components/layout/AppHeader.vue';
import BottomNav from '@/components/layout/BottomNav.vue';
import Toaster from '@/components/ui/Toaster.vue';
import { api } from '@/api/client';

// 앱 부팅 시 prefetch — 서버 캐시 hit 유도. 결과는 무시 (각 페이지가 다시 fetch하지만 그땐 캐시).
onMounted(() => {
  api.balance().catch(() => {});
  api.indices().catch(() => {});
  api.orders().catch(() => {});
});
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-md flex-col bg-background">
    <AppHeader />
    <main class="flex-1 pb-20 px-4 pt-3">
      <RouterView v-slot="{ Component }">
        <component :is="Component" />
      </RouterView>
    </main>
    <BottomNav />
    <Toaster />
  </div>
</template>
