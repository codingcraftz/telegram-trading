<script setup lang="ts">
// OrderActions — 종목 상세 sticky bottom 매수/매도.
// 탭바(z-20) 바로 위, BottomSheet 열리면 백드롭(z-40)에 자동 가려짐.
import Button from '@/components/ui/Button.vue';

defineProps<{ canSell?: boolean }>();
defineEmits<{ buy: []; sell: [] }>();
</script>

<template>
  <div
    class="fixed inset-x-0 z-20 mx-auto max-w-md border-t border-border bg-background/95 px-3 py-2 backdrop-blur"
    style="bottom: calc(env(safe-area-inset-bottom) + 3.5rem);"
  >
    <div class="grid grid-cols-2 gap-2">
      <Button variant="primary" size="lg" class="w-full bg-up text-white hover:bg-up/90" @click="$emit('buy')">
        매수
      </Button>
      <Button variant="destructive" size="lg" class="w-full bg-down text-white hover:bg-down/90" :disabled="!canSell" @click="$emit('sell')">
        매도
      </Button>
    </div>
  </div>
</template>
