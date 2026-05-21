<script setup lang="ts">
// 하단 6탭 네비게이션 — 홈 / 관심 / 차트 / 주문 / 잔고 / 메뉴.
// KIS MTS 스타일.

import { RouterLink, useRoute } from 'vue-router';
import { Home, Star, LineChart, ArrowLeftRight, Briefcase, Menu } from 'lucide-vue-next';
import { computed, onMounted, onUnmounted } from 'vue';
import { useOrdersStore } from '@/stores/orders';

const route = useRoute();
const ordersStore = useOrdersStore();

// 활성 탭 재클릭 시 navigation 막기 — 같은 path 라도 query 가 reset 되면서
// Trade.vue 의 tab ref 가 'order' default 로 강제 변경 → 일시 빈 화면 발생.
function onTabClick(e: MouseEvent, item: typeof items[number]) {
  if (item.match.includes(activeName.value)) {
    e.preventDefault();
  }
}

const items = [
  { key: 'home', to: '/', label: '홈', icon: Home, match: ['home'] },
  { key: 'watchlist', to: '/stocks', label: '관심', icon: Star, match: ['stocks'] },
  { key: 'chart', to: '/chart', label: '차트', icon: LineChart, match: ['chart', 'stock-detail'] },
  { key: 'orders', to: '/trade', label: '주문', icon: ArrowLeftRight, match: ['trade', 'orders'] },
  { key: 'holdings', to: '/holdings', label: '잔고', icon: Briefcase, match: ['holdings'] },
  { key: 'menu', to: '/settings', label: '메뉴', icon: Menu, match: ['settings', 'strategy-list', 'strategy-new', 'strategy-edit', 'strategy-templates'] },
];

const activeName = computed(() => (route.name as string) ?? '');

onMounted(() => ordersStore.subscribe(8000));
onUnmounted(() => ordersStore.unsubscribe());
</script>

<template>
  <nav
    class="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md border-t border-border bg-background/95 backdrop-blur"
    style="padding-bottom: env(safe-area-inset-bottom);"
  >
    <ul class="grid grid-cols-6">
      <li v-for="item in items" :key="item.to">
        <RouterLink
          :to="item.to"
          class="relative flex flex-col items-center justify-center gap-0.5 py-2 text-[9.5px] tracking-tight transition-colors"
          :class="
            item.match.includes(activeName)
              ? 'text-foreground font-semibold'
              : 'text-muted-foreground/80 hover:text-foreground'
          "
          @click="onTabClick($event, item)"
        >
          <div class="relative">
            <component
              :is="item.icon"
              class="h-[20px] w-[20px]"
              :stroke-width="item.match.includes(activeName) ? 2.4 : 1.8"
              :fill="item.key === 'watchlist' && item.match.includes(activeName) ? 'currentColor' : 'none'"
            />
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
