<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Check, X } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import SymbolSearch from '@/components/SymbolSearch.vue';
import { api, type QuoteResponse, type SearchItem, type TradeBuyBody } from '@/api/client';
import { fmtKrw, fmtPct, pflsColor } from '@/lib/format';

const route = useRoute();
const router = useRouter();

const code = ref<string>((route.query.code as string) ?? '');
const quote = ref<QuoteResponse | null>(null);
const balance = ref<{ cash: number } | null>(null);

const strategy = ref<'now' | 'mo'>('now');
const tp = ref<string>(''); // % 또는 빈값
const sl = ref<string>('');
const amountMode = ref<'percent' | 'amount' | 'shares'>('percent');
const amountValue = ref<number>(10);

const submitting = ref(false);
const proposal = ref<{ id: string; text: string } | null>(null);
const result = ref<string | null>(null);

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

async function submit() {
  if (!code.value) {
    alert('종목을 선택하세요');
    return;
  }
  if (!amountValue.value || amountValue.value <= 0) {
    alert('수량/금액을 입력하세요');
    return;
  }
  submitting.value = true;
  result.value = null;
  try {
    const body: TradeBuyBody = {
      code: code.value,
      strategy: strategy.value,
      amount: { mode: amountMode.value, value: Number(amountValue.value) },
      tp: tp.value === '' ? null : Number(tp.value),
      sl: sl.value === '' ? null : Number(sl.value),
    };
    const r = await api.tradeBuy(body);
    proposal.value = { id: r.id, text: r.text };
  } catch (err) {
    result.value = `❌ ${(err as Error).message}`;
  } finally {
    submitting.value = false;
  }
}

async function confirmOrder() {
  if (!proposal.value) return;
  submitting.value = true;
  try {
    const r = await api.tradeConfirm(proposal.value.id);
    result.value = r.ok ? `✅ ${r.message}` : `❌ ${r.message}`;
    if (r.ok) {
      proposal.value = null;
      await loadBalance();
    }
  } catch (err) {
    result.value = `❌ ${(err as Error).message}`;
  } finally {
    submitting.value = false;
  }
}

async function cancelProposal() {
  if (!proposal.value) return;
  try {
    await api.tradeCancel(proposal.value.id);
    proposal.value = null;
    result.value = '🗑️ 취소됨';
  } catch (err) {
    result.value = `❌ ${(err as Error).message}`;
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
    <h2 class="text-lg font-bold">📥 매수</h2>

    <SymbolSearch @pick="pickSymbol" />

    <Card v-if="quote">
      <p class="text-sm font-semibold">{{ quote.name }} ({{ quote.code }})</p>
      <p class="text-2xl font-bold mt-1">{{ fmtKrw(quote.price) }}
        <span class="text-sm" :class="pflsColor(quote.change)">{{ quote.signLabel }} {{ fmtPct(quote.changeRate) }}</span>
      </p>
      <p v-if="balance" class="text-xs text-muted-foreground mt-1">
        예수금 {{ fmtKrw(balance.cash) }}
      </p>
    </Card>

    <!-- 전략 -->
    <Card v-if="code" title="전략">
      <div class="grid grid-cols-2 gap-2">
        <Button
          :variant="strategy === 'now' ? 'primary' : 'outline'"
          size="md"
          @click="strategy = 'now'"
        >
          ⚡ 즉시매수
        </Button>
        <Button
          :variant="strategy === 'mo' ? 'primary' : 'outline'"
          size="md"
          @click="strategy = 'mo'"
        >
          📅 시가매매
        </Button>
      </div>
      <p class="mt-2 text-xs text-muted-foreground">
        {{ strategy === 'now' ? '현재 세션에 맞게 즉시 발주' : '다음 영업일 09:00:05 시장가' }}
      </p>
    </Card>

    <!-- TP/SL (즉시매수만) -->
    <Card v-if="code && strategy === 'now'" title="🎯 TP / 🛑 SL">
      <div class="grid grid-cols-2 gap-3">
        <label>
          <span class="text-xs text-muted-foreground">TP %</span>
          <input
            v-model="tp"
            type="number"
            step="0.5"
            placeholder="비워두면 없음"
            class="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label>
          <span class="text-xs text-muted-foreground">SL %</span>
          <input
            v-model="sl"
            type="number"
            step="0.5"
            placeholder="비워두면 없음"
            class="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
      </div>
    </Card>

    <!-- 수량/금액 -->
    <Card v-if="code" title="수량 / 금액">
      <div class="grid grid-cols-3 gap-1">
        <Button :variant="amountMode === 'percent' ? 'primary' : 'outline'" size="sm" @click="amountMode = 'percent'">
          비율 %
        </Button>
        <Button :variant="amountMode === 'amount' ? 'primary' : 'outline'" size="sm" @click="amountMode = 'amount'">
          금액 (원)
        </Button>
        <Button :variant="amountMode === 'shares' ? 'primary' : 'outline'" size="sm" @click="amountMode = 'shares'">
          주식 수
        </Button>
      </div>

      <div class="mt-3">
        <input
          v-model.number="amountValue"
          type="number"
          :placeholder="amountMode === 'percent' ? '10' : amountMode === 'amount' ? '500000' : '10'"
          class="w-full rounded-lg border border-border bg-background px-3 py-2 text-base"
        />
        <p class="mt-1 text-xs text-muted-foreground">
          <template v-if="amountMode === 'percent'">예수금 대비 비율 (10 = 10%)</template>
          <template v-else-if="amountMode === 'amount'">원 단위 금액</template>
          <template v-else>매수할 주식 수</template>
        </p>
      </div>

      <!-- 비율 단축 버튼 -->
      <div v-if="amountMode === 'percent'" class="mt-2 grid grid-cols-5 gap-1">
        <Button v-for="p in [10, 20, 30, 50, 100]" :key="p" variant="outline" size="sm" @click="amountValue = p">
          {{ p === 100 ? 'MAX' : `${p}%` }}
        </Button>
      </div>

      <div v-if="estimate" class="mt-3 rounded-lg bg-muted/40 p-3 text-sm">
        예상: <b>{{ estimate.qty }}주</b> · 약 {{ fmtKrw(estimate.budget) }}
      </div>
    </Card>

    <Card v-if="code && !proposal">
      <Button size="lg" class="w-full" :disabled="submitting" @click="submit">
        {{ submitting ? '등록 중...' : '✅ 매수 발주 신청' }}
      </Button>
    </Card>

    <!-- 확인 -->
    <Card v-if="proposal" title="📝 발주 확인">
      <pre class="whitespace-pre-wrap text-xs text-muted-foreground" v-html="proposal.text" />
      <div class="mt-3 grid grid-cols-2 gap-2">
        <Button size="lg" :disabled="submitting" @click="confirmOrder">
          <Check class="mr-1 h-4 w-4" /> 확정
        </Button>
        <Button variant="outline" size="lg" :disabled="submitting" @click="cancelProposal">
          <X class="mr-1 h-4 w-4" /> 취소
        </Button>
      </div>
    </Card>

    <Card v-if="result">
      <p class="whitespace-pre-wrap text-sm">{{ result }}</p>
    </Card>
  </div>
</template>
