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

// 자동 reload 는 제거됨. PWA 자체 reload 가 service worker 캐시 / iOS 제약 등으로
// 일관되지 않아 사용자 경험이 불안정 → 업데이트 진행 오버레이 + '끄고 다시 켜주세요' 안내로 대체.
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-md flex-col bg-background">
    <AppHeader />
    <main class="flex-1 pb-24 px-4 pt-3">
      <!-- KeepAlive — 페이지를 메모리에 캐시해서 BottomNav 전환 시 layout shift 없게.
           재진입 시 onActivated 호출 (mount 안 함) → 첫 로딩 후엔 점프 없이 즉시 표시.
           StockDetail (/stocks/:code) 는 같은 컴포넌트 재사용 + watch(code) 로 fresh fetch. -->
      <RouterView v-slot="{ Component }">
        <KeepAlive :max="10">
          <component :is="Component" />
        </KeepAlive>
      </RouterView>
    </main>
    <BottomNav />
    <Toaster />
  </div>
</template>
