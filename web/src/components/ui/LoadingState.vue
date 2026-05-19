<script setup lang="ts">
// LoadingState — 펄스 SVG + 회전 의미 메시지.
// 사용자가 "멈춘 게 아니다" 인지하도록.
import { ref, onMounted, onUnmounted } from 'vue';

const props = withDefaults(
  defineProps<{
    messages?: string[];
    rotateMs?: number;
    compact?: boolean;
  }>(),
  {
    messages: () => [
      '증권사 응답을 기다리는 중…',
      '조금만 더 기다려주세요…',
      '응답이 늦네요. 다시 시도하고 있어요',
      '거의 다 됐어요…',
    ],
    rotateMs: 1500,
    compact: false,
  },
);

const idx = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  timer = setInterval(() => {
    if (idx.value < props.messages.length - 1) idx.value += 1;
  }, props.rotateMs);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div
    class="flex flex-col items-center justify-center gap-3 rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0"
    :class="compact ? 'px-4 py-6' : 'px-5 py-10'"
  >
    <!-- 펄스 SVG: 동심원이 시차로 확장하며 페이드 -->
    <div class="relative h-10 w-10">
      <span class="absolute inset-0 animate-ping-slow rounded-full bg-primary/30" />
      <span class="absolute inset-1 animate-ping-mid rounded-full bg-primary/40" />
      <span class="absolute inset-2 rounded-full bg-primary/70" />
    </div>
    <p class="text-[12px] font-medium text-muted-foreground transition-opacity duration-300">
      {{ messages[idx] }}
    </p>
  </div>
</template>

<style scoped>
@keyframes ping-slow {
  0% { transform: scale(0.7); opacity: 0.8; }
  80%, 100% { transform: scale(1.6); opacity: 0; }
}
@keyframes ping-mid {
  0% { transform: scale(0.6); opacity: 0.8; }
  80%, 100% { transform: scale(1.4); opacity: 0; }
}
.animate-ping-slow {
  animation: ping-slow 2s cubic-bezier(0, 0, 0.2, 1) infinite;
}
.animate-ping-mid {
  animation: ping-mid 2s cubic-bezier(0, 0, 0.2, 1) infinite;
  animation-delay: 0.5s;
}
</style>
