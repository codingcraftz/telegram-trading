<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { RefreshCw, X, Check } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import { api, type OrdersResponse } from '@/api/client';
import { fmtKrw, fmtKstTime, fmtTtl } from '@/lib/format';

const data = ref<OrdersResponse | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

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

async function confirm(id: string) {
  try {
    const r = await api.tradeConfirm(id);
    alert(r.ok ? `✅ ${r.message}` : `❌ ${r.message}`);
    await load();
  } catch (err) {
    alert(`❌ ${(err as Error).message}`);
  }
}

async function cancel(id: string) {
  try {
    const r = await api.tradeCancel(id);
    alert(r.message);
    await load();
  } catch (err) {
    alert(`❌ ${(err as Error).message}`);
  }
}

async function cancelKis(orgno: string, odno: string, ordDvsn: string) {
  if (!confirm('이 KIS 미체결 주문을 취소하시겠어요?')) return;
  try {
    const r = await api.cancelKis({ orgno, odno, ordDvsn });
    alert(r.ok ? `✅ ${r.message ?? '취소'}` : `❌ ${r.message ?? '실패'}`);
    await load();
  } catch (err) {
    alert(`❌ ${(err as Error).message}`);
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-bold">📋 주문 현황</h2>
      <Button variant="ghost" size="icon" :disabled="loading" @click="load">
        <RefreshCw class="h-4 w-4" :class="loading ? 'animate-spin' : ''" />
      </Button>
    </div>
    <p v-if="error" class="text-sm text-destructive">❌ {{ error }}</p>

    <!-- 즉시 주문 대기 -->
    <Card title="⏳ 즉시 주문 대기" :subtitle="`${data?.intents.length ?? 0}건`">
      <p v-if="!data || data.intents.length === 0" class="text-sm text-muted-foreground">
        없음
      </p>
      <div v-else class="space-y-2">
        <div
          v-for="i in data.intents"
          :key="i.id"
          class="rounded-lg border border-border/50 p-3"
        >
          <div class="flex items-center justify-between">
            <div>
              <p class="font-semibold">
                {{ i.name }}
                <span class="text-xs text-muted-foreground">({{ i.code }})</span>
              </p>
              <p class="text-xs">
                {{ i.action === 'buy' ? '📥 매수' : '📤 매도' }} ·
                {{ i.quantity }}주 ·
                {{ i.orderType === 'market' ? '시장가' : fmtKrw(i.price) }}
              </p>
              <p class="text-[11px] text-muted-foreground">
                ⌛ {{ fmtTtl(i.remainingMs) }}
              </p>
            </div>
            <div class="flex flex-col gap-1">
              <Button size="sm" @click="confirm(i.id)">
                <Check class="mr-1 h-3 w-3" />확정
              </Button>
              <Button size="sm" variant="outline" @click="cancel(i.id)">
                <X class="mr-1 h-3 w-3" />취소
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>

    <!-- 시가매매 예약 -->
    <Card title="📅 시가매매 예약" :subtitle="`${data?.reservations.length ?? 0}건`">
      <p v-if="!data || data.reservations.length === 0" class="text-sm text-muted-foreground">
        없음
      </p>
      <div v-else class="space-y-2">
        <div
          v-for="r in data.reservations"
          :key="r.id"
          class="rounded-lg border border-border/50 p-3"
        >
          <div class="flex items-center justify-between">
            <div>
              <p class="font-semibold">
                {{ r.name }}
                <span class="text-xs text-muted-foreground">({{ r.code }})</span>
              </p>
              <p class="text-xs">
                {{
                  r.qtyMode === 'shares'
                    ? `${r.qtyValue}주`
                    : r.qtyMode === 'amount'
                      ? `${r.qtyValue.toLocaleString()}원`
                      : `예수금 ${r.qtyValue}%`
                }}
                · {{ r.state === 'awaiting_confirm' ? '확인대기' : '예약중' }}
              </p>
              <p class="text-[11px] text-muted-foreground">
                발주 {{ fmtKstTime(r.scheduledFor) }}
                <span v-if="r.remainingMs !== null">⌛ {{ fmtTtl(r.remainingMs) }}</span>
              </p>
            </div>
            <div class="flex flex-col gap-1">
              <Button v-if="r.state === 'awaiting_confirm'" size="sm" @click="confirm(r.id)">
                <Check class="mr-1 h-3 w-3" />확정
              </Button>
              <Button size="sm" variant="outline" @click="cancel(r.id)">
                <X class="mr-1 h-3 w-3" />취소
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>

    <!-- KIS 미체결 -->
    <Card title="🔵 KIS 미체결" :subtitle="`${data?.kis.items.length ?? 0}건`">
      <p v-if="!data || !data.kis.ok" class="text-sm text-destructive">
        ❌ {{ data?.kis.error ?? '조회 실패' }}
      </p>
      <p v-else-if="data.kis.items.length === 0" class="text-sm text-muted-foreground">
        없음
      </p>
      <div v-else class="space-y-2">
        <div
          v-for="it in data.kis.items"
          :key="`${it.orgno}-${it.odno}`"
          class="rounded-lg border border-border/50 p-3"
        >
          <div class="flex items-center justify-between">
            <div>
              <p class="font-semibold">
                {{ it.name }}
                <span class="text-xs text-muted-foreground">({{ it.code }})</span>
              </p>
              <p class="text-xs">
                {{ it.side }} · {{ it.price > 0 ? fmtKrw(it.price) : '시장가' }} ·
                {{ it.qty }}주 (잔여 {{ it.remaining }})
              </p>
            </div>
            <Button size="sm" variant="outline" @click="cancelKis(it.orgno, it.odno, it.ordDvsn)">
              <X class="mr-1 h-3 w-3" />취소
            </Button>
          </div>
        </div>
      </div>
    </Card>
  </div>
</template>
