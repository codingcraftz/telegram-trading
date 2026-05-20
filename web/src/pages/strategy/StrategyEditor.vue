<script setup lang="ts">
// 전략 편집 — /new (생성) + /:id (수정) 겸용.
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ChevronLeft, ChevronDown, AlertTriangle, Plus, Copy, Trash2, Search, X, Inbox,
} from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import Modal from '@/components/ui/Modal.vue';
import BottomSheet from '@/components/ui/BottomSheet.vue';
import {
  api,
  type StrategyDefinition,
  type StrategyItem,
  type StrategyApplicationRow,
  type SearchItem,
  type StagedMorningBudget,
  type StagedMorningStage,
  type StagedMorningTp,
} from '@/api/client';
import { toast } from '@/lib/toast';

const route = useRoute();
const router = useRouter();

const id = computed(() => (route.params.id as string) ?? '');
const isEdit = computed(() => !!id.value);

// ===== 폼 상태 =====
const name = ref('');
const active = ref(true);
const version = ref<number>(1); // 수정 시 server에서 가져옴
const applications = ref<StrategyApplicationRow[]>([]);

// 진입 — 새 정책: 전략은 항상 morning_staged 기반 (분할 진입/익절/손절 통합 모델).
// 자금 규모는 매수 시점에 사용자가 직접 입력 → backend 호환 위해 cash_ratio=1.0 (전체) hardcoded.
type EntryType = 'morning' | 'limit_price' | 'morning_staged';
const entryType = ref<EntryType>('morning_staged');
const targetPrice = ref<number>(50_000);
const direction = ref<'above' | 'below'>('above');

// 자금 (UI 미노출 — default 전체 자금. 실제 발주 시점에 trade 폼에서 별도 지정.)
type StagedBudgetMode = 'fixed_amount' | 'cash_ratio';
const stagedBudgetMode = ref<StagedBudgetMode>('cash_ratio');
const stagedBudgetAmount = ref<number>(1_000_000);
const stagedBudgetRatio = ref<number>(100); // %
// 시가매매 — default ON (다음 영업일 09:00 자동 매수). OFF 면 trade 폼에서 매수 시점에 적용.
const triggerMorning = ref<boolean>(true);
// 1차 비율 (2차 OFF 면 100, ON 시 사용자 입력 default 50, 2차는 100-1차)
const stage1Pct = ref<number>(100);
// 2차 (물타기) — default OFF
const stage2Enabled = ref<boolean>(false);
const stage2DropPct = ref<number>(5);
// 익절 1차 — default ON, 평단 +10%. 2차 OFF 면 sellPct 100% 강제.
const tp1Enabled = ref<boolean>(true);
const tp1AtPct = ref<number>(10);
const tp1SellPct = ref<number>(100);
// 익절 2차 — default OFF, 평단 +20%.
const tp2Enabled = ref<boolean>(false);
const tp2AtPct = ref<number>(20);
// 손절 — default OFF, 평단 -10%
const stagedSlEnabled = ref<boolean>(false);
const stagedSlPct = ref<number>(10);
const stage2Pct = computed(() => Math.max(0, 100 - stage1Pct.value));

// 2차 토글 변경 시 1차 비율/tp1SellPct 자동 조정 (사용자 정책).
watch(stage2Enabled, (on) => {
  if (on) {
    if (stage1Pct.value === 100) stage1Pct.value = 50; // default 50:50
  } else {
    stage1Pct.value = 100; // 2차 OFF → 1차 100%
  }
});
watch(tp2Enabled, (on) => {
  if (!on) tp1SellPct.value = 100; // 2차 OFF → 1차 100% 익절
  else if (tp1SellPct.value === 100) tp1SellPct.value = 50; // default
});

// 매수
type OrderMethod = 'market' | 'limit';
const orderMethod = ref<OrderMethod>('market');
const limitPrice = ref<number>(0);

// 수량
type QtyMode = 'fixed_shares' | 'fixed_amount' | 'cash_ratio';
const qtyMode = ref<QtyMode>('fixed_amount');
const qtyShares = ref<number>(10);
const qtyAmount = ref<number>(1_000_000);
const qtyRatio = ref<number>(25); // 1~100 (%)

// 자동매도
const autoSellOpen = ref(false);
const tpEnabled = ref(false);
const tpPct = ref<number>(5);
const slEnabled = ref(false);
const slPct = ref<number>(3);

// 유효기간
type ValidityType = 'once' | 'forever';
const validityType = ref<ValidityType>('forever');

const saving = ref(false);
const initialSnapshot = ref<string>('');

