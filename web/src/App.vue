<script setup lang="ts">
import { RouterView } from 'vue-router';
import AppHeader from '@/components/layout/AppHeader.vue';
import BottomNav from '@/components/layout/BottomNav.vue';
import Toaster from '@/components/ui/Toaster.vue';
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
