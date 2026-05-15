<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { CircleCheck, CircleX, Info } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import { api, type StrategyResponse } from '@/api/client';
import { usePrefs, type Mode, type Theme } from '@/stores/prefs';
import { toast } from '@/lib/toast';

const prefs = usePrefs();

const version = ref<{ sha: string; buildDate: string } | null>(null);
const keys = ref<{
  tradingMode: 'paper' | 'real';
  paperKeys: boolean;
  realKeys: boolean;
  realMarketKeys: boolean;
  marketDataMode: 'demo' | 'real';
  notice: string;
} | null>(null);

const strat = ref<StrategyResponse | null>(null);
const stratForm = ref({ gapGuardPct: '', tpPct: '', slPct: '' });
const stratSaving = ref(false);

async function loadAll() {
  try {
    const [v, k, s] = await Promise.all([api.version(), api.keysStatus(), api.strategy()]);
    version.value = v;
    keys.value = k;
    strat.value = s;
    stratForm.value = {
      gapGuardPct: s.gapGuardPct?.toString() ?? '',
      tpPct: s.tpPct?.toString() ?? '',
      slPct: s.slPct?.toString() ?? '',
    };
  } catch (err) {
    console.warn(err);
  }
}

async function saveStrategy() {
  stratSaving.value = true;
  try {
    await api.strategySave({
      gapGuardPct: stratForm.value.gapGuardPct === '' ? null : Number(stratForm.value.gapGuardPct),
      tpPct: stratForm.value.tpPct === '' ? null : Number(stratForm.value.tpPct),
      slPct: stratForm.value.slPct === '' ? null : Number(stratForm.value.slPct),
    });
    toast.success('저장됐어요');
  } catch (err) {
    toast.error((err as Error).message);
  } finally {
    stratSaving.value = false;
  }
}

const buildDate = computed(() => version.value?.buildDate ? version.value.buildDate.slice(0, 10) : '');

onMounted(loadAll);
</script>

<template>
  <div class="space-y-4">
    <div class="px-1">
      <h2 class="text-lg font-bold tracking-tight">설정</h2>
    </div>

    <!-- 모드 & 색상 -->
    <Card>
      <template #header>
        <h3 class="text-sm font-bold tracking-tight">기본 설정</h3>
      </template>
      <div class="space-y-4">
        <div>
          <p class="mb-2 text-[11px] font-medium text-muted-foreground">사용 모드</p>
          <SegmentedControl
            :model-value="prefs.mode"
            :options="[
              { value: 'easy' as Mode, label: '쉬운 모드' },
              { value: 'advanced' as Mode, label: '고급 모드' },
            ]"
            @update:model-value="(v) => (prefs.mode = v)"
          />
          <p class="mt-1.5 text-[11px] text-muted-foreground">
            {{ prefs.mode === 'easy' ? '꼭 필요한 옵션만 보여줘요.' : '비율/주식수·자동 매도 옵션까지 모두 보여줘요.' }}
          </p>
        </div>
        <div>
          <p class="mb-2 text-[11px] font-medium text-muted-foreground">화면 색</p>
          <SegmentedControl
            :model-value="prefs.theme"
            :options="[
              { value: 'light' as Theme, label: '밝게' },
              { value: 'dark' as Theme, label: '어둡게' },
              { value: 'system' as Theme, label: '자동' },
            ]"
            @update:model-value="(v) => (prefs.theme = v)"
          />
        </div>
      </div>
    </Card>

    <!-- 연결 상태 -->
    <Card v-if="keys">
      <template #header>
        <h3 class="text-sm font-bold tracking-tight">연결 상태</h3>
      </template>
      <ul class="space-y-2 text-sm">
        <li class="flex items-center justify-between">
          <span class="text-muted-foreground">시세 / 차트</span>
          <span class="flex items-center gap-1 font-semibold" :class="keys.realMarketKeys ? 'text-up' : 'text-destructive'">
            <CircleCheck v-if="keys.realMarketKeys" class="h-4 w-4" />
            <CircleX v-else class="h-4 w-4" />
            {{ keys.realMarketKeys ? '연결됨' : '사용 불가' }}
          </span>
        </li>
        <li class="flex items-center justify-between">
          <span class="text-muted-foreground">매매</span>
          <span class="font-semibold">{{ keys.tradingMode === 'real' ? '실전' : '모의 모드' }}</span>
        </li>
      </ul>
      <div class="mt-3 flex items-start gap-2 rounded-xl bg-muted/40 px-3 py-2.5 text-[11px] text-muted-foreground">
        <Info class="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{{ keys.notice }}</span>
      </div>
    </Card>

    <!-- 내일 시가에 사기 기본값 -->
    <Card v-if="strat">
      <template #header>
        <h3 class="text-sm font-bold tracking-tight">내일 시가에 사기 기본값</h3>
      </template>
      <div class="space-y-4">
        <label class="block">
          <span class="text-[11px] font-medium text-muted-foreground">시가가 너무 튀면 안 사기 (±%)</span>
          <input
            v-model="stratForm.gapGuardPct"
            type="number"
            step="0.5"
            placeholder="예: 5"
            class="mt-1 w-full rounded-lg bg-muted/40 px-3 py-2.5 text-base font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <label class="block">
          <span class="text-[11px] font-medium text-muted-foreground">목표가 도달 시 자동 매도 (%)</span>
          <input
            v-model="stratForm.tpPct"
            type="number"
            step="0.5"
            placeholder="비워두면 자동 매도 안 함"
            class="mt-1 w-full rounded-lg bg-muted/40 px-3 py-2.5 text-base font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <label class="block">
          <span class="text-[11px] font-medium text-muted-foreground">손해 막기 자동 매도 (%)</span>
          <input
            v-model="stratForm.slPct"
            type="number"
            step="0.5"
            placeholder="비워두면 자동 매도 안 함"
            class="mt-1 w-full rounded-lg bg-muted/40 px-3 py-2.5 text-base font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <Button variant="primary" size="md" class="w-full" :disabled="stratSaving" @click="saveStrategy">
          {{ stratSaving ? '저장 중…' : '저장' }}
        </Button>
      </div>
    </Card>

    <p class="px-1 text-[11px] text-muted-foreground tabular-nums">
      <span v-if="version" class="font-mono">버전 {{ version.sha }}</span>
      <span v-if="buildDate" class="ml-1.5">· {{ buildDate }}</span>
    </p>
  </div>
</template>
