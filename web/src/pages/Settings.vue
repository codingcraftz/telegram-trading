<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { CircleCheck, CircleX, Info } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import { api } from '@/api/client';

const version = ref<{ sha: string; buildDate: string } | null>(null);
const keys = ref<{
  tradingMode: 'paper' | 'real';
  paperKeys: boolean;
  realKeys: boolean;
  realMarketKeys: boolean;
  marketDataMode: 'demo' | 'real';
  notice: string;
} | null>(null);

async function load() {
  try {
    [version.value, keys.value] = await Promise.all([api.version(), api.keysStatus()]);
  } catch (err) {
    console.warn(err);
  }
}

const buildDate = computed(() => version.value?.buildDate ? version.value.buildDate.slice(0, 10) : '');

onMounted(load);
</script>

<template>
  <div class="space-y-3">
    <div class="px-1">
      <h2 class="text-base font-semibold tracking-tight">설정</h2>
    </div>

    <Card v-if="keys">
      <template #header>
        <h3 class="text-sm font-semibold tracking-tight">키 상태</h3>
      </template>
      <ul class="space-y-2 text-sm">
        <li class="flex items-center justify-between">
          <span class="text-muted-foreground">모의 키</span>
          <CircleCheck v-if="keys.paperKeys" class="h-4 w-4 text-up" />
          <CircleX v-else class="h-4 w-4 text-muted-foreground/50" />
        </li>
        <li class="flex items-center justify-between">
          <span class="text-muted-foreground">실전 KEY/SECRET (시세)</span>
          <CircleCheck v-if="keys.realMarketKeys" class="h-4 w-4 text-up" />
          <CircleX v-else class="h-4 w-4 text-muted-foreground/50" />
        </li>
        <li class="flex items-center justify-between">
          <span class="text-muted-foreground">실전 계좌 (매매)</span>
          <CircleCheck v-if="keys.realKeys" class="h-4 w-4 text-up" />
          <CircleX v-else class="h-4 w-4 text-muted-foreground/50" />
        </li>
      </ul>
      <div class="mt-4 space-y-2 border-t border-border pt-3 text-sm">
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">시세 / 차트</span>
          <span class="font-semibold" :class="keys.realMarketKeys ? 'text-up' : 'text-destructive'">
            {{ keys.realMarketKeys ? '실전 · 1080/min' : '사용 불가' }}
          </span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">매매 모드</span>
          <span class="font-semibold">{{ keys.tradingMode === 'real' ? '실전' : '모의' }}</span>
        </div>
      </div>
      <div class="mt-3 flex items-start gap-2 rounded-xl bg-muted/40 px-3 py-2.5 text-[11px] text-muted-foreground">
        <Info class="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{{ keys.notice }}</span>
      </div>
    </Card>

    <Card v-if="version">
      <template #header>
        <h3 class="text-sm font-semibold tracking-tight">버전</h3>
      </template>
      <div class="flex items-center justify-between text-sm">
        <span class="text-muted-foreground">빌드</span>
        <span class="font-mono text-xs tabular-nums">{{ version.sha }}<span v-if="buildDate" class="ml-1.5 text-muted-foreground">{{ buildDate }}</span></span>
      </div>
    </Card>

    <Card>
      <template #header>
        <h3 class="text-sm font-semibold tracking-tight">도움말</h3>
      </template>
      <ul class="space-y-1.5 text-xs text-muted-foreground">
        <li>홈 화면에 추가하여 네이티브 앱처럼 사용</li>
        <li>실전 KEY 등록 시 시세 rate limit 분당 60 → 1080</li>
        <li>매매는 현재 모드 사용 — 검증은 모의, 운영은 실전</li>
        <li>장외 시간 즉시매수는 시가매매로 자동 예약</li>
      </ul>
    </Card>
  </div>
</template>
