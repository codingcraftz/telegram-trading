<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Check, X } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import { api, type BalanceResponse, type Holding } from '@/api/client';
import { fmtKrw, fmtPct, fmtSigned, pflsColor } from '@/lib/format';

const route = useRoute();
const router = useRouter();

const balance = ref<BalanceResponse | null>(null);
const code = ref<string>((route.query.code as string) ?? '');
const selected = ref<Holding | null>(null);
const qtyMode = ref<'all' | 'half' | 'shares'>('all');
const qtyValue = ref<number | undefined>();

const submitting = ref(false);
const proposal = ref<{ id: string; text: string } | null>(null);
const result = ref<string | null>(null);

async function load() {
  try {
    balance.value = await api.balance();
    if (code.value) {
      selected.value = balance.value.holdings.find((h) => h.code === code.value) ?? null;
    }
  } catch (err) {
    result.value = `❌ ${(err as Error).message}`;
  }
}

function select(h: Holding) {
  selected.value = h;
  code.value = h.code;
  qtyMode.value = 'all';
  qtyValue.value = undefined;
  router.replace({ query: { code: h.code } });
  proposal.value = null;
  result.value = null;
}

async function submit() {
  if (!selected.value) {
    alert('보유 종목을 선택하세요');
    return;
  }
  submitting.value = true;
  result.value = null;
  try {
    const r = await api.tradeSell({
      code: selected.value.code,
      qtyMode: qtyMode.value,
      qtyValue: qtyMode.value === 'shares' ? qtyValue.value : undefined,
    });
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
      await load();
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

watch(code, () => {
  if (balance.value && code.value) {
    selected.value = balance.value.holdings.find((h) => h.code === code.value) ?? null;
  }
});

onMounted(load);
</script>

<template>
  <div class="space-y-3">
    <h2 class="text-lg font-bold">📤 매도</h2>

    <!-- 보유종목 선택 -->
    <Card v-if="balance && !selected" title="보유종목 선택">
      <p v-if="balance.holdings.length === 0" class="text-sm text-muted-foreground">
        보유 종목 없음
      </p>
      <div v-else class="space-y-1">
        <button
          v-for="h in balance.holdings"
          :key="h.code"
          class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-accent"
          @click="select(h)"
        >
          <div>
            <p class="text-sm font-medium">{{ h.name }}</p>
            <p class="text-[11px] text-muted-foreground">{{ h.code }} · {{ h.qty }}주</p>
          </div>
          <p class="text-sm font-semibold" :class="pflsColor(h.pflsAmt)">
            {{ fmtPct(h.pflsRt) }}
          </p>
        </button>
      </div>
    </Card>

    <Card v-if="selected">
      <p class="text-sm font-semibold">{{ selected.name }} ({{ selected.code }})</p>
      <p class="mt-1 text-xs text-muted-foreground">
        보유 {{ selected.qty }}주 · 매수가 {{ fmtKrw(selected.avg) }}
      </p>
      <p class="mt-1 text-sm" :class="pflsColor(selected.pflsAmt)">
        현재 {{ fmtKrw(selected.cur) }} · {{ fmtPct(selected.pflsRt) }}
        ({{ fmtSigned(selected.pflsAmt) }}원)
      </p>
      <Button variant="ghost" size="sm" class="mt-2" @click="selected = null">
        다른 종목 선택
      </Button>
    </Card>

    <Card v-if="selected" title="수량">
      <div class="grid grid-cols-3 gap-1">
        <Button :variant="qtyMode === 'all' ? 'primary' : 'outline'" size="md" @click="qtyMode = 'all'">
          전량
        </Button>
        <Button :variant="qtyMode === 'half' ? 'primary' : 'outline'" size="md" @click="qtyMode = 'half'">
          절반
        </Button>
        <Button :variant="qtyMode === 'shares' ? 'primary' : 'outline'" size="md" @click="qtyMode = 'shares'">
          직접 입력
        </Button>
      </div>
      <input
        v-if="qtyMode === 'shares'"
        v-model.number="qtyValue"
        type="number"
        placeholder="매도할 주식 수"
        class="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
      />
    </Card>

    <Card v-if="selected && !proposal">
      <Button variant="destructive" size="lg" class="w-full" :disabled="submitting" @click="submit">
        {{ submitting ? '등록 중...' : '📤 매도 신청' }}
      </Button>
    </Card>

    <Card v-if="proposal" title="📝 매도 확인">
      <pre class="whitespace-pre-wrap text-xs text-muted-foreground" v-html="proposal.text" />
      <div class="mt-3 grid grid-cols-2 gap-2">
        <Button variant="destructive" size="lg" :disabled="submitting" @click="confirmOrder">
          <Check class="mr-1 h-4 w-4" /> 매도 발주
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
