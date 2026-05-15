<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ChevronLeft, ArrowUpRight, ArrowDownRight } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import Modal from '@/components/ui/Modal.vue';
import PriceStepper from '@/components/PriceStepper.vue';
import EmptyState from '@/components/EmptyState.vue';
import InfoTooltip from '@/components/InfoTooltip.vue';
import { Wallet } from 'lucide-vue-next';
import { api, type BalanceResponse, type Holding } from '@/api/client';
import { fmtKrw, fmtPct, fmtSigned, pflsColor } from '@/lib/format';
import { toast } from '@/lib/toast';

const route = useRoute();
const router = useRouter();

const balance = ref<BalanceResponse | null>(null);
const code = ref<string>((route.query.code as string) ?? '');
const selected = ref<Holding | null>(null);
const qtyMode = ref<'all' | 'half' | 'shares'>('all');
const qtyValue = ref<number>(1);

const submitting = ref(false);
const confirmOpen = ref(false);

async function load() {
  try {
    balance.value = await api.balance();
    if (code.value) {
      selected.value = balance.value.holdings.find((h) => h.code === code.value) ?? null;
    }
  } catch (err) {
    toast.error((err as Error).message);
  }
}

function select(h: Holding) {
  selected.value = h;
  code.value = h.code;
  qtyMode.value = 'all';
  qtyValue.value = 1;
  router.replace({ query: { code: h.code } });
}

function back() {
  selected.value = null;
  code.value = '';
  router.replace({ query: {} });
}

const planned = computed(() => {
  if (!selected.value) return 0;
  if (qtyMode.value === 'all') return selected.value.qty;
  if (qtyMode.value === 'half') return Math.max(1, Math.floor(selected.value.qty / 2));
  return Math.max(0, Math.min(qtyValue.value, selected.value.qty));
});

const estimateRevenue = computed(() => {
  if (!selected.value) return 0;
  return planned.value * selected.value.cur;
});

function openConfirm() {
  if (!selected.value) { toast.error('팔 종목을 먼저 골라주세요'); return; }
  if (planned.value <= 0) { toast.error('팔 수량이 0주예요'); return; }
  confirmOpen.value = true;
}

