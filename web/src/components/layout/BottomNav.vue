<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router';
import { Home, LineChart, ListOrdered, Settings as SettingsIcon } from 'lucide-vue-next';
import { computed, onMounted, onUnmounted } from 'vue';
import { useOrdersStore } from '@/stores/orders';

const route = useRoute();
const ordersStore = useOrdersStore();
const items = [
  { key: 'home', to: '/', label: '홈', icon: Home, match: ['home'] },
  { key: 'stocks', to: '/stocks', label: '종목', icon: LineChart, match: ['stocks', 'stock-detail'] },
  { key: 'orders', to: '/orders', label: '주문', icon: ListOrdered, match: ['orders'] },
  { key: 'settings', to: '/settings', label: '설정', icon: SettingsIcon, match: ['settings'] },
];

const activeName = computed(() => (route.name as string) ?? '');

// 미체결 카운트 뱃지용 — 백그라운드 폴링 (페이지 안에서 또 호출돼도 subscriber count로 1번만 동작)
onMounted(() => ordersStore.subscribe(8000));
onUnmounted(() => ordersStore.unsubscribe());
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
          class="relative flex flex-col items-center justify-center py-2.5 text-[11px] transition-colors"
          :class="
            item.match.includes(activeName)
              ? 'text-primary font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          "
        >
          <div class="relative">
            <component :is="item.icon" class="h-5 w-5 mb-0.5" :stroke-width="2" />
            <span
              v-if="item.key === 'orders' && ordersStore.count > 0"
              class="absolute -right-2 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold leading-none text-primary-foreground"
            >
              {{ ordersStore.count > 99 ? '99+' : ordersStore.count }}
            </span>
          </div>
          <span>{{ item.label }}</span>
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>
