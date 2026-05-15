<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ChevronLeft, ChevronDown, ArrowUpRight, ArrowDownRight, Zap, Calendar } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import Modal from '@/components/ui/Modal.vue';
import SymbolSearch from '@/components/SymbolSearch.vue';
import PriceStepper from '@/components/PriceStepper.vue';
import InfoTooltip from '@/components/InfoTooltip.vue';
import { api, type QuoteResponse, type SearchItem, type TradeBuyBody } from '@/api/client';
import { fmtKrw, fmtPct, pflsColor } from '@/lib/format';
import { toast } from '@/lib/toast';
import { usePrefs } from '@/stores/prefs';

const route = useRoute();
const router = useRouter();
const prefs = usePrefs();
const isAdvanced = computed(() => prefs.mode === 'advanced');

const code = ref<string>((route.query.code as string) ?? '');
const quote = ref<QuoteResponse | null>(null);
const cash = ref<number>(0);

const strategy = ref<'now' | 'mo'>('now');
const amountMode = ref<'percent' | 'amount' | 'shares'>('amount');
const amount = ref<number>(100_000);
const tp = ref<string>('');
const sl = ref<string>('');
const detailsOpen = ref(false);

const submitting = ref(false);
const confirmOpen = ref(false);

async function loadQuote() {
  if (!code.value) { quote.value = null; return; }
  try {
    quote.value = await api.quote(code.value);
  } catch (err) {
    console.warn(err);
  }
}

async function loadBalance() {
  try {
    const b = await api.balance();
    cash.value = b.cash;
  } catch { /* silent */ }
}

function pickSymbol(item: SearchItem) {
  code.value = item.code;
  router.replace({ query: { code: item.code } });
}

const stepperStep = computed(() => {
  const p = quote.value?.price ?? 50_000;
  if (p < 1_000) return 1_000;
  if (p < 10_000) return 5_000;
  if (p < 100_000) return 10_000;
  return 50_000;
});

const estimateQty = computed(() => {
  if (!quote.value || quote.value.price <= 0) return 0;
  if (amountMode.value === 'shares') return Math.floor(amount.value);
  if (amountMode.value === 'percent') return Math.floor((cash.value * amount.value / 100) / quote.value.price);
  return Math.floor(amount.value / quote.value.price);
});

const estimateBudget = computed(() => {
  if (!quote.value) return 0;
  return estimateQty.value * quote.value.price;
});

function setPercent(p: number) {
  amountMode.value = 'amount';
  amount.value = Math.floor((cash.value * p) / 100);
}

function openConfirm() {
  if (!code.value) { toast.error('종목을 먼저 선택해 주세요'); return; }
  if (estimateQty.value <= 0) { toast.error('살 수 있는 수량이 0주예요'); return; }
  confirmOpen.value = true;
}

async function submit() {
  if (submitting.value) return;
  submitting.value = true;
  try {
    const body: TradeBuyBody = {
      code: code.value,
      strategy: strategy.value,
      amount: { mode: amountMode.value, value: amount.value },
      tp: tp.value === '' ? null : Number(tp.value),
      sl: sl.value === '' ? null : Number(sl.value),
    };
    const reg = await api.tradeBuy(body);
    const r = await api.tradeConfirm(reg.id);
    if (r.ok) {
      toast.success(strategy.value === 'now' ? '주문 넣었어요' : '내일 시가에 살 예약 됐어요');
      confirmOpen.value = false;
      router.push('/orders');
    } else {
      toast.error(r.message || '주문이 거절됐어요');
    }
  } catch (err) {
    toast.error((err as Error).message);
  } finally {
    submitting.value = false;
  }
}

