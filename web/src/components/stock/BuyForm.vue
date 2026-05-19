<script setup lang="ts">
// BuyForm — 풀 기능 매수 BottomSheet.
// 3-way 모드: 시장가 / 지정가 / 전략매매 (저장된 전략 적용).
import { computed, ref, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ChevronDown, Sparkles, Plus, AlertTriangle } from 'lucide-vue-next';
import BottomSheet from '@/components/ui/BottomSheet.vue';
import Button from '@/components/ui/Button.vue';
import PriceStepper from '@/components/PriceStepper.vue';
import InfoTooltip from '@/components/InfoTooltip.vue';
import { api, type TradeBuyBody, type StrategyItem } from '@/api/client';
import { fmtKrw } from '@/lib/format';
import { toast } from '@/lib/toast';

const props = withDefaults(defineProps<{
  open: boolean;
  code: string;
  name: string;
  currentPrice: number;
  availableCash: number;
  initialPrice?: number;
  initialPriceMode?: 'market' | 'limit';
}>(), { initialPriceMode: 'market', initialPrice: 0 });

const emit = defineEmits<{ close: []; success: [] }>();

const router = useRouter();

type Mode = 'market' | 'limit' | 'strategy';
const mode = ref<Mode>('market');
const limitPrice = ref<number>(0);
const qty = ref<number>(1);
const tpEnabled = ref(false);
const slEnabled = ref(false);
const tpPct = ref<number>(5);
const slPct = ref<number>(3);
const autoSellOpen = ref(false);
const submitting = ref(false);
const confirmStage = ref(false);

// 종목별 정확한 매수가능금액 — /api/orderable (KIS inquire_psbl_order).
// 실패 시 props.availableCash(예수금 추정치)로 fallback.
const orderableCash = ref<number | null>(null);
const orderableQty = ref<number | null>(null);
const orderableLoading = ref(false);
let orderableDebounce: ReturnType<typeof setTimeout> | null = null;

async function fetchOrderable(refPrice: number) {
  if (!props.code || refPrice <= 0) return;
  orderableLoading.value = true;
  try {
    const r = await api.orderable(props.code, refPrice);
    if (r.cash !== null) {
      orderableCash.value = r.cash;
      orderableQty.value = r.qty;
    } else {
      orderableCash.value = null;
      orderableQty.value = r.qty;
    }
  } catch {
    orderableCash.value = null;
    orderableQty.value = null;
  } finally { orderableLoading.value = false; }
}

function scheduleOrderable(refPrice: number) {
  if (orderableDebounce) clearTimeout(orderableDebounce);
  orderableDebounce = setTimeout(() => fetchOrderable(refPrice), 400);
}

// 전략매매
const strategies = ref<StrategyItem[]>([]);
const strategyLoading = ref(false);
const selectedStrategyId = ref<string | null>(null);
const selectedStrategy = computed<StrategyItem | null>(
  () => strategies.value.find((s) => s.id === selectedStrategyId.value) ?? null,
);

async function loadStrategies() {
  strategyLoading.value = true;
  try {
    const r = await api.strategies();
    strategies.value = r.items.filter((s) => s.active);
  } catch (err) {
    toast.error((err as Error).message);
  } finally { strategyLoading.value = false; }
}

watch(mode, (m) => {
  if (m === 'strategy' && strategies.value.length === 0 && !strategyLoading.value) {
    loadStrategies();
  }
});

watch(() => props.open, (v) => {
  if (!v) return;
  mode.value = props.initialPriceMode;
  limitPrice.value = props.initialPrice > 0 ? props.initialPrice : props.currentPrice;
  qty.value = 1;
  confirmStage.value = false;
  autoSellOpen.value = false;
  submitting.value = false;
  selectedStrategyId.value = null;
  orderableCash.value = null;
  orderableQty.value = null;
  // 정확한 종목별 한도 조회 — 시장가/지정가 기본가격 기준
  const ref0 = props.initialPrice > 0 ? props.initialPrice : props.currentPrice;
  if (ref0 > 0) fetchOrderable(ref0);
});

// 지정가 가격 변경 시 디바운스로 재조회
watch(limitPrice, (p) => {
  if (!props.open) return;
  if (mode.value !== 'limit') return;
  if (p > 0) scheduleOrderable(p);
});

onMounted(async () => {
  try {
    const s = await api.strategy();
    if (s.tpPct && s.tpPct > 0) tpPct.value = s.tpPct;
    if (s.slPct && s.slPct > 0) slPct.value = s.slPct;
  } catch {}
});

function tickSize(p: number): number {
  if (p < 1_000) return 1;
  if (p < 5_000) return 5;
  if (p < 10_000) return 10;
  if (p < 50_000) return 50;
  if (p < 100_000) return 100;
  if (p < 500_000) return 500;
  return 1_000;
}