async function submit() {
  if (!selected.value || submitting.value) return;
  submitting.value = true;
  try {
    const reg = await api.tradeSell({
      code: selected.value.code,
      qtyMode: qtyMode.value,
      qtyValue: qtyMode.value === 'shares' ? qtyValue.value : undefined,
    });
    const r = await api.tradeConfirm(reg.id);
    if (r.ok) {
      toast.success('주문 넣었어요');
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

watch(code, () => {
  if (balance.value && code.value) {
    selected.value = balance.value.holdings.find((h) => h.code === code.value) ?? null;
  }
});

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-2 px-1">
      <button class="-ml-2 rounded-md p-2 text-muted-foreground transition hover:bg-accent" @click="selected ? back() : router.back()">
        <ChevronLeft class="h-5 w-5" />
      </button>
      <h2 class="text-lg font-bold tracking-tight">팔기</h2>
    </div>

    <!-- 종목 선택 -->
    <section v-if="balance && !selected" class="space-y-2">
      <p class="px-1 text-sm font-bold tracking-tight">어떤 종목을 팔까요?</p>
      <EmptyState
        v-if="balance.holdings.length === 0"
        :icon="Wallet"
        title="갖고 있는 종목이 없어요"
        description="주식을 사면 여기서 팔 수 있어요."
      >
        <template #action>
          <Button variant="primary" @click="router.push('/stocks')">종목 둘러보기</Button>
        </template>
      </EmptyState>
      <div v-else class="space-y-1.5">
        <button
          v-for="h in balance.holdings"
          :key="h.code"
          class="flex w-full items-center justify-between rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 px-4 py-3.5 text-left transition active:scale-[0.99]"
          @click="select(h)"
        >
          <div class="min-w-0 flex-1">
            <p class="truncate text-base font-bold tracking-tight">{{ h.name }}</p>
            <p class="mt-0.5 text-xs text-muted-foreground tabular-nums">{{ h.qty }}주 · 내 매수가 {{ fmtKrw(h.avg) }}</p>
          </div>
          <div class="text-right tabular-nums">
            <p class="text-base font-bold" :class="pflsColor(h.pflsAmt)">{{ fmtPct(h.pflsRt) }}</p>
            <p class="mt-0.5 text-[11px]" :class="pflsColor(h.pflsAmt)">{{ fmtSigned(h.pflsAmt) }}원</p>
          </div>
        </button>
      </div>
    </section>

    <!-- 선택된 종목 -->
    <template v-if="selected">
      <Card>
        <p class="text-sm font-semibold">{{ selected.name }}</p>
        <p class="mt-0.5 text-[10px] text-muted-foreground tabular-nums">{{ selected.code }} · 갖고 있는 주식 {{ selected.qty }}주</p>
        <div class="mt-3 flex items-end justify-between">
          <p class="text-2xl font-bold tabular-nums tracking-tighter">{{ fmtKrw(selected.cur) }}</p>
          <p class="flex items-center gap-0.5 text-sm font-semibold tabular-nums" :class="pflsColor(selected.pflsAmt)">
            <ArrowUpRight v-if="selected.pflsAmt > 0" class="h-3.5 w-3.5" />
            <ArrowDownRight v-else-if="selected.pflsAmt < 0" class="h-3.5 w-3.5" />
            {{ fmtPct(selected.pflsRt) }}
          </p>
        </div>
      </Card>

      <!-- 얼마나 팔까요? -->
      <Card>
        <template #header>
          <h3 class="text-sm font-bold tracking-tight">얼마나 팔까요?</h3>
        </template>
        <div class="grid grid-cols-3 gap-1.5">
          <button
            v-for="m in [{k:'all',l:'전부'},{k:'half',l:'반만'},{k:'shares',l:'직접'}]"
            :key="m.k"
            class="rounded-xl py-2.5 text-sm font-semibold transition"
            :class="qtyMode === m.k ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-foreground hover:bg-muted'"
            @click="qtyMode = m.k as 'all'|'half'|'shares'"
          >
            {{ m.l }}
          </button>
        </div>
        <div v-if="qtyMode === 'shares'" class="mt-3">
          <PriceStepper
            v-model="qtyValue"
            :step="1"
            :min="0"
            :max="selected.qty"
            suffix="주"
          />
        </div>
        <p class="mt-3 text-center text-xs text-muted-foreground tabular-nums">
          <span class="font-bold text-foreground">{{ planned }}주</span> 팔면
          대략 <span class="font-bold text-foreground">{{ fmtKrw(estimateRevenue) }}</span> 받을 예정
        </p>
      </Card>

      <!-- 지금 손익 -->
      <Card>
        <template #header>
          <h3 class="text-sm font-bold tracking-tight">지금 손익</h3>
        </template>
        <div class="space-y-2 text-sm">
          <div class="flex items-center justify-between">
            <span class="flex items-center gap-1 text-muted-foreground">
              내 매수가
              <InfoTooltip title="내 매수가" description="이 종목을 여러 번 나눠 샀다면 그 평균 가격이에요. 지금 가격이 이보다 높으면 이익, 낮으면 손해입니다." />
            </span>
            <span class="font-semibold tabular-nums">{{ fmtKrw(selected.avg) }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground">지금 가격</span>
            <span class="font-semibold tabular-nums">{{ fmtKrw(selected.cur) }}</span>
          </div>
          <div class="flex items-center justify-between border-t border-border pt-2">
            <span class="text-muted-foreground">손익</span>
            <span class="font-bold tabular-nums" :class="pflsColor(selected.pflsAmt)">
              {{ fmtSigned(selected.pflsAmt) }}원 ({{ fmtPct(selected.pflsRt) }})
            </span>
          </div>
        </div>
      </Card>

      <Button variant="destructive" size="lg" class="w-full" @click="openConfirm">
        팔기 ({{ planned }}주)
      </Button>
    </template>

    <Modal :open="confirmOpen" title="확인할게요" @close="confirmOpen = false">
      <div class="space-y-3 text-sm">
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">종목</span>
          <span class="font-semibold">{{ selected?.name }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">수량</span>
          <span class="font-semibold tabular-nums">{{ planned }}주</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">받을 예정</span>
          <span class="font-semibold tabular-nums">약 {{ fmtKrw(estimateRevenue) }}</span>
        </div>
      </div>
      <div class="mt-5 grid grid-cols-2 gap-2">
        <Button variant="secondary" :disabled="submitting" @click="confirmOpen = false">취소</Button>
        <Button variant="destructive" :disabled="submitting" @click="submit">
          {{ submitting ? '주문 중…' : '팔기' }}
        </Button>
      </div>
    </Modal>
  </div>
</template>
