<script setup lang="ts">
// OrderEditSheet — 취소 (작동) / 정정 (TODO 안내).
import { computed, ref, watch } from 'vue';
import BottomSheet from '@/components/ui/BottomSheet.vue';
import Button from '@/components/ui/Button.vue';
import { api } from '@/api/client';
import { toast } from '@/lib/toast';
import { fmtKrw } from '@/lib/format';

export type EditableOrder = {
  kind: 'unfilled' | 'morning' | 'strategy';
  code: string;
  name: string;
  side: 'buy' | 'sell';
  odno?: string;
  orgno?: string;
  ordDvsn?: string;
  orderPrice?: number;
  qty?: number;
  remaining?: number;
  reservationId?: string;
  qtyDesc?: string;
  applicationId?: string;
  strategyId?: string;
  strategyName?: string;
  phaseLabel?: string;
  budgetAmount?: number | null;
  heldQty?: number;
  avgPrice?: number;
  phase?: string;
};

const props = defineProps<{
  open: boolean;
  mode: 'edit' | 'cancel';
  order: EditableOrder | null;
}>();
const emit = defineEmits<{ close: []; success: [] }>();

const submitting = ref(false);
const confirmStage = ref(false);

watch(() => props.open, (v) => {
  if (!v) { confirmStage.value = false; submitting.value = false; }
});

const title = computed(() => {
  if (!props.order) return '';
  return props.mode === 'cancel' ? '주문 취소' : '주문 정정';
});

async function doCancel() {
  if (!props.order || submitting.value) return;
  submitting.value = true;
  try {
    if (props.order.kind === 'unfilled') {
      if (!props.order.orgno || !props.order.odno) {
        toast.error('주문 식별 정보가 없어요');
        return;
      }
      const r = await api.cancelKis({
        orgno: props.order.orgno,
        odno: props.order.odno,
        ordDvsn: props.order.ordDvsn,
      });
      if (r.ok) { toast.success(r.message || '주문이 취소됐어요'); emit('success'); }
      else { toast.error(r.message || '취소 실패'); confirmStage.value = false; }
    } else if (props.order.kind === 'morning') {
      if (!props.order.reservationId) return;
      const r = await api.tradeCancel(props.order.reservationId);
      toast.info(r.message || '예약을 취소했어요');
      emit('success');
    } else {
      // strategy 전략 발동 대기 — application 삭제 (서버가 status='canceled' 처리)
      if (!props.order.strategyId || !props.order.applicationId) {
        toast.error('전략 식별 정보가 없어요');
        return;
      }
      const r = await api.removeApplication(props.order.strategyId, props.order.applicationId);
      if (r.ok) { toast.success('전략 발동 대기가 취소됐어요'); emit('success'); }
      else { toast.error('취소 실패'); confirmStage.value = false; }
    }
  } catch (err) {
    toast.error((err as Error).message);
    confirmStage.value = false;
  } finally { submitting.value = false; }
}
</script>

<template>
  <BottomSheet :open="open" :title="title" @close="emit('close')">
    <template #default>
      <div v-if="order" class="space-y-4">
        <!-- 요약 -->
        <div class="space-y-1 rounded-xl border border-border/60 dark:border-0 bg-muted/30 px-4 py-3">
          <div class="flex items-center gap-1.5">
            <span class="text-[10px] text-muted-foreground">
              <template v-if="order.kind === 'unfilled'">미체결</template>
              <template v-else-if="order.kind === 'morning'">시가매매 예약</template>
              <template v-else>전략 발동 대기</template>
            </span>
            <span
              class="rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none"
              :class="order.side === 'buy' ? 'bg-up text-white' : 'bg-down text-white'"
            >{{ order.side === 'buy' ? '매수' : '매도' }}</span>
          </div>
          <p class="text-sm font-bold">{{ order.name }}</p>
          <p class="text-[10px] text-muted-foreground tabular-nums">{{ order.code }}</p>
          <p v-if="order.kind === 'unfilled' && order.orderPrice !== undefined" class="text-xs text-muted-foreground tabular-nums">
            {{ order.orderPrice === 0 ? '시장가' : fmtKrw(order.orderPrice) }}
            × {{ order.remaining ?? order.qty ?? 0 }}주 잔여
          </p>
          <p v-else-if="order.kind === 'morning'" class="text-xs text-muted-foreground">
            내일 09:00 시가 · {{ order.qtyDesc ?? '' }}
          </p>
        </div>

        <div
          v-if="mode === 'edit'"
          class="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-900 dark:text-amber-200"
        >
          정정 기능은 곧 지원됩니다. 우선 취소 후 다시 주문해 주세요.
        </div>

        <p v-else class="text-[11px] text-muted-foreground">
          {{ confirmStage ? '확인 누르면 곧바로 취소돼요.' : '이 주문을 취소할까요? 되돌릴 수 없어요.' }}
        </p>
      </div>
    </template>

    <template #footer>
      <Button
        v-if="mode === 'cancel' && !confirmStage"
        variant="destructive"
        size="lg"
        class="w-full bg-down text-white hover:bg-down/90"
        @click="confirmStage = true"
      >취소하기</Button>
      <div v-else-if="mode === 'cancel' && confirmStage" class="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="lg" :disabled="submitting" @click="confirmStage = false">돌아가기</Button>
        <Button variant="destructive" size="lg" class="bg-down text-white hover:bg-down/90" :disabled="submitting" @click="doCancel">
          {{ submitting ? '취소 중…' : '확정 취소' }}
        </Button>
      </div>
      <Button v-else variant="secondary" size="lg" class="w-full" @click="emit('close')">닫기</Button>
    </template>
  </BottomSheet>
</template>
