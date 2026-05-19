<script setup lang="ts">
// QuickTradeSheet — 시장가 빠른 매수/매도. 카드의 [매수][매도]에서 호출.
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowRight } from 'lucide-vue-next';
import BottomSheet from '@/components/ui/BottomSheet.vue';
import Button from '@/components/ui/Button.vue';
import PriceStepper from '@/components/PriceStepper.vue';
import { api } from '@/api/client';
import { fmtKrw } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useOrdersStore } from '@/stores/orders';

const props = withDefaults(defineProps<{
  open: boolean;
  code: string;
  name: string;
  side: 'buy' | 'sell';
  currentPrice: number;
  holdingQty?: number;
  sellableQty?: number;
  availableCash?: number;
}>(), { holdingQty: 0, sellableQty: 0, availableCash: 0 });

const emit = defineEmits<{ close: []; submitted: [] }>();

const router = useRouter();
const ordersStore = useOrdersStore();

const qty = ref<number>(1);
const submitting = ref(false);
const confirmStage = ref(false);

watch(() => props.open, (v) => { if (v) { qty.value = 1; confirmStage.value = false; } });

const maxQty = computed(() => {
  if (props.side === 'sell') return props.sellableQty > 0 ? props.sellableQty : props.holdingQty;
  if (props.currentPrice <= 0) return 0;
  return Math.floor(props.availableCash / props.currentPrice);
});
const unsettled = computed(() =>
  props.side === 'sell' ? Math.max(0, props.holdingQty - props.sellableQty) : 0,
);
const totalAmount = computed(() => qty.value * props.currentPrice);

function setPct(p: number) {
  if (maxQty.value <= 0) return;
  if (p === 100) { qty.value = maxQty.value; return; }
  qty.value = Math.max(1, Math.floor((maxQty.value * p) / 100));
}
const canSubmit = computed(() => !submitting.value && qty.value > 0 && qty.value <= maxQty.value);

async function submit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  try {
    if (props.side === 'buy') {
      const r = await api.tradeBuy({
        code: props.code, strategy: 'now',
        amount: { mode: 'shares', value: qty.value },
        tp: null, sl: null, execute: true,
      });
      if (r.result?.ok) toast.success('주문이 접수되었습니다');
      else if (r.result) toast.error(r.result.message || '주문이 거절됐어요');
      else toast.success('주문이 접수되었습니다');
    } else {
      const r = await api.tradeSell({
        code: props.code, qtyMode: 'shares', qtyValue: qty.value, execute: true,
      });
      if (r.result?.ok) toast.success('주문이 접수되었습니다');
      else toast.error(r.result?.message || '주문이 거절됐어요');
    }
    // 시트 즉시 닫기. refresh는 백그라운드.
    emit('submitted');
    emit('close');
    ordersStore.refresh();
  } catch (err) {
    toast.error((err as Error).message);
    confirmStage.value = false;
  } finally { submitting.value = false; }
}

function gotoDetail() {
  emit('close');
  router.push(`/stocks/${props.code}?tab=${props.side}`);
}
</script>

<template>
  <BottomSheet :open="open" @close="emit('close')">
    <template #default>
      <div class="space-y-4">
        <div>
          <p class="text-[11px] text-muted-foreground">{{ name }}</p>
          <p class="mt-1 text-lg font-bold tracking-tight" :class="side === 'buy' ? 'text-up' : 'text-down'">
            {{ side === 'buy' ? '빠른 매수' : '빠른 매도' }}
          </p>
        </div>

        <div class="flex items-baseline justify-between rounded-xl bg-muted/40 px-3 py-2.5">
          <span class="text-lg font-bold tabular-nums">{{ fmtKrw(currentPrice) }}원</span>
          <span class="text-[10px] text-muted-foreground">시장가</span>
        </div>

        <template v-if="!confirmStage">
          <div>
            <div class="mb-1.5 flex items-center justify-between">
              <p class="text-[11px] font-semibold text-muted-foreground">수량</p>
              <p class="text-[10px] text-muted-foreground tabular-nums">
                <template v-if="side === 'buy'">매수가능 {{ availableCash.toLocaleString('ko-KR') }}원</template>
                <template v-else>
                  최대 {{ maxQty }}주
                  <span v-if="unsettled > 0" class="ml-1 text-amber-700 dark:text-amber-300">
                    (T+0 {{ unsettled }}주 제외)
                  </span>
                </template>
              </p>
            </div>
            <PriceStepper v-model="qty" :step="1" :min="1" :max="maxQty || 1" suffix="주" compact />
            <div class="mt-1.5 grid grid-cols-4 gap-1">
              <button
                v-for="p in [10, 25, 50, 100]" :key="p"
                type="button"
                class="rounded-md bg-muted/50 py-1.5 text-[10px] font-semibold transition hover:bg-muted"
                :disabled="maxQty <= 0"
                @click="setPct(p)"
              >
                {{ p === 100 ? '전부' : `${p}%` }}
              </button>
            </div>
          </div>

          <div class="flex items-center justify-between rounded-xl bg-primary/10 px-3 py-2.5 tabular-nums">
            <span class="text-[11px] text-muted-foreground">{{ side === 'buy' ? '예상 매수액' : '예상 받을 돈' }}</span>
            <span class="text-base font-bold">{{ fmtKrw(totalAmount) }}원</span>
          </div>

          <button
            type="button"
            class="flex w-full items-center justify-between rounded-md px-1 py-1.5 text-[10px] text-muted-foreground transition hover:bg-accent"
            @click="gotoDetail"
          >
            <span>지정가·자동매도가 필요하면 상세로</span>
            <ArrowRight class="h-3.5 w-3.5" />
          </button>
        </template>

        <template v-else>
          <div class="space-y-2 rounded-xl border border-border/60 dark:border-0 bg-muted/30 px-4 py-3 text-sm">
            <div class="flex justify-between"><span class="text-muted-foreground">수량</span>
              <span class="font-semibold tabular-nums">{{ qty }}주</span>
            </div>
            <div class="flex justify-between"><span class="text-muted-foreground">{{ side === 'buy' ? '예상 매수액' : '예상 받을 돈' }}</span>
              <span class="font-semibold tabular-nums">{{ fmtKrw(totalAmount) }}원</span>
            </div>
            <div class="flex justify-between"><span class="text-muted-foreground">가격</span>
              <span class="font-semibold">시장가</span>
            </div>
          </div>
        </template>
      </div>
    </template>

    <template #footer>
      <Button
        v-if="!confirmStage"
        :variant="side === 'buy' ? 'primary' : 'destructive'"
        size="lg"
        class="w-full text-white"
        :class="side === 'buy' ? 'bg-up hover:bg-up/90' : 'bg-down hover:bg-down/90'"
        :disabled="!canSubmit"
        @click="confirmStage = true"
      >
        {{ qty }}주 {{ side === 'buy' ? '매수' : '매도' }}
      </Button>
      <div v-else class="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="lg" :disabled="submitting" @click="confirmStage = false">돌아가기</Button>
        <Button
          :variant="side === 'buy' ? 'primary' : 'destructive'"
          size="lg"
          class="text-white"
          :class="side === 'buy' ? 'bg-up hover:bg-up/90' : 'bg-down hover:bg-down/90'"
          :disabled="submitting"
          @click="submit"
        >
          {{ submitting ? '보내는 중…' : `${side === 'buy' ? '매수' : '매도'} 확정` }}
        </Button>
      </div>
    </template>
  </BottomSheet>
</template>