// ===== 정규화 → StrategyDefinition =====
const definition = computed<StrategyDefinition>(() => {
  // entry
  let entry: StrategyDefinition['entry'];
  if (entryType.value === 'morning') {
    entry = { type: 'morning' };
  } else if (entryType.value === 'limit_price') {
    entry = { type: 'limit_price', targetPrice: targetPrice.value, direction: direction.value };
  } else {
    // morning_staged
    const budget: StagedMorningBudget =
      stagedBudgetMode.value === 'fixed_amount'
        ? { mode: 'fixed_amount', value: Math.max(1000, Math.floor(stagedBudgetAmount.value)) }
        : { mode: 'cash_ratio', value: Math.max(0.01, Math.min(1, stagedBudgetRatio.value / 100)) };
    const stages: StagedMorningStage[] = [
      { entryPct: Math.max(1, Math.min(100, Math.round(stage1Pct.value))) },
    ];
    if (stage2Enabled.value && stage1Pct.value < 100) {
      stages.push({
        entryPct: 100 - Math.round(stage1Pct.value),
        triggerDropPct: stage2DropPct.value,
      });
    }
    const tp: StagedMorningTp = {};
    if (tp1Enabled.value) tp.tp1 = { enabled: true, atPct: tp1AtPct.value, sellPct: tp1SellPct.value };
    if (tp2Enabled.value) tp.tp2 = { enabled: true, atPct: tp2AtPct.value };
    entry = {
      type: 'morning_staged',
      triggerMode: triggerMorning.value ? 'morning' : 'immediate',
      budget,
      stages,
      takeProfit: tp.tp1 || tp.tp2 ? tp : undefined,
      stopLoss: stagedSlEnabled.value
        ? { enabled: true, atPct: stagedSlPct.value }
        : undefined,
    };
  }

  // morning_staged는 외부 order/quantity/exit를 안 씀 — placeholder로 채움
  const isStaged = entryType.value === 'morning_staged';

  const order: StrategyDefinition['order'] = isStaged
    ? { method: 'market' }
    : orderMethod.value === 'market'
      ? { method: 'market' }
      : { method: 'limit', limitPrice: limitPrice.value };

  const quantity: StrategyDefinition['quantity'] = isStaged
    ? { mode: 'fixed_shares', value: 1 } // unused
    : qtyMode.value === 'fixed_shares'
      ? { mode: 'fixed_shares', value: Math.max(1, Math.floor(qtyShares.value)) }
      : qtyMode.value === 'fixed_amount'
        ? { mode: 'fixed_amount', value: Math.max(1000, Math.floor(qtyAmount.value)) }
        : { mode: 'cash_ratio', value: Math.max(0.01, Math.min(1, qtyRatio.value / 100)) };

  const exit: StrategyDefinition['exit'] | undefined = isStaged
    ? undefined
    : tpEnabled.value || slEnabled.value
      ? {
          takeProfit: tpEnabled.value ? { enabled: true, pct: tpPct.value } : undefined,
          stopLoss: slEnabled.value ? { enabled: true, pct: slPct.value } : undefined,
        }
      : undefined;

  return {
    entry,
    order,
    quantity,
    exit,
    validity: { type: validityType.value },
  };
});

// ===== 클라 검증 =====
const errors = computed<Record<string, string>>(() => {
  const e: Record<string, string> = {};
  if (!name.value.trim()) e.name = '전략명을 입력하세요';
  if (entryType.value === 'limit_price' && targetPrice.value <= 0) e.targetPrice = '목표가는 1원 이상';
  if (orderMethod.value === 'limit' && limitPrice.value <= 0) e.limitPrice = '지정가는 1원 이상';
  if (qtyMode.value === 'fixed_shares' && qtyShares.value < 1) e.quantity = '주식수는 1주 이상';
  if (qtyMode.value === 'fixed_amount' && qtyAmount.value < 1000) e.quantity = '최소 1000원 이상';
  if (qtyMode.value === 'cash_ratio' && (qtyRatio.value < 1 || qtyRatio.value > 100)) e.quantity = '예수금 비율은 1~100%';
  if (tpEnabled.value && (tpPct.value <= 0 || tpPct.value > 50)) e.tp = '0~50% 사이';
  if (slEnabled.value && (slPct.value <= 0 || slPct.value > 50)) e.sl = '0~50% 사이';
  return e;
});

const canSave = computed(() => Object.keys(errors.value).length === 0 && !saving.value);

// dirty 추적
function snapshot(): string {
  return JSON.stringify({ name: name.value, active: active.value, definition: definition.value });
}
const isDirty = computed(() => snapshot() !== initialSnapshot.value);

// ===== Load / Prefill =====
async function loadExisting() {
  if (!id.value) return;
  try {
    const r = await api.strategyDetail(id.value);
    const s = r.strategy;
    name.value = s.name;
    active.value = s.active;
    version.value = s.version;
    applyDefinition(s.definition);
    applications.value = r.applications;
    await nextTick();
    initialSnapshot.value = snapshot();
  } catch (err) {
    toast.error((err as Error).message);
  }
}