const stepperStep = computed(() => tickSize(limitPrice.value || props.currentPrice));

const basePrice = computed(() =>
  mode.value === 'limit' && limitPrice.value > 0 ? limitPrice.value : props.currentPrice,
);
// 종목별 KIS 정확치 우선, 없으면 props.availableCash(예수금 추정치) fallback
const effectiveCash = computed(() => orderableCash.value ?? props.availableCash);
const maxQty = computed(() => {
  // KIS가 직접 알려준 max_buy_qty가 가장 정확 (호가 단위까지 반영)
  if (orderableQty.value !== null && orderableQty.value > 0) return orderableQty.value;
  return basePrice.value <= 0 ? 0 : Math.floor(effectiveCash.value / basePrice.value);
});
const totalAmount = computed(() => qty.value * basePrice.value);

function setPct(p: number) {
  if (basePrice.value <= 0) return;
  if (p === 100) { qty.value = Math.max(1, maxQty.value); return; }
  qty.value = Math.max(1, Math.floor((maxQty.value * p) / 100));
}

const canSubmit = computed(() => {
  if (submitting.value) return false;
  if (mode.value === 'strategy') return !!selectedStrategyId.value;
  if (qty.value < 1) return false;
  if (mode.value === 'limit' && limitPrice.value <= 0) return false;
  return true;
});

function strategySummary(s: StrategyItem): string {
  const e = s.definition.entry;
  if (e.type === 'morning') return '내일 시가 매수';
  if (e.type === 'limit_price') {
    const dir = e.direction === 'above' ? '이상' : '이하';
    return `${fmtKrw(e.targetPrice)}원 ${dir} 도달 시`;
  }
  if (e.type === 'morning_staged') {
    const parts: string[] = [];
    const stages = e.stages.map((st) => `${st.entryPct}%`).join('/');
    parts.push(`분할 ${stages}`);
    if (e.takeProfit?.tp1?.enabled) parts.push(`TP1 +${e.takeProfit.tp1.atPct}%`);
    if (e.takeProfit?.tp2?.enabled) parts.push(`TP2 +${e.takeProfit.tp2.atPct}%`);
    if (e.stopLoss?.enabled) parts.push(`SL −${e.stopLoss.atPct}%`);
    return parts.join(' · ');
  }
  return '';
}

async function submit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  try {
    if (mode.value === 'strategy') {
      await api.applyStrategy(selectedStrategyId.value!, { stockCode: props.code });
      toast.success(`"${selectedStrategy.value!.name}" 적용됐어요`);
      emit('success');
      return;
    }
    const body: TradeBuyBody = {
      code: props.code,
      strategy: 'now',
      amount: { mode: 'shares', value: qty.value },
      tp: tpEnabled.value && tpPct.value > 0 ? tpPct.value : null,
      sl: slEnabled.value && slPct.value > 0 ? slPct.value : null,
      limitPrice: mode.value === 'limit' && limitPrice.value > 0 ? limitPrice.value : null,
      execute: true,
    };
    const reg = await api.tradeBuy(body);
    if (reg.result) {
      if (reg.result.ok) { toast.success('주문이 접수되었습니다'); emit('success'); }
      else { toast.error(reg.result.message || '주문이 거절됐어요'); confirmStage.value = false; }
    } else { toast.success('주문이 접수되었습니다'); emit('success'); }
  } catch (err) {
    const msg = (err as Error).message;
    if (/already_applied/i.test(msg)) toast.info('이미 적용된 전략이에요');
    else toast.error(msg);
    confirmStage.value = false;
  } finally { submitting.value = false; }
}

function gotoNewStrategy() {
  emit('close');
  router.push('/more/strategy/new');
}
</script>

