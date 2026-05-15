<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router';
import { Home, Wallet, ListOrdered, Star, Settings as SettingsIcon } from 'lucide-vue-next';
import { computed } from 'vue';

const route = useRoute();
const items = [
  { to: '/', label: '홈', icon: Home, match: ['home'] },
  { to: '/balance', label: '잔고', icon: Wallet, match: ['balance'] },
  { to: '/orders', label: '주문', icon: ListOrdered, match: ['orders'] },
  { to: '/watchlist', label: '관심', icon: Star, match: ['watchlist'] },
  { to: '/settings', label: '설정', icon: SettingsIcon, match: ['settings'] },
];

const activeName = computed(() => (route.name as string) ?? '');
</script>

<template>
  <nav
    class="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md border-t border-border bg-card/95 backdrop-blur"
    style="padding-bottom: env(safe-area-inset-bottom);"
  >
    <ul class="grid grid-cols-5">
      <li v-for="item in items" :key="item.to">
        <RouterLink
          :to="item.to"
          class="flex flex-col items-center justify-center py-2 text-[11px] transition-colors"
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
