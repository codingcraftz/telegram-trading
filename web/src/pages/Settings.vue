<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { RefreshCw } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import { api } from '@/api/client';

const version = ref<{ sha: string; buildDate: string } | null>(null);

async function loadVersion() {
  try {
    version.value = await api.version();
  } catch (err) {
    console.warn(err);
  }
}

onMounted(loadVersion);
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
      <p class="mt-2 text-xs text-muted-foreground">
        키 입력 / 모드 전환 / 업데이트는 기존 설정 페이지를 사용하세요.
      </p>
      <a href="/" class="mt-3 inline-block">
        <Button variant="outline" size="sm">→ 기존 설정 페이지</Button>
      </a>
    </Card>

    <Card title="📖 도움말">
      <ul class="space-y-1 text-sm text-muted-foreground">
        <li>홈 화면에 추가하여 앱처럼 실행 (Chrome 메뉴 → 홈 화면에 추가)</li>
        <li>매수/매도는 KIS 모의계좌부터 검증</li>
        <li>장 외 시간 즉시매수는 시가매매로 자동 예약</li>
      </ul>
    </Card>
  </div>
</template>
