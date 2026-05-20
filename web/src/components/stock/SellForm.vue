<script setup lang="ts">
// SellForm — 시장가 전용 매도 BottomSheet. 전부/반만/직접 + T+0 안내 + inline confirm.
import { computed, ref, watch } from 'vue';
import BottomSheet from '@/components/ui/BottomSheet.vue';
import Button from '@/components/ui/Button.vue';
import PriceStepper from '@/components/PriceStepper.vue';
import { api } from '@/api/client';
import { fmtKrw } from '@/lib/format';
import { toast } from '@/lib/toast';

type QtyMode = 'all' | 'half' | 'shares';

const props = defineProps<{
  open: boolean;
  code: string;
  name: string;
  currentPrice: number;
  holdingQty: number;
  orderableQty: number;
}>();

const emit = defineEmits<{ close: []; success: [] }>();

const qtyMode = ref<QtyMode>('all');
const qtyShares = ref<number>(1);
const submitting = ref(false);
const confirmStage = ref(false);

watch(() => props.open, (v) => {
  if (!v) return;
  qtyMode.value = 'all';
  qtyShares.value = 1;
  confirmStage.value = false;
  submitting.value = false;
});

const sellableMax = computed(() =>
  props.orderableQty > 0 ? props.orderableQty : props.holdingQty,
);
const unsettled = computed(() => Math.max(0, props.holdingQty - sellableMax.value));
const effectiveQty = computed(() => {
  const max = sellableMax.value;
  if (max <= 0) return 0;
  if (qtyMode.value === 'all') return max;
  if (qtyMode.value === 'half') return Math.max(1, Math.floor(max / 2));
  return Math.max(0, Math.min(qtyShares.value, max));
});
const totalRevenue = computed(() => effectiveQty.value * props.currentPrice);

const canSubmit = computed(() =>
  !submitting.value && effectiveQty.value > 0 && effectiveQty.value <= sellableMax.value,
);

async function submit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  try {
    const reg = await api.tradeSell({
      code: props.code,
      qtyMode: qtyMode.value,
      qtyValue: qtyMode.value === 'shares' ? qtyShares.value : undefined,
      execute: true,
    });
    if (reg.result?.ok) { toast.success('주문이 접수되었습니다'); emit('success'); }
    else { toast.error(reg.result?.message || '주문이 거절됐어요'); confirmStage.value = false; }
  } catch (err) {
    toast.error((err as Error).message);
    confirmStage.value = false;
  } finally { submitting.value = false; }
}
</script>

<template>
  <BottomSheet :open="open" @close="emit('close')">
    <template #default>
      <div class="space-y-4">
        <div>
          <p class="text-[11px] text-muted-foreground">{{ name }}</p>
          <p class="mt-1 text-lg font-bold tracking-tight text-down">매도</p>
        </div>

        <!-- T+0 안내 -->
        <div
          v-if="unsettled > 0"
          class="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-900 dark:text-amber-200"
        >
          오늘 산 <span class="font-semibold tabular-nums">{{ unsettled }}주</span>는 내일부터 매도 가능해요.
          지금은 <span class="font-semibold tabular-nums">{{ sellableMax }}주</span>까지만 팔 수 있어요.
        </div>

        <template v-if="!confirmStage">
          <!-- 현재가 -->
          <div class="flex items-baseline justify-between rounded-xl bg-muted/40 px-3 py-2.5">
            <span class="text-lg font-bold tabular-nums">{{ fmtKrw(currentPrice) }}</span>
            <span class="text-[10px] text-muted-foreground">시장가로 즉시 매도</span>
          </div>

          <!-- 수량 -->
          <div>
            <div class="mb-1.5 flex items-center justify-between">
              <p class="text-[11px] font-semibold text-muted-foreground">수량</p>
              <p class="text-[10px] text-muted-foreground tabular-nums">매도가능 {{ sellableMax }}주</p>
            </div>
            <div class="grid grid-cols-3 gap-1.5">
              <button
                v-for="m in [{v:'all',l:'전부'},{v:'half',l:'반만'},{v:'shares',l:'직접'}]" :key="m.v"
                type="button"
                class="rounded-md py-1.5 text-[11px] font-semibold transition"
                :class="qtyMode === m.v ? 'bg-down text-white' : 'bg-muted/50 hover:bg-muted'"
                :disabled="sellableMax <= 0"
                @click="qtyMode = m.v as QtyMode"
              >
                {{ m.l }}
              </button>
            </div>
            <PriceStepper
              v-if="qtyMode === 'shares'"
              v-model="qtyShares"
              :step="1"
              :min="1"
              :max="sellableMax"
              suffix="주"
              compact
              class="mt-2"
            />
          </div>

          <!-- 요약 -->
          <div class="space-y-1 rounded-xl bg-primary/10 px-3 py-2.5 tabular-nums">
            <div class="flex items-baseline justify-between">
              <span class="text-[11px] text-muted-foreground">예상 받을 돈</span>
              <span class="text-base font-bold">{{ fmtKrw(totalRevenue) }}</span>
            </div>
            <div class="flex items-baseline justify-between text-[10px] text-muted-foreground">
              <span>보유</span>
              <span>{{ holdingQty }}주</span>
            </div>
          </div>
        </template>

        <!-- 확인 -->
        <template v-else>
          <div class="space-y-2 rounded-xl border border-border/60 dark:border-0 bg-muted/30 px-4 py-3 text-sm">
            <div class="flex justify-between"><span class="text-muted-foreground">가격</span>
              <span class="font-semibold tabular-nums">{{ fmtKrw(currentPrice) }} · 시장가</span>
            </div>
            <div class="flex justify-between"><span class="text-muted-foreground">수량</span>
              <span class="font-semibold tabular-nums">{{ effectiveQty }}주</span>
            </div>
            <div class="flex justify-between"><span class="text-muted-foreground">예상 받을 돈</span>
              <span class="font-semibold tabular-nums">{{ fmtKrw(totalRevenue) }}</span>
            </div>
          </div>
          <p class="text-[11px] text-muted-foreground">확인 누르면 곧바로 증권사로 주문이 전송돼요.</p>
        </template>
      </div>
    </template>

    <template #footer>
      <Button
        v-if="!confirmStage"
        variant="destructive"
        size="lg"
        class="w-full bg-down text-white hover:bg-down/90"
        :disabled="!canSubmit"
        @click="confirmStage = true"
      >
        {{ effectiveQty }}주 매도하기
      </Button>
      <div v-else class="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="lg" :disabled="submitting" @click="confirmStage = false">돌아가기</Button>
        <Button variant="destructive" size="lg" class="bg-down text-white hover:bg-down/90" :disabled="submitting" @click="submit">
          {{ submitting ? '보내는 중…' : '매도 확정' }}
        </Button>
      </div>
    </template>
  </BottomSheet>
</template>
