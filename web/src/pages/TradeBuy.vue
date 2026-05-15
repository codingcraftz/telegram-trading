<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowUpRight, ArrowDownRight, Zap, Calendar } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import Modal from '@/components/ui/Modal.vue';
import SymbolSearch from '@/components/SymbolSearch.vue';
import { api, type QuoteResponse, type SearchItem, type TradeBuyBody } from '@/api/client';
import { fmtKrw, fmtPct, pflsColor } from '@/lib/format';
import { toast } from '@/lib/toast';

const route = useRoute();
const router = useRouter();

const code = ref<string>((route.query.code as string) ?? '');
const quote = ref<QuoteResponse | null>(null);
const balance = ref<{ cash: number } | null>(null);

const strategy = ref<'now' | 'mo'>('now');
const tp = ref<string>('');
const sl = ref<string>('');
const amountMode = ref<'percent' | 'amount' | 'shares'>('percent');
const amountValue = ref<number>(10);

const submitting = ref(false);
const confirmOpen = ref(false);

async function loadQuote() {
  if (!code.value) {
    quote.value = null;
    return;
  }
  try {
    quote.value = await api.quote(code.value);
  } catch (err) {
    console.warn(err);
  }
}

async function loadBalance() {
  try {
    const b = await api.balance();
    balance.value = { cash: b.cash };
  } catch {
    balance.value = null;
  }
}

function pickSymbol(item: SearchItem) {
  code.value = item.code;
  router.replace({ query: { code: item.code } });
}

const estimate = computed(() => {
  if (!quote.value || !balance.value) return null;
  const price = quote.value.price;
  if (price <= 0) return null;
  let qty = 0;
  let budget = 0;
  if (amountMode.value === 'percent') {
    budget = (balance.value.cash * amountValue.value) / 100;
    qty = Math.floor(budget / price);
  } else if (amountMode.value === 'amount') {
    budget = amountValue.value;
    qty = Math.floor(budget / price);
  } else {
    qty = Math.floor(amountValue.value);
    budget = qty * price;
  }
  return { qty, budget };
});

function openConfirm() {
  if (!code.value) { toast.error('종목을 선택하세요'); return; }
  if (!amountValue.value || amountValue.value <= 0) { toast.error('수량을 입력하세요'); return; }
  if (estimate.value && estimate.value.qty <= 0) { toast.error('계산된 수량이 0주입니다'); return; }
  confirmOpen.value = true;
}

