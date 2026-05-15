<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowDownRight, ChevronLeft } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import Modal from '@/components/ui/Modal.vue';
import { api, type BalanceResponse, type Holding } from '@/api/client';
import { fmtKrw, fmtPct, fmtSigned, pflsColor } from '@/lib/format';
import { toast } from '@/lib/toast';

const route = useRoute();
const router = useRouter();

const balance = ref<BalanceResponse | null>(null);
const code = ref<string>((route.query.code as string) ?? '');
const selected = ref<Holding | null>(null);
const qtyMode = ref<'all' | 'half' | 'shares'>('all');
const qtyValue = ref<number | undefined>();

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
  qtyValue.value = undefined;
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
  if (qtyMode.value === 'half') return Math.floor(selected.value.qty / 2);
  return Math.floor(qtyValue.value ?? 0);
});

function openConfirm() {
  if (!selected.value) { toast.error('보유 종목을 선택하세요'); return; }
  if (planned.value <= 0) { toast.error('수량이 0주입니다'); return; }
  if (planned.value > selected.value.qty) { toast.error('보유 수량을 초과합니다'); return; }
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
      toast.success(r.message || '매도 발주 완료');
      confirmOpen.value = false;
      await load();
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

watch(code, () => {
  if (balance.value && code.value) {
    selected.value = balance.value.holdings.find((h) => h.code === code.value) ?? null;
  }
});

onMounted(load);
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between px-1">
      <h2 class="text-base font-semibold tracking-tight">매도</h2>
      <button v-if="selected" class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" @click="back">
        <ChevronLeft class="h-3.5 w-3.5" /> 다른 종목
      </button>
    </div>

    <Card v-if="balance && !selected">
      <template #header>
        <h3 class="text-sm font-semibold tracking-tight">보유 종목 선택</h3>
      </template>
      <p v-if="balance.holdings.length === 0" class="text-sm text-muted-foreground">보유 종목이 없습니다.</p>
      <div v-else class="space-y-1">
        <button
          v-for="h in balance.holdings"
          :key="h.code"
          class="flex w-full items-center justify-between rounded-xl bg-muted/30 px-3 py-2.5 text-left transition hover:bg-muted"
          @click="select(h)"
        >
          <div>
            <p class="text-sm font-semibold">{{ h.name }}</p>
            <p class="text-[10px] text-muted-foreground tabular-nums">{{ h.code }} · {{ h.qty }}주</p>
          </div>
          <div class="text-right tabular-nums">
            <p class="text-sm font-semibold" :class="pflsColor(h.pflsAmt)">{{ fmtPct(h.pflsRt) }}</p>
            <p class="text-[10px]" :class="pflsColor(h.pflsAmt)">{{ fmtSigned(h.pflsAmt) }}</p>
          </div>
        </button>
      </div>
    </Card>

    <Card v-if="selected">
      <div class="flex items-start justify-between">
        <div>
          <p class="text-sm font-semibold">{{ selected.name }}</p>
          <p class="text-[10px] text-muted-foreground tabular-nums">{{ selected.code }} · 보유 {{ selected.qty }}주</p>
        </div>
        <div class="text-right tabular-nums">
          <p class="text-xl font-bold tracking-tighter">{{ fmtKrw(selected.cur) }}</p>
          <p class="text-xs font-medium" :class="pflsColor(selected.pflsAmt)">{{ fmtPct(selected.pflsRt) }}</p>
        </div>
      </div>
      <div class="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs">
        <div>
          <p class="text-muted-foreground">평단</p>
          <p class="mt-0.5 font-semibold tabular-nums">{{ fmtKrw(selected.avg) }}</p>
        </div>
        <div>
          <p class="text-muted-foreground">평가손익</p>
          <p class="mt-0.5 font-semibold tabular-nums" :class="pflsColor(selected.pflsAmt)">{{ fmtSigned(selected.pflsAmt) }}원</p>
        </div>
      </div>
    </Card>

    <Card v-if="selected">
      <template #header>
        <h3 class="text-sm font-semibold tracking-tight">수량</h3>
      </template>
      <div class="grid grid-cols-3 gap-1.5">
        <button
          v-for="m in [{k:'all',l:'전량'},{k:'half',l:'절반'},{k:'shares',l:'직접'}]"
          :key="m.k"
          class="rounded-lg py-2 text-xs font-semibold transition"
          :class="qtyMode === m.k ? 'bg-primary text-primary-foreground' : 'bg-muted/50 hover:bg-muted'"
          @click="qtyMode = m.k as 'all'|'half'|'shares'"
        >
          {{ m.l }}
        </button>
      </div>
      <input
        v-if="qtyMode === 'shares'"
        v-model.number="qtyValue"
        type="number"
        placeholder="매도할 주식 수"
        class="mt-2 w-full rounded-lg bg-muted/40 px-3 py-2.5 text-base font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <div class="mt-3 rounded-xl bg-muted/30 px-3 py-2.5">
        <p class="text-[10px] text-muted-foreground">매도 수량</p>
        <p class="mt-0.5 text-sm font-semibold tabular-nums">{{ planned }}주</p>
      </div>
    </Card>

    <Button v-if="selected" variant="destructive" size="lg" class="w-full" @click="openConfirm">
      <ArrowDownRight class="mr-1 h-4 w-4" />매도
    </Button>

    <Modal :open="confirmOpen" title="매도 발주" @close="confirmOpen = false">
      <div class="space-y-3 text-sm">
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">종목</span>
          <span class="font-semibold">{{ selected?.name }} <span class="text-[10px] text-muted-foreground tabular-nums">{{ selected?.code }}</span></span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">현재가</span>
          <span class="font-semibold tabular-nums">{{ selected ? fmtKrw(selected.cur) : '—' }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">수량</span>
          <span class="font-semibold tabular-nums">{{ planned }}주</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">예상금액</span>
          <span class="font-semibold tabular-nums">{{ selected ? fmtKrw(planned * selected.cur) : '—' }}</span>
        </div>
      </div>
      <div class="mt-5 grid grid-cols-2 gap-2">
        <Button variant="secondary" :disabled="submitting" @click="confirmOpen = false">취소</Button>
        <Button variant="destructive" :disabled="submitting" @click="submit">
          {{ submitting ? '발주 중…' : '매도' }}
        </Button>
      </div>
    </Modal>
  </div>
</template>