function applyDefinition(d: StrategyDefinition) {
  entryType.value = d.entry.type;
  if (d.entry.type === 'limit_price') {
    targetPrice.value = d.entry.targetPrice;
    direction.value = d.entry.direction;
  } else if (d.entry.type === 'morning_staged') {
    triggerMorning.value = (d.entry.triggerMode ?? 'morning') === 'morning';
    const b = d.entry.budget;
    stagedBudgetMode.value = b.mode;
    if (b.mode === 'fixed_amount') stagedBudgetAmount.value = b.value;
    else stagedBudgetRatio.value = Math.round(b.value * 100);
    const s1 = d.entry.stages[0];
    if (s1) stage1Pct.value = s1.entryPct;
    const s2 = d.entry.stages[1];
    if (s2) {
      stage2Enabled.value = true;
      stage2DropPct.value = s2.triggerDropPct ?? 5;
    } else {
      stage2Enabled.value = false;
    }
    if (d.entry.takeProfit?.tp1?.enabled) {
      tp1Enabled.value = true;
      tp1AtPct.value = d.entry.takeProfit.tp1.atPct;
      tp1SellPct.value = d.entry.takeProfit.tp1.sellPct;
    } else {
      tp1Enabled.value = false;
    }
    if (d.entry.takeProfit?.tp2?.enabled) {
      tp2Enabled.value = true;
      tp2AtPct.value = d.entry.takeProfit.tp2.atPct;
    } else {
      tp2Enabled.value = false;
    }
    if (d.entry.stopLoss?.enabled) {
      stagedSlEnabled.value = true;
      stagedSlPct.value = d.entry.stopLoss.atPct;
    } else {
      stagedSlEnabled.value = false;
    }
  }
  orderMethod.value = d.order.method;
  if (d.order.method === 'limit') limitPrice.value = d.order.limitPrice;
  qtyMode.value = d.quantity.mode;
  if (d.quantity.mode === 'fixed_shares') qtyShares.value = d.quantity.value;
  if (d.quantity.mode === 'fixed_amount') qtyAmount.value = d.quantity.value;
  if (d.quantity.mode === 'cash_ratio') qtyRatio.value = Math.round(d.quantity.value * 100);
  if (d.exit?.takeProfit?.enabled) {
    tpEnabled.value = true;
    tpPct.value = d.exit.takeProfit.pct;
    autoSellOpen.value = true;
  }
  if (d.exit?.stopLoss?.enabled) {
    slEnabled.value = true;
    slPct.value = d.exit.stopLoss.pct;
    autoSellOpen.value = true;
  }
  validityType.value = d.validity.type;
}

onMounted(async () => {
  if (isEdit.value) {
    await loadExisting();
  } else {
    // 템플릿 prefill (?from=encodedJSON)
    const fromRaw = route.query.from as string | undefined;
    if (fromRaw) {
      try {
        const parsed = JSON.parse(decodeURIComponent(fromRaw)) as StrategyDefinition;
        applyDefinition(parsed);
      } catch {}
    }
    await nextTick();
    initialSnapshot.value = snapshot();
  }
});

// ===== 저장 =====
async function save() {
  if (!canSave.value) return;
  saving.value = true;
  try {
    if (isEdit.value) {
      const r = await api.updateStrategy(id.value, {
        version: version.value,
        name: name.value.trim(),
        active: active.value,
        definition: definition.value,
      });
      version.value = r.version;
      initialSnapshot.value = snapshot();
      toast.success('저장됐어요');
      router.push('/more/strategy');
    } else {
      const r = await api.createStrategy({
        name: name.value.trim(),
        active: active.value,
        definition: definition.value,
      });
      toast.success(`${r.name} 저장됐어요`);
      router.push('/more/strategy');
    }
  } catch (err) {
    const msg = (err as Error).message;
    if (/version_conflict/i.test(msg)) {
      toast.error('다른 곳에서 먼저 수정됐어요. 새로 불러올게요.');
      await loadExisting();
    } else if (/validation_failed/i.test(msg)) {
      toast.error('입력값이 잘못됐어요. 다시 확인해 주세요.');
    } else {
      toast.error(msg);
    }
  } finally {
    saving.value = false;
  }
}

// ===== 복제 / 삭제 =====
const deleteOpen = ref(false);

async function doClone() {
  if (!id.value) return;
  try {
    const r = await api.cloneStrategy(id.value);
    toast.success(`${r.name} 복사됐어요`);
    router.push(`/more/strategy/${r.id}`);
  } catch (err) {
    toast.error((err as Error).message);
  }
}
async function doDelete() {
  if (!id.value) return;
  deleteOpen.value = false;
  try {
    await api.deleteStrategy(id.value);
    toast.success('전략이 삭제됐어요');
    router.push('/more/strategy');
  } catch (err) {
    toast.error((err as Error).message);
  }
}

// ===== 적용 종목 추가/삭제 =====
const addOpen = ref(false);
const searchQ = ref('');
const searchResults = ref<SearchItem[]>([]);
const searching = ref(false);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

watch(searchQ, (v) => {
  if (searchTimer) clearTimeout(searchTimer);
  if (!v.trim()) { searchResults.value = []; return; }
  if (/^\d{6}$/.test(v.trim())) {
    searchResults.value = [{ code: v.trim(), name: '' }];
    return;
  }
  searchTimer = setTimeout(async () => {
    searching.value = true;
    try {
      const r = await api.search(v);
      searchResults.value = r.items;
    } catch {} finally { searching.value = false; }
  }, 200);
});

