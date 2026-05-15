<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router';
import { Home, LineChart, ListOrdered, Settings as SettingsIcon } from 'lucide-vue-next';
import { computed } from 'vue';

const route = useRoute();
const items = [
  { to: '/', label: '홈', icon: Home, match: ['home'] },
  { to: '/stocks', label: '종목', icon: LineChart, match: ['stocks', 'stock-detail'] },
  { to: '/orders', label: '주문', icon: ListOrdered, match: ['orders'] },
  { to: '/settings', label: '설정', icon: SettingsIcon, match: ['settings'] },
];

const activeName = computed(() => (route.name as string) ?? '');
</script>

<template>
  <nav
    class="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md border-t border-border bg-background/95 backdrop-blur"
    style="padding-bottom: env(safe-area-inset-bottom);"
  >
    <ul class="grid grid-cols-4">
      <li v-for="item in items" :key="item.to">
        <RouterLink
          :to="item.to"
          class="flex flex-col items-center justify-center py-2.5 text-[11px] transition-colors"
          :class="
            item.match.includes(activeName)
              ? 'text-primary font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          "
        >
          <component :is="item.icon" class="h-5 w-5 mb-0.5" :stroke-width="2" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>
