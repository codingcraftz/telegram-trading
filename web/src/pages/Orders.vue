<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { RefreshCw, X, Check, ArrowUpRight, ArrowDownRight, Clock, Calendar, Activity } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import Modal from '@/components/ui/Modal.vue';
import { api, type OrdersResponse } from '@/api/client';
import { fmtKrw, fmtKstTime, fmtTtl } from '@/lib/format';
import { toast } from '@/lib/toast';

const data = ref<OrdersResponse | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

const cancelTarget = ref<{ kind: 'intent'|'kis'; id?: string; orgno?: string; odno?: string; ordDvsn?: string; label: string } | null>(null);

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

async function confirmIntent(id: string) {
  try {
    const r = await api.tradeConfirm(id);
    if (r.ok) toast.success(r.message);
    else toast.error(r.message);
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
    if (t.kind === 'intent') {
      const r = await api.tradeCancel(t.id!);
      toast.info(r.message);
    } else {
      const r = await api.cancelKis({ orgno: t.orgno!, odno: t.odno!, ordDvsn: t.ordDvsn! });
      if (r.ok) toast.success(r.message ?? '취소 완료');
      else toast.error(r.message ?? '취소 실패');
    }
    await load();
  } catch (err) {
    toast.error((err as Error).message);
  }
}

const intentCount = computed(() => data.value?.intents.length ?? 0);
const reservCount = computed(() => data.value?.reservations.length ?? 0);
const kisCount = computed(() => data.value?.kis.items.length ?? 0);

onMounted(load);
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between px-1">
      <h2 class="text-base font-semibold tracking-tight">주문</h2>
      <button class="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent" :disabled="loading" @click="load">
        <RefreshCw class="h-4 w-4" :class="loading ? 'animate-spin' : ''" />
      </button>
    </div>
    <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

    <Card>
      <template #header>
        <div class="flex items-center gap-2">
          <Clock class="h-4 w-4 text-muted-foreground" />
          <h3 class="text-sm font-semibold tracking-tight">즉시 주문 대기</h3>
          <span class="ml-auto text-xs font-medium text-muted-foreground tabular-nums">{{ intentCount }}</span>
        </div>
      </template>
      <p v-if="intentCount === 0" class="text-sm text-muted-foreground">대기 중인 주문이 없습니다.</p>
      <div v-else class="space-y-2">
        <div
          v-for="i in data!.intents"
          :key="i.id"
          class="rounded-xl bg-muted/40 p-3"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <ArrowUpRight v-if="i.action === 'buy'" class="h-3.5 w-3.5 text-up" />
                <ArrowDownRight v-else class="h-3.5 w-3.5 text-down" />
                <p class="truncate text-sm font-semibold">{{ i.name }}</p>
                <span class="text-[10px] text-muted-foreground tabular-nums">{{ i.code }}</span>
              </div>
              <p class="mt-1 text-xs text-muted-foreground tabular-nums">
                {{ i.quantity }}주 · {{ i.orderType === 'market' ? '시장가' : fmtKrw(i.price) }}
              </p>
              <p class="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                만료까지 {{ fmtTtl(i.remainingMs) }}
              </p>
            </div>
            <div class="flex flex-col gap-1.5">
              <Button size="sm" variant="primary" @click="confirmIntent(i.id)">
                <Check class="mr-1 h-3 w-3" />확정
              </Button>
              <Button size="sm" variant="ghost" @click="cancelTarget = { kind: 'intent', id: i.id, label: `${i.name} ${i.action === 'buy' ? '매수' : '매도'}` }">
                <X class="mr-1 h-3 w-3" />취소
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>

    <Card>
      <template #header>
        <div class="flex items-center gap-2">
          <Calendar class="h-4 w-4 text-muted-foreground" />
          <h3 class="text-sm font-semibold tracking-tight">시가매매 예약</h3>
          <span class="ml-auto text-xs font-medium text-muted-foreground tabular-nums">{{ reservCount }}</span>
        </div>
      </template>
      <p v-if="reservCount === 0" class="text-sm text-muted-foreground">예약된 시가매매가 없습니다.</p>
      <div v-else class="space-y-2">
        <div
          v-for="r in data!.reservations"
          :key="r.id"
          class="rounded-xl bg-muted/40 p-3"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold">{{ r.name }} <span class="text-[10px] text-muted-foreground tabular-nums">{{ r.code }}</span></p>
              <p class="mt-1 text-xs text-muted-foreground tabular-nums">
                {{
                  r.qtyMode === 'shares' ? `${r.qtyValue}주`
                  : r.qtyMode === 'amount' ? `${r.qtyValue.toLocaleString()}원`
                  : `예수금 ${r.qtyValue}%`
                }}
                · {{ r.state === 'awaiting_confirm' ? '확인 대기' : '예약 중' }}
              </p>
              <p class="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                발주 {{ fmtKstTime(r.scheduledFor) }}<span v-if="r.remainingMs !== null"> · {{ fmtTtl(r.remainingMs) }}</span>
              </p>
            </div>
            <div class="flex flex-col gap-1.5">
              <Button v-if="r.state === 'awaiting_confirm'" size="sm" variant="primary" @click="confirmIntent(r.id)">
                <Check class="mr-1 h-3 w-3" />확정
              </Button>
              <Button size="sm" variant="ghost" @click="cancelTarget = { kind: 'intent', id: r.id, label: `${r.name} 예약` }">
                <X class="mr-1 h-3 w-3" />취소
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>

    <Card>
      <template #header>
        <div class="flex items-center gap-2">
          <Activity class="h-4 w-4 text-muted-foreground" />
          <h3 class="text-sm font-semibold tracking-tight">KIS 미체결</h3>
          <span class="ml-auto text-xs font-medium text-muted-foreground tabular-nums">{{ kisCount }}</span>
        </div>
      </template>
      <p v-if="data && !data.kis.ok" class="text-sm text-destructive">{{ data.kis.error ?? '조회 실패' }}</p>
      <p v-else-if="kisCount === 0" class="text-sm text-muted-foreground">미체결 주문이 없습니다.</p>
      <div v-else class="space-y-2">
        <div
          v-for="it in data!.kis.items"
          :key="`${it.orgno}-${it.odno}`"
          class="rounded-xl bg-muted/40 p-3"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold">{{ it.name }} <span class="text-[10px] text-muted-foreground tabular-nums">{{ it.code }}</span></p>
              <p class="mt-1 text-xs text-muted-foreground tabular-nums">
                {{ it.side }} · {{ it.price > 0 ? fmtKrw(it.price) : '시장가' }} · {{ it.qty }}주 (잔여 {{ it.remaining }})
              </p>
            </div>
            <Button size="sm" variant="ghost" @click="cancelTarget = { kind: 'kis', orgno: it.orgno, odno: it.odno, ordDvsn: it.ordDvsn, label: `${it.name} ${it.side}` }">
              <X class="mr-1 h-3 w-3" />취소
            </Button>
          </div>
        </div>
      </div>
    </Card>

    <Modal :open="!!cancelTarget" title="주문 취소" @close="cancelTarget = null">
      <p class="text-sm text-muted-foreground">
        <span class="font-semibold text-foreground">{{ cancelTarget?.label }}</span> 주문을 취소할까요?
      </p>
      <div class="mt-4 grid grid-cols-2 gap-2">
        <Button variant="secondary" @click="cancelTarget = null">아니요</Button>
        <Button variant="destructive" @click="doCancel">취소</Button>
      </div>
    </Modal>
  </div>
</template>