async function submit() {
  if (submitting.value) return;
  submitting.value = true;
  try {
    const body: TradeBuyBody = {
      code: code.value,
      strategy: strategy.value,
      amount: { mode: amountMode.value, value: Number(amountValue.value) },
      tp: tp.value === '' ? null : Number(tp.value),
      sl: sl.value === '' ? null : Number(sl.value),
    };
    const reg = await api.tradeBuy(body);
    const r = await api.tradeConfirm(reg.id);
    if (r.ok) {
      toast.success(r.message || '매수 발주 완료');
      confirmOpen.value = false;
      await loadBalance();
      router.push('/orders');
    } else {
      toast.error(r.message || '거절됨');
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
  <div class="space-y-3">
    <div class="px-1">
      <h2 class="text-base font-semibold tracking-tight">매수</h2>
    </div>

    <SymbolSearch placeholder="종목명 또는 6자리 코드" @pick="pickSymbol" />

    <Card v-if="quote">
      <div class="flex items-start justify-between">
        <div>
          <p class="text-sm font-semibold">{{ quote.name }}</p>
          <p class="text-[10px] text-muted-foreground tabular-nums">{{ quote.code }}</p>
        </div>
        <div class="text-right tabular-nums">
          <p class="text-xl font-bold tracking-tighter">{{ fmtKrw(quote.price) }}</p>
          <p class="text-xs font-medium" :class="pflsColor(quote.change)">{{ fmtPct(quote.changeRate) }}</p>
        </div>
      </div>
      <p v-if="balance" class="mt-3 border-t border-border pt-2 text-[11px] text-muted-foreground">
        예수금 <span class="ml-1 font-semibold text-foreground tabular-nums">{{ fmtKrw(balance.cash) }}</span>
      </p>
    </Card>

    <Card v-if="code">
      <template #header>
        <h3 class="text-sm font-semibold tracking-tight">전략</h3>
      </template>
      <div class="grid grid-cols-2 gap-2">
        <button
          class="flex flex-col items-center gap-1 rounded-xl py-3 transition"
          :class="strategy === 'now' ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-foreground hover:bg-muted'"
          @click="strategy = 'now'"
        >
          <Zap class="h-4 w-4" />
          <span class="text-xs font-semibold">즉시 매수</span>
        </button>
        <button
          class="flex flex-col items-center gap-1 rounded-xl py-3 transition"
          :class="strategy === 'mo' ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-foreground hover:bg-muted'"
          @click="strategy = 'mo'"
        >
          <Calendar class="h-4 w-4" />
          <span class="text-xs font-semibold">시가 매매</span>
        </button>
      </div>
      <p class="mt-2 text-[11px] text-muted-foreground">
        {{ strategy === 'now' ? '현재 세션에 맞게 즉시 발주' : '다음 영업일 09:00:05 시장가' }}
      </p>
    </Card>

    <Card v-if="code && strategy === 'now'">
      <template #header>
        <h3 class="text-sm font-semibold tracking-tight">목표가 / 손절</h3>
      </template>
      <div class="grid grid-cols-2 gap-2">
        <label class="block">
          <span class="text-[11px] font-medium text-muted-foreground">TP %</span>
          <input
            v-model="tp"
            type="number"
            step="0.5"
            placeholder="—"
            class="mt-1 w-full rounded-lg bg-muted/40 px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <label class="block">
          <span class="text-[11px] font-medium text-muted-foreground">SL %</span>
          <input
            v-model="sl"
            type="number"
            step="0.5"
            placeholder="—"
            class="mt-1 w-full rounded-lg bg-muted/40 px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
      </div>
    </Card>

    <Card v-if="code">
      <template #header>
        <h3 class="text-sm font-semibold tracking-tight">수량</h3>
      </template>
      <div class="grid grid-cols-3 gap-1.5">
        <button
          v-for="m in [{k:'percent',l:'비율'},{k:'amount',l:'금액'},{k:'shares',l:'주식수'}]"
          :key="m.k"
          class="rounded-lg py-2 text-xs font-semibold transition"
          :class="amountMode === m.k ? 'bg-primary text-primary-foreground' : 'bg-muted/50 hover:bg-muted'"
          @click="amountMode = m.k as 'percent'|'amount'|'shares'"
        >
          {{ m.l }}
        </button>
      </div>
      <input
        v-model.number="amountValue"
        type="number"
        :placeholder="amountMode === 'percent' ? '10' : amountMode === 'amount' ? '500000' : '10'"
        class="mt-3 w-full rounded-lg bg-muted/40 px-3 py-2.5 text-base font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <div v-if="amountMode === 'percent'" class="mt-2 grid grid-cols-5 gap-1">
        <button
          v-for="p in [10, 20, 30, 50, 100]" :key="p"
          class="rounded-md bg-muted/50 py-1.5 text-[11px] font-semibold hover:bg-muted"
          @click="amountValue = p"
        >
          {{ p === 100 ? 'MAX' : `${p}%` }}
        </button>
      </div>
      <div v-if="estimate" class="mt-3 rounded-xl bg-muted/30 px-3 py-2.5">
        <p class="text-[10px] text-muted-foreground">예상</p>
        <p class="mt-0.5 text-sm font-semibold tabular-nums">
          {{ estimate.qty }}주 · {{ fmtKrw(estimate.budget) }}
        </p>
      </div>
    </Card>

    <Button v-if="code" variant="primary" size="lg" class="w-full" @click="openConfirm">
      <ArrowUpRight class="mr-1 h-4 w-4" />매수
    </Button>

    <Modal :open="confirmOpen" title="매수 발주" @close="confirmOpen = false">
      <div class="space-y-3 text-sm">
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">종목</span>
          <span class="font-semibold">{{ quote?.name }} <span class="text-[10px] text-muted-foreground tabular-nums">{{ code }}</span></span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">현재가</span>
          <span class="font-semibold tabular-nums">{{ quote ? fmtKrw(quote.price) : '—' }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">전략</span>
          <span class="font-semibold">{{ strategy === 'now' ? '즉시 매수' : '시가 매매 (다음 영업일)' }}</span>
        </div>
        <div v-if="estimate" class="flex items-center justify-between">
          <span class="text-muted-foreground">수량</span>
          <span class="font-semibold tabular-nums">{{ estimate.qty }}주 · {{ fmtKrw(estimate.budget) }}</span>
        </div>
        <div v-if="strategy === 'now' && (tp || sl)" class="flex items-center justify-between">
          <span class="text-muted-foreground">TP / SL</span>
          <span class="font-semibold tabular-nums">
            <span v-if="tp" class="text-up">+{{ tp }}%</span><span v-if="tp && sl"> · </span><span v-if="sl" class="text-down">{{ sl }}%</span>
          </span>
        </div>
      </div>
      <div class="mt-5 grid grid-cols-2 gap-2">
        <Button variant="secondary" :disabled="submitting" @click="confirmOpen = false">취소</Button>
        <Button variant="primary" :disabled="submitting" @click="submit">
          {{ submitting ? '발주 중…' : '발주' }}
        </Button>
      </div>
    </Modal>
  </div>
</template>