watch(code, loadQuote);
onMounted(() => {
  loadQuote();
  loadBalance();
});
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-2 px-1">
      <button class="-ml-2 rounded-md p-2 text-muted-foreground transition hover:bg-accent" @click="router.back()">
        <ChevronLeft class="h-5 w-5" />
      </button>
      <h2 class="text-lg font-bold tracking-tight">사기</h2>
    </div>

    <SymbolSearch v-if="!code" placeholder="종목 이름 또는 6자리 코드" @pick="pickSymbol" />

    <Card v-if="quote">
      <p class="text-sm font-semibold">{{ quote.name }}</p>
      <p class="mt-0.5 text-[10px] text-muted-foreground tabular-nums">{{ quote.code }}</p>
      <div class="mt-3 flex items-end justify-between">
        <p class="text-2xl font-bold tabular-nums tracking-tighter">{{ fmtKrw(quote.price) }}</p>
        <p class="flex items-center gap-0.5 text-sm font-semibold tabular-nums" :class="pflsColor(quote.change)">
          <ArrowUpRight v-if="quote.change > 0" class="h-3.5 w-3.5" />
          <ArrowDownRight v-else-if="quote.change < 0" class="h-3.5 w-3.5" />
          {{ fmtPct(quote.changeRate) }}
        </p>
      </div>
      <div class="mt-3 flex items-center gap-2 border-t border-border pt-2.5 text-xs">
        <span class="text-muted-foreground">살 수 있는 돈</span>
        <span class="ml-auto font-semibold tabular-nums">{{ fmtKrw(cash) }}</span>
      </div>
    </Card>

    <!-- 언제 살까요? -->
    <Card v-if="code">
      <template #header>
        <h3 class="text-sm font-bold tracking-tight">언제 살까요?</h3>
      </template>
      <div class="grid grid-cols-2 gap-2">
        <button
          class="flex flex-col items-start gap-1 rounded-2xl border-2 p-3 text-left transition"
          :class="strategy === 'now' ? 'border-primary bg-primary/5' : 'border-transparent bg-muted/50'"
          @click="strategy = 'now'"
        >
          <Zap class="h-4 w-4" :class="strategy === 'now' ? 'text-primary' : 'text-muted-foreground'" />
          <span class="text-sm font-semibold">지금 사기</span>
          <span class="text-[11px] leading-snug text-muted-foreground">현재 가격으로<br/>곧바로 매수</span>
        </button>
        <button
          class="flex flex-col items-start gap-1 rounded-2xl border-2 p-3 text-left transition"
          :class="strategy === 'mo' ? 'border-primary bg-primary/5' : 'border-transparent bg-muted/50'"
          @click="strategy = 'mo'"
        >
          <Calendar class="h-4 w-4" :class="strategy === 'mo' ? 'text-primary' : 'text-muted-foreground'" />
          <span class="text-sm font-semibold">내일 시가에 사기</span>
          <span class="text-[11px] leading-snug text-muted-foreground">다음 거래일<br/>09:00 시작가</span>
        </button>
      </div>
    </Card>

    <!-- 얼마나 살까요? -->
    <Card v-if="code">
      <template #header>
        <h3 class="text-sm font-bold tracking-tight">얼마나 살까요?</h3>
      </template>

      <!-- 고급 모드: 모드 토글 노출 -->
      <div v-if="isAdvanced" class="mb-3 inline-flex w-full rounded-xl bg-muted p-1">
        <button
          v-for="m in [{k:'amount',l:'금액'},{k:'percent',l:'비율'},{k:'shares',l:'주식수'}]"
          :key="m.k"
          class="flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition"
          :class="amountMode === m.k ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'"
          @click="amountMode = m.k as 'amount'|'percent'|'shares'"
        >
          {{ m.l }}
        </button>
      </div>

      <PriceStepper
        v-if="amountMode === 'amount'"
        v-model="amount"
        :step="stepperStep"
        :min="0"
        suffix="원"
      />
      <PriceStepper
        v-else-if="amountMode === 'shares'"
        v-model="amount"
        :step="1"
        :min="0"
        suffix="주"
      />
      <div v-else class="rounded-2xl bg-muted/40 px-3 py-3 text-center">
        <p class="text-2xl font-bold tabular-nums">{{ amount }}%</p>
      </div>

      <div v-if="amountMode === 'amount'" class="mt-3">
        <p class="mb-1.5 text-[11px] text-muted-foreground">살 수 있는 돈의</p>
        <div class="grid grid-cols-4 gap-1.5">
          <button
            v-for="p in [10, 25, 50, 100]" :key="p"
            class="rounded-lg bg-muted/50 py-2 text-xs font-semibold transition hover:bg-muted"
            @click="setPercent(p)"
          >
            {{ p === 100 ? '전부' : `${p}%` }}
          </button>
        </div>
      </div>

      <p class="mt-3 text-center text-xs text-muted-foreground tabular-nums">
        대략 <span class="font-bold text-foreground">{{ estimateQty }}주</span>
        ({{ fmtKrw(estimateBudget) }}) 살 예정
      </p>
    </Card>

    <!-- 자세한 옵션 (TP/SL) -->
    <Card v-if="code && strategy === 'now'">
      <button class="-mx-1 flex w-full items-center justify-between px-1 py-0.5" @click="detailsOpen = !detailsOpen">
        <h3 class="text-sm font-bold tracking-tight">자세한 옵션</h3>
        <ChevronDown class="h-4 w-4 text-muted-foreground transition-transform" :class="detailsOpen ? 'rotate-180' : ''" />
      </button>
      <div v-if="detailsOpen || isAdvanced" class="mt-3 space-y-3 border-t border-border pt-3">
        <label class="block">
          <span class="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            목표가 도달 시 자동 매도 (%)
            <InfoTooltip title="목표가 자동 매도" description="매수한 가격 대비 입력한 % 만큼 오르면 자동으로 매도해요. 비워두면 자동 매도하지 않아요." />
          </span>
          <input
            v-model="tp"
            type="number"
            step="0.5"
            placeholder="예: 5"
            class="mt-1 w-full rounded-lg bg-muted/40 px-3 py-2.5 text-base font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <label class="block">
          <span class="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            손해 막기 자동 매도 (%)
            <InfoTooltip title="손해 막기" description="매수한 가격 대비 입력한 % 만큼 떨어지면 자동으로 매도해 큰 손실을 막아요. 비워두면 자동 매도하지 않아요." />
          </span>
          <input
            v-model="sl"
            type="number"
            step="0.5"
            placeholder="예: 3"
            class="mt-1 w-full rounded-lg bg-muted/40 px-3 py-2.5 text-base font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
      </div>
    </Card>

    <Button v-if="code" variant="primary" size="lg" class="w-full" @click="openConfirm">
      사기 ({{ estimateQty }}주)
    </Button>

    <Modal :open="confirmOpen" title="확인할게요" @close="confirmOpen = false">
      <div class="space-y-3 text-sm">
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">종목</span>
          <span class="font-semibold">{{ quote?.name }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">언제</span>
          <span class="font-semibold">{{ strategy === 'now' ? '지금' : '내일 시가' }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">수량</span>
          <span class="font-semibold tabular-nums">{{ estimateQty }}주 · 약 {{ fmtKrw(estimateBudget) }}</span>
        </div>
        <div v-if="strategy === 'now' && (tp || sl)" class="border-t border-border pt-3">
          <p class="text-[11px] text-muted-foreground">자동 매도 설정</p>
          <p class="mt-1 text-xs tabular-nums">
            <span v-if="tp" class="text-up">목표가 +{{ tp }}%</span>
            <span v-if="tp && sl"> · </span>
            <span v-if="sl" class="text-down">손절 {{ sl }}%</span>
          </p>
        </div>
      </div>
      <div class="mt-5 grid grid-cols-2 gap-2">
        <Button variant="secondary" :disabled="submitting" @click="confirmOpen = false">취소</Button>
        <Button variant="primary" :disabled="submitting" @click="submit">
          {{ submitting ? '주문 중…' : '주문 넣기' }}
        </Button>
      </div>
    </Modal>
  </div>
</template>
