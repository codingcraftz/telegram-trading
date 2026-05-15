<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { RefreshCw, X, Check, ArrowUpRight, ArrowDownRight, Inbox } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import Modal from '@/components/ui/Modal.vue';
import EmptyState from '@/components/EmptyState.vue';
import { api, type OrdersResponse } from '@/api/client';
import { fmtKrw, fmtKstTime, fmtTtl } from '@/lib/format';
import { toast } from '@/lib/toast';

const router = useRouter();
const data = ref<OrdersResponse | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

type Item =
  | { kind: 'intent'; id: string; side: 'buy' | 'sell'; name: string; code: string; qty: number; price: string; tip: string; remainingMs: number }
  | { kind: 'reservation'; id: string; name: string; code: string; qty: string; scheduledFor: number; state: string; remainingMs: number | null }
  | { kind: 'kis'; orgno: string; odno: string; ordDvsn: string; side: string; name: string; code: string; qty: number; remaining: number; price: number; time: string };

const cancelTarget = ref<Item | null>(null);

async function load() {
  loading.value = true;
  try {
    data.value = await api.orders();
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

const items = computed<Item[]>(() => {
  if (!data.value) return [];
  const list: Item[] = [];
  for (const i of data.value.intents) {
    list.push({
      kind: 'intent',
      id: i.id,
      side: i.action === 'sell' ? 'sell' : 'buy',
      name: i.name,
      code: i.code,
      qty: i.quantity,
      price: i.orderType === 'market' ? '시장가' : fmtKrw(i.price ?? 0),
      tip: '5분 안에 확인 안 하면 자동 취소돼요',
      remainingMs: i.remainingMs,
    });
  }
  for (const r of data.value.reservations) {
    list.push({
      kind: 'reservation',
      id: r.id,
      name: r.name,
      code: r.code,
      qty: r.qtyMode === 'shares' ? `${r.qtyValue}주` : r.qtyMode === 'amount' ? `${r.qtyValue.toLocaleString()}원어치` : `예수금 ${r.qtyValue}%`,
      scheduledFor: r.scheduledFor,
      state: r.state,
      remainingMs: r.remainingMs,
    });
  }
  if (data.value.kis.ok) {
    for (const k of data.value.kis.items) {
      list.push({
        kind: 'kis',
        orgno: k.orgno,
        odno: k.odno,
        ordDvsn: k.ordDvsn,
        side: k.side,
        name: k.name,
        code: k.code,
        qty: k.qty,
        remaining: k.remaining,
        price: k.price,
        time: k.time,
      });
    }
  }
  return list;
});

async function confirmAction(id: string) {
  try {
    const r = await api.tradeConfirm(id);
    if (r.ok) toast.success(r.message || '주문 넣었어요');
    else toast.error(r.message || '거절됐어요');
    await load();
  } catch (err) {
    toast.error((err as Error).message);
  }
}

async function doCancel() {
  const t = cancelTarget.value;
  if (!t) return;
  cancelTarget.value = null;
  try {
    if (t.kind === 'intent' || t.kind === 'reservation') {
      const r = await api.tradeCancel(t.id);
      toast.info(r.message || '취소했어요');
    } else {
      const r = await api.cancelKis({ orgno: t.orgno, odno: t.odno, ordDvsn: t.ordDvsn });
      if (r.ok) toast.success(r.message || '취소했어요');
      else toast.error(r.message || '취소 실패');
    }
    await load();
  } catch (err) {
    toast.error((err as Error).message);
  }
}

function intentActionLabel(it: Extract<Item, { kind: 'intent' }>) {
  return it.side === 'buy' ? '지금 사기' : '지금 팔기';
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between px-1">
      <h2 class="text-lg font-bold tracking-tight">주문</h2>
      <button class="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent" :disabled="loading" @click="load">
        <RefreshCw class="h-4 w-4" :class="loading ? 'animate-spin' : ''" />
      </button>
    </div>

    <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

    <p class="px-1 text-sm text-muted-foreground">
      거래 대기 중 <span class="font-bold text-foreground tabular-nums">{{ items.length }}건</span>
    </p>

    <EmptyState
      v-if="!loading && items.length === 0"
      :icon="Inbox"
      title="대기 중인 주문이 없어요"
      description="종목 상세에서 사거나 팔면 여기서 진행 상황을 볼 수 있어요."
    >
      <template #action>
        <Button variant="primary" @click="router.push('/stocks')">종목 둘러보기</Button>
      </template>
    </EmptyState>

    <div v-else class="space-y-2">
      <Card v-for="(it, idx) in items" :key="idx">
        <!-- 즉시 주문 대기 -->
        <template v-if="it.kind === 'intent'">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <ArrowUpRight v-if="it.side === 'buy'" class="h-3.5 w-3.5 text-up" />
                <ArrowDownRight v-else class="h-3.5 w-3.5 text-down" />
                <p class="truncate text-sm font-bold">{{ it.name }}</p>
                <span class="text-[10px] text-muted-foreground tabular-nums">{{ it.code }}</span>
              </div>
              <p class="mt-1 text-xs tabular-nums">
                {{ it.qty }}주 · {{ it.price }}
              </p>
              <p class="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{{ it.tip }} · {{ fmtTtl(it.remainingMs) }} 남음</p>
            </div>
          </div>
          <div class="mt-3 grid grid-cols-2 gap-2">
            <Button variant="ghost" size="sm" @click="cancelTarget = it">
              <X class="mr-1 h-3.5 w-3.5" />취소
            </Button>
            <Button variant="primary" size="sm" @click="confirmAction(it.id)">
              <Check class="mr-1 h-3.5 w-3.5" />{{ intentActionLabel(it) }}
            </Button>
          </div>
        </template>

        <!-- 시가매매 예약 -->
        <template v-else-if="it.kind === 'reservation'">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-bold">{{ it.name }} <span class="text-[10px] text-muted-foreground tabular-nums">{{ it.code }}</span></p>
            <p class="mt-1 text-xs tabular-nums">내일 시가 매수 · {{ it.qty }}</p>
            <p class="mt-1.5 text-[11px] text-muted-foreground tabular-nums">
              발주 예정 {{ fmtKstTime(it.scheduledFor) }}
              <span v-if="it.state === 'awaiting_confirm' && it.remainingMs"> · 확인 대기 {{ fmtTtl(it.remainingMs) }}</span>
            </p>
          </div>
          <div class="mt-3 grid gap-2" :class="it.state === 'awaiting_confirm' ? 'grid-cols-2' : 'grid-cols-1'">
            <Button variant="ghost" size="sm" @click="cancelTarget = it">
              <X class="mr-1 h-3.5 w-3.5" />예약 취소
            </Button>
            <Button v-if="it.state === 'awaiting_confirm'" variant="primary" size="sm" @click="confirmAction(it.id)">
              <Check class="mr-1 h-3.5 w-3.5" />확인
            </Button>
          </div>
        </template>

        <!-- KIS 미체결 -->
        <template v-else>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <p class="truncate text-sm font-bold">{{ it.name }}</p>
              <span class="text-[10px] text-muted-foreground tabular-nums">{{ it.code }}</span>
              <span class="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">증권사 대기</span>
            </div>
            <p class="mt-1 text-xs tabular-nums">
              {{ it.side }} · {{ it.price > 0 ? fmtKrw(it.price) : '시장가' }} · {{ it.qty }}주 (남은 {{ it.remaining }}주)
            </p>
          </div>
          <div class="mt-3">
            <Button variant="ghost" size="sm" class="w-full" @click="cancelTarget = it">
              <X class="mr-1 h-3.5 w-3.5" />취소
            </Button>
          </div>
        </template>
      </Card>
    </div>

    <Modal :open="!!cancelTarget" title="주문을 취소할까요?" @close="cancelTarget = null">
      <p class="text-sm text-muted-foreground">취소하면 되돌릴 수 없어요.</p>
      <div class="mt-5 grid grid-cols-2 gap-2">
        <Button variant="secondary" @click="cancelTarget = null">아니요</Button>
        <Button variant="destructive" @click="doCancel">취소하기</Button>
      </div>
    </Modal>
  </div>
</template>
