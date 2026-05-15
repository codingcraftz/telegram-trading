<script setup lang="ts">
import { ref, onMounted } from 'vue';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import { api, type StrategyResponse } from '@/api/client';

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
    alert('✅ 저장됨');
    await load();
  } catch (err) {
    alert(`❌ ${(err as Error).message}`);
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-3">
    <h2 class="text-lg font-bold">🧩 시가매매 셋팅</h2>
    <Card>
      <div class="space-y-3">
        <label class="block">
          <span class="text-xs text-muted-foreground">갭가드 % (±)</span>
          <input
            v-model="form.gapGuardPct"
            type="number"
            step="0.5"
            placeholder="5"
            class="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground">TP % (없음=비워둠)</span>
          <input
            v-model="form.tpPct"
            type="number"
            step="0.5"
            placeholder="5"
            class="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground">SL % (없음=비워둠)</span>
          <input
            v-model="form.slPct"
            type="number"
            step="0.5"
            placeholder="3"
            class="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <Button size="lg" class="w-full" :disabled="saving" @click="save">
          {{ saving ? '저장 중…' : '💾 저장' }}
        </Button>
      </div>
    </Card>
  </div>
</template>