async function pickStock(item: SearchItem) {
  if (!id.value) return;
  try {
    const r = await api.applyStrategy(id.value, { stockCode: item.code });
    applications.value = [r, ...applications.value];
    toast.success('적용 완료');
    searchQ.value = '';
    addOpen.value = false;
  } catch (err) {
    const msg = (err as Error).message;
    if (/already_applied/i.test(msg)) toast.info('이미 적용된 종목이에요');
    else toast.error(msg);
  }
}

async function removeApp(appId: string) {
  if (!id.value) return;
  try {
    await api.removeApplication(id.value, appId);
    applications.value = applications.value.filter((a) => a.id !== appId);
    toast.info('적용 해제됐어요');
  } catch (err) {
    toast.error((err as Error).message);
  }
}
</script>

<template>
  <div class="space-y-3 pb-24">
    <!-- 헤더 -->
    <div class="sticky top-0 z-10 -mx-4 border-b border-border/60 bg-background/90 px-4 backdrop-blur">
      <div class="flex items-center gap-1 py-3">
        <button
          class="-ml-2 rounded-md p-2 text-muted-foreground transition hover:bg-accent"
          @click="router.push('/more/strategy')"
        >
          <ChevronLeft class="h-5 w-5" />
        </button>
        <h2 class="flex-1 truncate px-1 text-base font-bold tracking-tight">
          {{ isEdit ? '전략 편집' : '새 전략' }}
        </h2>
        <button
          v-if="isEdit"
          class="rounded-md p-2 text-muted-foreground transition hover:bg-accent"
          aria-label="복제"
          @click="doClone"
        >
          <Copy class="h-4 w-4" />
        </button>
        <button
          v-if="isEdit"
          class="rounded-md p-2 text-destructive transition hover:bg-accent"
          aria-label="삭제"
          @click="deleteOpen = true"
        >
          <Trash2 class="h-4 w-4" />
        </button>
      </div>
    </div>

    <!-- 1. 기본 정보 -->
    <Card>
      <template #header><h3 class="text-sm font-bold tracking-tight">기본 정보</h3></template>
      <label class="block">
        <span class="mb-1 block text-[11px] font-semibold text-muted-foreground">전략명</span>
        <input
          v-model="name"
          type="text"
          maxlength="80"
          placeholder="예: 단기 스윙 5/10"
          class="w-full rounded-lg bg-muted/40 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <p v-if="errors.name" class="mt-1 text-[10px] text-destructive">{{ errors.name }}</p>
      </label>
      <!-- 활성화 토글은 editor 에서 제거 — 만들 때 default ON.
           활성/비활성은 '내 전략' 페이지의 카드 토글에서 관리. -->
    </Card>

    <!-- 2. 진입 조건 -->
    <!-- 사용자 정책: entry type 선택 UI 제거 (전략은 항상 분할 진입 모델).
         자금 규모 카드도 제거 — 자금은 매수 시점에 trade 폼에서 직접 입력.
         v-if=false 로 유지해서 코드 호환만 보장. -->
    <Card v-if="false">
      <template #header><h3 class="text-sm font-bold tracking-tight">언제 매수할까요?</h3></template>
      <div class="grid grid-cols-3 gap-1.5">
        <button
          type="button"
          class="rounded-xl border-2 p-2.5 text-left transition"
          :class="entryType === 'morning_staged' ? 'border-primary bg-primary/5' : 'border-transparent bg-muted/40'"
          @click="entryType = 'morning_staged'"
        >
          <p class="text-[12px] font-semibold">시가매매</p>
          <p class="mt-0.5 text-[10px] leading-snug text-muted-foreground">분할 진입<br />+ 분할 익절</p>
        </button>
        <button
          type="button"
          class="rounded-xl border-2 p-2.5 text-left transition"
          :class="entryType === 'morning' ? 'border-primary bg-primary/5' : 'border-transparent bg-muted/40'"
          @click="entryType = 'morning'"
        >
          <p class="text-[12px] font-semibold">시가 단순</p>
          <p class="mt-0.5 text-[10px] leading-snug text-muted-foreground">09:00<br />1회 매수</p>
        </button>
        <button
          type="button"
          class="rounded-xl border-2 p-2.5 text-left transition"
          :class="entryType === 'limit_price' ? 'border-primary bg-primary/5' : 'border-transparent bg-muted/40'"
          @click="entryType = 'limit_price'"
        >
          <p class="text-[12px] font-semibold">지정가 도달</p>
          <p class="mt-0.5 text-[10px] leading-snug text-muted-foreground">목표가에<br />닿으면 발동</p>
        </button>
      </div>

      <div v-if="entryType === 'limit_price'" class="mt-4 space-y-3">
        <label class="block">
          <span class="mb-1 block text-[11px] font-semibold text-muted-foreground">목표가</span>
          <input
            v-model.number="targetPrice"
            type="number"
            min="1"
            class="w-full rounded-lg bg-muted/40 px-3 py-2.5 text-base font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <p v-if="errors.targetPrice" class="mt-1 text-[10px] text-destructive">{{ errors.targetPrice }}</p>
        </label>
        <div class="grid grid-cols-2 gap-1">
          <button
            type="button"
            class="rounded-md py-2 text-xs font-semibold transition"
            :class="direction === 'above' ? 'bg-up text-white' : 'bg-muted text-muted-foreground hover:text-foreground'"
            @click="direction = 'above'"
          >이상 도달 시 ↑</button>
          <button
            type="button"
            class="rounded-md py-2 text-xs font-semibold transition"
            :class="direction === 'below' ? 'bg-down text-white' : 'bg-muted text-muted-foreground hover:text-foreground'"
            @click="direction = 'below'"
          >이하 도달 시 ↓</button>
        </div>
      </div>

      <!-- morning_staged 안내 -->
      <p v-if="entryType === 'morning_staged'" class="mt-3 text-[11px] text-muted-foreground">
        다음 영업일 09:00 시가에 1차 매수. 1차 체결가 대비 하락 시 2차 추가 매수 → TP 도달 시 분할 익절.
      </p>
    </Card>

    <!-- ====== morning_staged 전용 섹션 ====== -->
    <template v-if="entryType === 'morning_staged'">
      <!-- 자금 — 사용자 정책: 매수 시점에 입력 → editor 에서 hide. cash_ratio=100% hardcoded. -->
      <Card v-if="false">
        <template #header><h3 class="text-sm font-bold tracking-tight">자금 규모</h3></template>
        <div class="inline-flex w-full rounded-xl bg-muted p-1">
          <button
            type="button"
            class="flex-1 rounded-lg py-1.5 text-xs font-semibold transition"
            :class="stagedBudgetMode === 'fixed_amount' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'"
            @click="stagedBudgetMode = 'fixed_amount'"
          >고정 금액</button>
          <button
            type="button"
            class="flex-1 rounded-lg py-1.5 text-xs font-semibold transition"
            :class="stagedBudgetMode === 'cash_ratio' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'"
            @click="stagedBudgetMode = 'cash_ratio'"
          >예수금 비율</button>
        </div>
        <label v-if="stagedBudgetMode === 'fixed_amount'" class="mt-3 block">
          <span class="mb-1 block text-[11px] font-semibold text-muted-foreground">전체 매수 금액 (원)</span>
          <input
            v-model.number="stagedBudgetAmount"
            type="number"
            min="1000"
            step="10000"
            class="w-full rounded-lg bg-muted/40 px-3 py-2.5 text-base font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <label v-else class="mt-3 block">
          <span class="mb-1 block text-[11px] font-semibold text-muted-foreground">예수금의 {{ stagedBudgetRatio }}%</span>
          <input v-model.number="stagedBudgetRatio" type="range" min="1" max="100" step="1" class="w-full accent-primary" />
        </label>
      </Card>

      <!-- 시가매매 토글 — default ON. OFF 면 trade 폼에서 매수 시점에 적용. -->
      <Card>
        <template #header><h3 class="text-sm font-bold tracking-tight">시가매매</h3></template>
        <label class="flex items-center gap-2.5">
          <input v-model="triggerMorning" type="checkbox" class="peer sr-only" />
          <span class="relative inline-flex h-6 w-11 cursor-pointer items-center rounded-full bg-muted transition peer-checked:bg-primary">
            <span class="inline-block h-5 w-5 transform rounded-full bg-card shadow transition" :class="triggerMorning ? 'translate-x-[1.375rem]' : 'translate-x-0.5'" />
          </span>
          <span class="text-sm font-semibold">다음 영업일 09:00 자동 매수</span>
        </label>
        <p class="mt-2 rounded-lg bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          <template v-if="triggerMorning">
            전략 적용 → 다음 영업일 시가에 1차 매수. 이후 분할 진입/익절/손절 자동 감시.
          </template>
          <template v-else>
            시가매매 없이 <b class="text-foreground">주문 화면</b>에서 매수 시점에 적용. 그 매수가
            1차로 인식되어 익절/손절/물타기 자동 감시 시작.
          </template>
        </p>
      </Card>

      <!-- 분할 진입 -->
      <Card>
        <template #header><h3 class="text-sm font-bold tracking-tight">분할 진입</h3></template>
        <div class="space-y-3">
          <!-- 2차 토글 (물타기) -->
          <label class="flex items-center gap-2.5">
            <input v-model="stage2Enabled" type="checkbox" class="peer sr-only" />
            <span class="relative inline-flex h-6 w-11 cursor-pointer items-center rounded-full bg-muted transition peer-checked:bg-primary">
              <span class="inline-block h-5 w-5 transform rounded-full bg-card shadow transition" :class="stage2Enabled ? 'translate-x-[1.375rem]' : 'translate-x-0.5'" />
            </span>
            <span class="text-sm font-semibold">2차 진입 (물타기)</span>
          </label>

          <!-- 2차 OFF — 1차 100% 자동 안내 -->
          <div v-if="!stage2Enabled" class="rounded-lg bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            1차에서 <span class="font-semibold text-foreground">전체 자금</span> 시가 매수.
          </div>

          <!-- 2차 ON — 1차/2차 비율 + 트리거 -->
          <div v-else class="space-y-2.5 rounded-lg bg-muted/30 px-3 py-3">
            <div>
              <p class="mb-1 text-[11px] font-semibold">
                1차 <span class="text-primary tabular-nums">{{ stage1Pct }}%</span>
                <span class="mx-1 text-muted-foreground">·</span>
                2차 <span class="text-primary tabular-nums">{{ stage2Pct }}%</span>
              </p>
              <input v-model.number="stage1Pct" type="range" min="10" max="90" step="5" class="w-full accent-primary" />
            </div>
            <label class="block">
              <span class="mb-1 block text-[11px] text-muted-foreground">
                2차 발동 — 1차 체결가 대비 <span class="font-semibold text-foreground tabular-nums">-{{ stage2DropPct }}%</span>
              </span>
              <input v-model.number="stage2DropPct" type="range" min="1" max="30" step="0.5" class="w-full accent-primary" />
            </label>
          </div>
        </div>
      </Card>

      <!-- 익절 -->
      <Card>
        <template #header><h3 class="text-sm font-bold tracking-tight">익절</h3></template>
        <div class="space-y-3">
          <!-- 1차 익절 — default ON. 평단 +% 입력 -->
          <label class="flex items-center gap-2.5">
            <input v-model="tp1Enabled" type="checkbox" class="peer sr-only" />
            <span class="relative inline-flex h-6 w-11 cursor-pointer items-center rounded-full bg-muted transition peer-checked:bg-up">
              <span class="inline-block h-5 w-5 transform rounded-full bg-card shadow transition" :class="tp1Enabled ? 'translate-x-[1.375rem]' : 'translate-x-0.5'" />
            </span>
            <span class="text-sm font-semibold">1차 익절</span>
            <span class="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
              평단 +<input v-model.number="tp1AtPct" type="number" step="0.5" min="0.5" max="100"
                :disabled="!tp1Enabled"
                class="w-14 rounded border border-border bg-card px-1.5 py-1 text-right text-xs font-semibold tabular-nums text-up disabled:opacity-40" />%
            </span>
          </label>
          <!-- 2차 OFF 면 1차가 100% (자동) — 안내 -->
          <p v-if="tp1Enabled && !tp2Enabled" class="ml-8 text-[10px] text-muted-foreground">
            보유 전부 매도 (2차 익절 켜면 분할).
          </p>

          <!-- 2차 익절 토글 — default OFF. ON 시 1차 비율 + 2차 평단 +% -->
          <label class="flex items-center gap-2.5 border-t border-border/60 pt-3">
            <input v-model="tp2Enabled" type="checkbox" class="peer sr-only" />
            <span class="relative inline-flex h-6 w-11 cursor-pointer items-center rounded-full bg-muted transition peer-checked:bg-up">
              <span class="inline-block h-5 w-5 transform rounded-full bg-card shadow transition" :class="tp2Enabled ? 'translate-x-[1.375rem]' : 'translate-x-0.5'" />
            </span>
            <span class="text-sm font-semibold">2차 익절</span>
            <span class="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
              평단 +<input v-model.number="tp2AtPct" type="number" step="0.5" min="0.5" max="200"
                :disabled="!tp2Enabled"
                class="w-14 rounded border border-border bg-card px-1.5 py-1 text-right text-xs font-semibold tabular-nums text-up disabled:opacity-40" />%
            </span>
          </label>

          <!-- 2차 ON 시 — 1차/2차 매도 비율 분할 slider -->
          <div v-if="tp2Enabled" class="rounded-lg bg-muted/30 px-3 py-2.5">
            <p class="mb-1 text-[11px] font-semibold">
              1차 <span class="text-up tabular-nums">{{ tp1SellPct }}%</span>
              <span class="mx-1 text-muted-foreground">·</span>
              2차 <span class="text-up tabular-nums">{{ Math.max(0, 100 - tp1SellPct) }}%</span>
            </p>
            <input v-model.number="tp1SellPct" type="range" min="10" max="90" step="5" class="w-full accent-primary" />
          </div>
        </div>
      </Card>

      <!-- 손절 -->
      <Card>
        <template #header><h3 class="text-sm font-bold tracking-tight">손절</h3></template>
        <label class="flex items-center gap-2">
          <input v-model="stagedSlEnabled" type="checkbox" class="peer sr-only" />
          <span class="relative inline-flex h-5 w-9 cursor-pointer items-center rounded-full bg-muted transition peer-checked:bg-primary">
            <span class="inline-block h-4 w-4 transform rounded-full bg-card shadow transition" :class="stagedSlEnabled ? 'translate-x-[1.125rem]' : 'translate-x-0.5'" />
          </span>
          <span class="text-sm font-medium">평균단가 기준 손절</span>
        </label>
        <div v-if="stagedSlEnabled" class="mt-2 flex items-center gap-2 pl-2">
          <span class="text-[10px] text-muted-foreground">평단 대비</span>
          <input v-model.number="stagedSlPct" type="number" step="0.5" min="0.5" max="50"
            class="w-24 rounded-lg bg-muted/40 px-3 py-2 text-base font-semibold tabular-nums text-down focus:outline-none focus:ring-1 focus:ring-primary" />
          <span class="text-sm font-semibold text-down">% 하락 시 전량 손절</span>
        </div>
      </Card>
    </template>

    <!-- 3. 매수 방식 (morning_staged엔 숨김 — 무조건 시장가) -->
    <Card v-if="entryType !== 'morning_staged'">
      <template #header><h3 class="text-sm font-bold tracking-tight">어떻게 매수할까요?</h3></template>
      <div class="inline-flex w-full rounded-xl bg-muted p-1">
        <button
          type="button"
          class="flex-1 rounded-lg py-1.5 text-xs font-semibold transition"
          :class="orderMethod === 'market' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'"
          @click="orderMethod = 'market'"
        >시장가</button>
        <button
          type="button"
          class="flex-1 rounded-lg py-1.5 text-xs font-semibold transition"
          :class="orderMethod === 'limit' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'"
          @click="orderMethod = 'limit'"
        >지정가</button>
      </div>
      <label v-if="orderMethod === 'limit'" class="mt-3 block">
        <span class="mb-1 block text-[11px] font-semibold text-muted-foreground">지정가</span>
        <input
          v-model.number="limitPrice"
          type="number"
          min="1"
          class="w-full rounded-lg bg-muted/40 px-3 py-2.5 text-base font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <p v-if="errors.limitPrice" class="mt-1 text-[10px] text-destructive">{{ errors.limitPrice }}</p>
      </label>
    </Card>

    <!-- 4. 수량 방식 (morning_staged엔 숨김 — 자금/분할 진입에서 처리) -->
    <Card v-if="entryType !== 'morning_staged'">
      <template #header><h3 class="text-sm font-bold tracking-tight">얼마만큼 매수할까요?</h3></template>
      <div class="grid grid-cols-3 gap-1">
        <button
          v-for="m in [
            { v: 'fixed_shares', l: '고정 주식수' },
            { v: 'fixed_amount', l: '고정 금액' },
            { v: 'cash_ratio', l: '예수금 비율' },
          ]" :key="m.v"
          type="button"
          class="rounded-md py-2 text-[11px] font-semibold transition"
          :class="qtyMode === m.v ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'"
          @click="qtyMode = m.v as QtyMode"
        >{{ m.l }}</button>
      </div>

      <div class="mt-3">
        <label v-if="qtyMode === 'fixed_shares'" class="block">
          <span class="mb-1 block text-[11px] font-semibold text-muted-foreground">주식 수</span>
          <input
            v-model.number="qtyShares"
            type="number"
            min="1"
            class="w-full rounded-lg bg-muted/40 px-3 py-2.5 text-base font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <label v-else-if="qtyMode === 'fixed_amount'" class="block">
          <span class="mb-1 block text-[11px] font-semibold text-muted-foreground">매수 금액 (원)</span>
          <input
            v-model.number="qtyAmount"
            type="number"
            min="1000"
            step="10000"
            class="w-full rounded-lg bg-muted/40 px-3 py-2.5 text-base font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <label v-else class="block">
          <span class="mb-1 block text-[11px] font-semibold text-muted-foreground">예수금의 {{ qtyRatio }}%</span>
          <input
            v-model.number="qtyRatio"
            type="range"
            min="1"
            max="100"
            step="1"
            class="w-full accent-primary"
          />
        </label>
        <p v-if="errors.quantity" class="mt-1 text-[10px] text-destructive">{{ errors.quantity }}</p>
      </div>
    </Card>

    <!-- 5. 자동 매도 (morning_staged엔 숨김 — 분할 익절/손절 카드로 대체) -->
    <Card v-if="entryType !== 'morning_staged'">
      <template #header>
        <button
          type="button"
          class="-mx-1 flex w-full items-center justify-between"
          @click="autoSellOpen = !autoSellOpen"
        >
          <h3 class="text-sm font-bold tracking-tight">자동 매도 (선택)</h3>
          <ChevronDown class="h-4 w-4 text-muted-foreground transition-transform" :class="autoSellOpen ? 'rotate-180' : ''" />
        </button>
      </template>
      <div v-if="autoSellOpen" class="space-y-3">
        <div>
          <label class="flex items-center gap-2">
            <input v-model="tpEnabled" type="checkbox" class="peer sr-only" />
            <span class="relative inline-flex h-5 w-9 cursor-pointer items-center rounded-full bg-muted transition peer-checked:bg-primary">
              <span class="inline-block h-4 w-4 transform rounded-full bg-card shadow transition" :class="tpEnabled ? 'translate-x-[1.125rem]' : 'translate-x-0.5'" />
            </span>
            <span class="text-sm font-medium">목표가 도달 시 매도</span>
          </label>
          <div v-if="tpEnabled" class="mt-2 flex items-center gap-2">
            <input v-model.number="tpPct" type="number" step="0.5" min="0.5" max="50"
              class="flex-1 rounded-lg bg-muted/40 px-3 py-2 text-base font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-primary" />
            <span class="text-sm font-semibold text-up">%</span>
          </div>
          <p v-if="errors.tp" class="mt-1 text-[10px] text-destructive">{{ errors.tp }}</p>
        </div>
        <div>
          <label class="flex items-center gap-2">
            <input v-model="slEnabled" type="checkbox" class="peer sr-only" />
            <span class="relative inline-flex h-5 w-9 cursor-pointer items-center rounded-full bg-muted transition peer-checked:bg-primary">
              <span class="inline-block h-4 w-4 transform rounded-full bg-card shadow transition" :class="slEnabled ? 'translate-x-[1.125rem]' : 'translate-x-0.5'" />
            </span>
            <span class="text-sm font-medium">손해 막기 (손절)</span>
          </label>
          <div v-if="slEnabled" class="mt-2 flex items-center gap-2">
            <input v-model.number="slPct" type="number" step="0.5" min="0.5" max="50"
              class="flex-1 rounded-lg bg-muted/40 px-3 py-2 text-base font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-primary" />
            <span class="text-sm font-semibold text-down">%</span>
          </div>
          <p v-if="errors.sl" class="mt-1 text-[10px] text-destructive">{{ errors.sl }}</p>
        </div>
      </div>
    </Card>

    <!-- 6. 유효 기간 — 사용자 정책: 전략은 한번 만들면 계속 사용. 활성/비활성으로만 노출 제어.
         validityType 은 항상 'forever'. UI 노출 X (코드 호환 위해 ref 만 유지). -->
    <!-- (구 1회성/영구 토글 제거됨) -->

    <!-- 적용된 종목 (수정 모드만) -->
    <Card v-if="isEdit">
      <template #header>
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-bold tracking-tight">적용된 종목 ({{ applications.length }})</h3>
          <button
            type="button"
            class="flex items-center gap-1 text-[11px] font-semibold text-primary"
            @click="addOpen = true"
          >
            <Plus class="h-3.5 w-3.5" /> 종목 추가
          </button>
        </div>
      </template>
      <div v-if="applications.length > 0" class="space-y-1.5">
        <div
          v-for="app in applications"
          :key="app.id"
          class="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2"
        >
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold">{{ app.stockCode }}</p>
            <p class="text-[10px] text-muted-foreground tabular-nums">
              상태 {{ app.status }} · 적용 {{ new Date(app.appliedAt).toLocaleDateString('ko-KR') }}
            </p>
          </div>
          <button
            class="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent"
            aria-label="해제"
            @click="removeApp(app.id)"
          >
            <X class="h-4 w-4" />
          </button>
        </div>
      </div>
      <div v-else class="rounded-lg bg-muted/30 px-3 py-4 text-center text-[11px] text-muted-foreground">
        아직 적용된 종목이 없어요
      </div>
    </Card>

    <!-- 저장 sticky bottom -->
    <div
      class="fixed inset-x-0 z-20 mx-auto max-w-md border-t border-border bg-background/95 px-3 py-2 backdrop-blur"
      style="bottom: calc(env(safe-area-inset-bottom) + 3.5rem);"
    >
      <Button
        variant="primary"
        size="lg"
        class="w-full"
        :disabled="!canSave || !isDirty"
        @click="save"
      >
        {{ saving ? '저장 중…' : isEdit ? '저장' : '전략 만들기' }}
      </Button>
    </div>

    <!-- 종목 추가 시트 -->
    <BottomSheet :open="addOpen" title="종목 검색" @close="addOpen = false">
      <template #default>
        <div class="space-y-3">
          <div class="relative">
            <Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              v-model="searchQ"
              type="search"
              placeholder="종목명 또는 6자리 코드"
              class="w-full rounded-lg border border-border bg-background py-2.5 pl-9 pr-3 text-sm focus:border-primary focus:outline-none"
            />
          </div>

          <div v-if="searchResults.length > 0" class="space-y-1">
            <button
              v-for="r in searchResults"
              :key="r.code"
              type="button"
              class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition hover:bg-accent"
              @click="pickStock(r)"
            >
              <span class="text-sm">{{ r.name || r.code }}</span>
              <span class="text-[10px] text-muted-foreground tabular-nums">{{ r.code }}</span>
            </button>
          </div>
          <p v-else-if="searchQ && !searching" class="rounded-lg bg-muted/30 px-3 py-4 text-center text-[11px] text-muted-foreground">
            <Inbox class="mx-auto mb-1 h-5 w-5" />
            검색 결과가 없어요
          </p>
        </div>
      </template>
    </BottomSheet>

    <!-- 삭제 확인 -->
    <Modal :open="deleteOpen" title="전략을 삭제할까요?" @close="deleteOpen = false">
      <p class="text-sm text-muted-foreground">
        이 전략과 적용된 모든 종목 연결이 사라져요. 되돌릴 수 없어요.
      </p>
      <div class="mt-5 grid grid-cols-2 gap-2">
        <Button variant="secondary" @click="deleteOpen = false">아니요</Button>
        <Button variant="destructive" @click="doDelete">삭제</Button>
      </div>
    </Modal>
  </div>
</template>
