<script setup lang="ts">
import { ref, onMounted } from 'vue';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
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

onMounted(load);
</script>

<template>
  <div class="space-y-3">
    <h2 class="text-lg font-bold">⚙️ 설정</h2>

    <Card title="🔧 버전 / 업데이트">
      <p v-if="version" class="text-sm font-mono">
        현재 버전: <b>{{ version.sha }}</b>
        <span v-if="version.buildDate" class="text-xs text-muted-foreground">
          ({{ version.buildDate.slice(0, 10) }})
        </span>
      </p>
    </Card>

    <Card v-if="keys" title="🔑 KIS 키 상태">
      <div class="space-y-1 text-sm">
        <p>
          🧪 모의 키 (전체):
          <span :class="keys.paperKeys ? 'text-up' : 'text-muted-foreground'">
            {{ keys.paperKeys ? '✅' : '❌' }}
          </span>
        </p>
        <p>
          🔥 실전 KEY/SECRET (시세용):
          <span :class="keys.realMarketKeys ? 'text-up' : 'text-muted-foreground'">
            {{ keys.realMarketKeys ? '✅' : '❌' }}
          </span>
        </p>
        <p>
          💼 실전 계좌 (매매용):
          <span :class="keys.realKeys ? 'text-up' : 'text-muted-foreground'">
            {{ keys.realKeys ? '✅' : '❌' }}
          </span>
        </p>
        <p class="pt-2">
          📊 시세/차트:
          <b>{{ keys.realMarketKeys ? '🔥 실전 (1080/min)' : '❌ 사용 불가' }}</b>
        </p>
        <p>
          💼 매매 모드: <b>{{ keys.tradingMode === 'real' ? '🔥 실전' : '🧪 모의' }}</b>
        </p>
      </div>
      <div class="mt-3 rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
        {{ keys.notice }}
      </div>
      <a href="/" class="mt-3 inline-block">
        <Button variant="outline" size="sm">→ 키 입력 / 모드 전환</Button>
      </a>
    </Card>

    <Card title="📖 도움말">
      <ul class="space-y-1 text-sm text-muted-foreground">
        <li>홈 화면에 추가하여 앱처럼 실행 (Chrome 메뉴 → 홈 화면에 추가)</li>
        <li>실전 키 등록 시 시세/차트 조회가 빨라짐 (rate limit 분당 60 → 1080)</li>
        <li>매매는 항상 현재 모드 사용 — 검증은 모의에서, 운영은 실전</li>
        <li>장 외 시간 즉시매수는 시가매매로 자동 예약</li>
      </ul>
    </Card>
  </div>
</template>