<template>
  <BottomSheet :open="open" @close="emit('close')">
    <template #default>
      <div class="space-y-4">
        <!-- 제목 -->
        <div>
          <p class="text-[11px] text-muted-foreground">{{ name }}</p>
          <p class="mt-1 text-lg font-bold tracking-tight text-up">
            {{ mode === 'strategy' ? '전략매매' : '매수' }}
          </p>
        </div>

        <template v-if="!confirmStage">
          <!-- 모드 -->
          <div class="inline-flex w-full rounded-xl bg-muted p-1">
            <button
              type="button"
              class="flex-1 rounded-lg py-1.5 text-xs font-semibold transition"
              :class="mode === 'market' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'"
              @click="mode = 'market'"
            >시장가</button>
            <button
              type="button"
              class="flex-1 rounded-lg py-1.5 text-xs font-semibold transition"
              :class="mode === 'limit' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'"
              @click="mode = 'limit'"
            >지정가</button>
            <button
              type="button"
              class="flex-1 rounded-lg py-1.5 text-xs font-semibold transition"
              :class="mode === 'strategy' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'"
              @click="mode = 'strategy'"
            >전략매매</button>
          </div>

          <!-- 시장가/지정가 흐름 -->
          <template v-if="mode !== 'strategy'">
            <!-- 가격 표시/입력 -->
            <div v-if="mode === 'market'" class="flex items-baseline justify-between rounded-xl bg-muted/40 px-3 py-2.5">
              <span class="text-lg font-bold tabular-nums">{{ fmtKrw(currentPrice) }}원</span>
              <span class="text-[10px] text-muted-foreground">시장가로 즉시 체결</span>
            </div>
            <div v-else>
              <PriceStepper v-model="limitPrice" :step="stepperStep" :min="0" suffix="원" compact />
              <p class="mt-1 text-center text-[10px] text-muted-foreground">호가를 눌러도 자동 입력돼요</p>
            </div>

            <!-- 수량 -->
            <div>
              <div class="mb-1.5 flex items-center justify-between">
                <p class="text-[11px] font-semibold text-muted-foreground">수량</p>
                <p class="text-[10px] text-muted-foreground tabular-nums">최대 {{ maxQty }}주</p>
              </div>
              <PriceStepper v-model="qty" :step="1" :min="1" suffix="주" compact />
              <div class="mt-1.5 grid grid-cols-4 gap-1">
                <button
                  v-for="p in [10, 25, 50, 100]" :key="p"
                  type="button"
                  class="rounded-md bg-muted/50 py-1.5 text-[10px] font-semibold transition hover:bg-muted"
                  @click="setPct(p)"
                >
                  {{ p === 100 ? '전부' : `${p}%` }}
                </button>
              </div>
            </div>

            <!-- 자동매도 -->
            <div class="rounded-xl border border-border/60 dark:border-0 bg-muted/30">
              <button
                type="button"
                class="flex w-full items-center justify-between px-3 py-2.5"
                @click="autoSellOpen = !autoSellOpen"
              >
                <span class="text-xs font-semibold">자동 매도 설정 (선택)</span>
                <ChevronDown class="h-4 w-4 text-muted-foreground transition-transform" :class="autoSellOpen ? 'rotate-180' : ''" />
              </button>
              <div v-if="autoSellOpen" class="space-y-3 border-t border-border/60 px-3 py-3">
                <div>
                  <label class="flex items-center gap-2">
                    <input type="checkbox" v-model="tpEnabled" class="peer sr-only" />
                    <span class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-muted transition peer-checked:bg-primary">
                      <span class="inline-block h-4 w-4 transform rounded-full bg-card shadow transition" :class="tpEnabled ? 'translate-x-[1.125rem]' : 'translate-x-0.5'" />
                    </span>
                    <span class="flex flex-1 items-center gap-1 text-sm font-medium">
                      목표가 도달 시 매도
                      <InfoTooltip title="목표가 자동 매도" description="매수가 대비 입력한 % 만큼 오르면 자동 매도." />
                    </span>
                  </label>
                  <div v-if="tpEnabled" class="mt-2 flex items-center gap-2">
                    <input v-model.number="tpPct" type="number" step="0.5" min="0"
                      class="flex-1 rounded-lg bg-muted/40 px-3 py-2 text-base font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-primary" />
                    <span class="text-sm font-semibold text-up">%</span>
                  </div>
                </div>
                <div>
                  <label class="flex items-center gap-2">
                    <input type="checkbox" v-model="slEnabled" class="peer sr-only" />
                    <span class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-muted transition peer-checked:bg-primary">
                      <span class="inline-block h-4 w-4 transform rounded-full bg-card shadow transition" :class="slEnabled ? 'translate-x-[1.125rem]' : 'translate-x-0.5'" />
                    </span>
                    <span class="flex flex-1 items-center gap-1 text-sm font-medium">
                      손해 막기 (손절)
                      <InfoTooltip title="손해 막기" description="매수가 대비 입력한 % 만큼 떨어지면 자동 매도." />
                    </span>
                  </label>
                  <div v-if="slEnabled" class="mt-2 flex items-center gap-2">
                    <input v-model.number="slPct" type="number" step="0.5" min="0"
                      class="flex-1 rounded-lg bg-muted/40 px-3 py-2 text-base font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-primary" />
                    <span class="text-sm font-semibold text-down">%</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 요약 -->
            <div class="space-y-1 rounded-xl bg-primary/10 px-3 py-2.5 tabular-nums">
              <div class="flex items-baseline justify-between">
                <span class="text-[11px] text-muted-foreground">예상 매수액</span>
                <span class="text-base font-bold">{{ fmtKrw(totalAmount) }}원</span>
              </div>
              <div class="flex items-baseline justify-between text-[10px] text-muted-foreground">
                <span>
                  매수가능
                  <span v-if="orderableLoading" class="ml-1 text-[9px]">조회 중…</span>
                  <span v-else-if="orderableCash === null" class="ml-1 text-[9px]">(추정)</span>
                </span>
                <span>{{ fmtKrw(effectiveCash) }}원</span>
              </div>
            </div>
          </template>

          <!-- 전략매매 흐름 -->
          <template v-else>
            <div class="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2.5 text-[11px] leading-relaxed text-amber-900 dark:text-amber-200">
              <AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>전략은 등록되지만 즉시 발주되지 않아요. 조건이 맞을 때 자동 매매가 시작됩니다.</span>
            </div>

            <div v-if="strategyLoading" class="space-y-1.5">
              <div v-for="n in 3" :key="n" class="h-[72px] animate-pulse rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0" />
            </div>

            <div v-else-if="strategies.length > 0" class="space-y-1.5">
              <button
                v-for="s in strategies"
                :key="s.id"
                type="button"
                class="flex w-full items-start gap-3 rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 px-4 py-3 text-left transition active:scale-[0.99]"
                :class="selectedStrategyId === s.id ? 'ring-2 ring-primary' : ''"
                @click="selectedStrategyId = s.id"
              >
                <Sparkles class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-bold">{{ s.name }}</p>
                  <p class="mt-0.5 truncate text-[10px] text-muted-foreground">{{ strategySummary(s) }}</p>
                  <p class="mt-0.5 text-[10px] text-muted-foreground">적용 종목 {{ s.applicationCount }}개</p>
                </div>
              </button>
            </div>

            <div v-else class="rounded-2xl bg-muted/30 px-5 py-8 text-center">
              <Sparkles class="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
              <p class="text-sm font-bold">활성 전략이 없어요</p>
              <p class="mt-1 text-[11px] text-muted-foreground">먼저 전략을 만들어주세요.</p>
              <button
                type="button"
                class="mt-3 inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground"
                @click="gotoNewStrategy"
              >
                <Plus class="h-3.5 w-3.5" />
                전략 만들기
              </button>
            </div>
          </template>
        </template>

        <!-- 확인 단계 (시장가/지정가) -->
        <template v-else>
          <div class="space-y-2 rounded-xl border border-border/60 dark:border-0 bg-muted/30 px-4 py-3 text-sm">
            <div class="flex justify-between"><span class="text-muted-foreground">가격</span>
              <span class="font-semibold tabular-nums">
                <template v-if="mode === 'limit'">{{ fmtKrw(limitPrice) }}원 지정가</template>
                <template v-else>{{ fmtKrw(currentPrice) }}원 시장가</template>
              </span>
            </div>
            <div class="flex justify-between"><span class="text-muted-foreground">수량</span>
              <span class="font-semibold tabular-nums">{{ qty }}주</span>
            </div>
            <div class="flex justify-between"><span class="text-muted-foreground">예상 매수액</span>
              <span class="font-semibold tabular-nums">{{ fmtKrw(totalAmount) }}원</span>
            </div>
            <div v-if="(tpEnabled && tpPct > 0) || (slEnabled && slPct > 0)" class="border-t border-border pt-2 text-xs">
              <span class="text-muted-foreground">자동매도</span>
              <span v-if="tpEnabled && tpPct > 0" class="ml-1 text-up">+{{ tpPct }}%</span>
              <span v-if="tpEnabled && tpPct > 0 && slEnabled && slPct > 0"> · </span>
              <span v-if="slEnabled && slPct > 0" class="text-down">−{{ slPct }}%</span>
            </div>
          </div>
          <p class="text-[11px] text-muted-foreground">확인 누르면 곧바로 증권사로 주문이 전송돼요.</p>
        </template>
      </div>
    </template>

    <template #footer>
      <!-- 전략매매: 확인 단계 없이 즉시 적용 -->
      <Button
        v-if="mode === 'strategy'"
        variant="primary"
        size="lg"
        class="w-full"
        :disabled="!canSubmit"
        @click="submit"
      >
        {{ submitting ? '적용 중…' : '전략 적용하기' }}
      </Button>
      <!-- 시장가/지정가: 확인 단계 거침 -->
      <Button
        v-else-if="!confirmStage"
        variant="primary"
        size="lg"
        class="w-full bg-up text-white hover:bg-up/90"
        :disabled="!canSubmit"
        @click="confirmStage = true"
      >
        {{ qty }}주 매수하기
      </Button>
      <div v-else class="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="lg" :disabled="submitting" @click="confirmStage = false">돌아가기</Button>
        <Button variant="primary" size="lg" class="bg-up text-white hover:bg-up/90" :disabled="submitting" @click="submit">
          {{ submitting ? '보내는 중…' : '매수 확정' }}
        </Button>
      </div>
    </template>
  </BottomSheet>
</template>
