<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { RouterView } from 'vue-router';
import AppHeader from '@/components/layout/AppHeader.vue';
import BottomNav from '@/components/layout/BottomNav.vue';
import Toaster from '@/components/ui/Toaster.vue';
import { api } from '@/api/client';
import { toast } from '@/lib/toast';

// 앱 부팅 시 prefetch — 서버 캐시 hit 유도. 결과는 무시 (각 페이지가 다시 fetch하지만 그땐 캐시).
onMounted(() => {
  api.balance().catch(() => {});
  api.indices().catch(() => {});
  api.orders().catch(() => {});
});

// 자동 업데이트 감지 — 30초마다 /api/version 폴링. 첫 응답 sha 기억 후 변경 감지 시
// 토스트 + 5초 후 자동 reload (사용자가 보던 화면 잠깐만 끄게).
const initialSha = ref<string | null>(null);
let versionTimer: ReturnType<typeof setInterval> | null = null;
let reloading = false;

async function pollVersion() {
  try {
    const v = await api.version();
    if (initialSha.value === null) {
      initialSha.value = v.sha;
      return;
    }
    if (v.sha !== initialSha.value && !reloading) {
      reloading = true;
      toast.success('새 버전이 적용됐어요. 5초 후 새로고침할게요.');
      setTimeout(() => {
        try { location.reload(); } catch {}
      }, 5000);
    }
  } catch { /* 네트워크 일시 오류 — 다음 폴링에서 다시 */ }
}

onMounted(() => {
  pollVersion();
  versionTimer = setInterval(pollVersion, 30_000);
});
onUnmounted(() => {
  if (versionTimer) clearInterval(versionTimer);
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
