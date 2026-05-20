<script setup lang="ts">
// 하단 5탭 네비게이션 — KIS MTS 스타일 (라벨 + 아이콘, 활성 탭 강조).
// 잔고는 홈에서 분리해 보유 종목 + 평가손익 전용 페이지로.
// 메뉴는 설정/전략/도움말 진입점.

import { RouterLink, useRoute } from 'vue-router';
import { Home, Star, ArrowLeftRight, Briefcase, Menu } from 'lucide-vue-next';
import { computed, onMounted, onUnmounted } from 'vue';
import { useOrdersStore } from '@/stores/orders';

const route = useRoute();
const ordersStore = useOrdersStore();

const items = [
  { key: 'home', to: '/', label: '홈', icon: Home, match: ['home'] },
  { key: 'watchlist', to: '/stocks', label: '관심', icon: Star, match: ['stocks', 'stock-detail'] },
  { key: 'orders', to: '/trade', label: '주문', icon: ArrowLeftRight, match: ['trade', 'orders'] },
  { key: 'holdings', to: '/holdings', label: '잔고', icon: Briefcase, match: ['holdings'] },
  { key: 'menu', to: '/settings', label: '메뉴', icon: Menu, match: ['settings', 'strategy-list', 'strategy-new', 'strategy-edit', 'strategy-templates'] },
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
    <ul class="grid grid-cols-5">
      <li v-for="item in items" :key="item.to">
        <RouterLink
          :to="item.to"
          class="relative flex flex-col items-center justify-center gap-1 py-2 text-[10px] tracking-tight transition-colors"
          :class="
            item.match.includes(activeName)
              ? 'text-foreground font-semibold'
              : 'text-muted-foreground/80 hover:text-foreground'
          "
        >
          <div class="relative">
            <component
              :is="item.icon"
              class="h-[22px] w-[22px]"
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
