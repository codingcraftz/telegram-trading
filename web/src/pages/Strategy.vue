<script setup lang="ts">
import { ref, onMounted } from 'vue';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import { api, type StrategyResponse } from '@/api/client';
import { toast } from '@/lib/toast';

const settings = ref<StrategyResponse | null>(null);
const form = ref({ gapGuardPct: '', tpPct: '', slPct: '' });
const saving = ref(false);

async function load() {
  settings.value = await api.strategy();
  form.value = {
    gapGuardPct: settings.value.gapGuardPct?.toString() ?? '',
    tpPct: settings.value.tpPct?.toString() ?? '',
    slPct: settings.value.slPct?.toString() ?? '',
  };
}

async function save() {
  saving.value = true;
  try {
    await api.strategySave({
      gapGuardPct: form.value.gapGuardPct === '' ? null : Number(form.value.gapGuardPct),
      tpPct: form.value.tpPct === '' ? null : Number(form.value.tpPct),
      slPct: form.value.slPct === '' ? null : Number(form.value.slPct),
    });
    toast.success('저장되었습니다');
    await load();
  } catch (err) {
    toast.error((err as Error).message);
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-3">
    <div class="px-1">
      <h2 class="text-base font-semibold tracking-tight">시가매매 설정</h2>
    </div>

    <Card>
      <div class="space-y-4">
        <label class="block">
          <span class="text-[11px] font-medium text-muted-foreground">갭가드 % (±)</span>
          <input
            v-model="form.gapGuardPct"
            type="number"
            step="0.5"
            placeholder="5"
            class="mt-1 w-full rounded-lg bg-muted/40 px-3 py-2.5 text-base font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <p class="mt-1 text-[10px] text-muted-foreground">시가 ±% 초과 시 발주 안 함</p>
        </label>
        <label class="block">
          <span class="text-[11px] font-medium text-muted-foreground">TP %</span>
          <input
            v-model="form.tpPct"
            type="number"
            step="0.5"
            placeholder="비워두면 없음"
            class="mt-1 w-full rounded-lg bg-muted/40 px-3 py-2.5 text-base font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <label class="block">
          <span class="text-[11px] font-medium text-muted-foreground">SL %</span>
          <input
            v-model="form.slPct"
            type="number"
            step="0.5"
            placeholder="비워두면 없음"
            class="mt-1 w-full rounded-lg bg-muted/40 px-3 py-2.5 text-base font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <Button variant="primary" size="lg" class="w-full" :disabled="saving" @click="save">
          {{ saving ? '저장 중…' : '저장' }}
        </Button>
      </div>
    </Card>
  </div>
</template>
