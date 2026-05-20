<script setup lang="ts">
// OrderDetailSheet — 행 탭 시 상세 정보. 대기/체결 공용.
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import BottomSheet from '@/components/ui/BottomSheet.vue';
import Button from '@/components/ui/Button.vue';
import { fmtKrw } from '@/lib/format';
import type { EditableOrder } from './OrderEditSheet.vue';

type DetailRow = { label: string; value: string };

const props = defineProps<{
  open: boolean;
  order?: EditableOrder | null;
  filled?: {
    name: string;
    code: string;
    side: 'buy' | 'sell';
    ts: number;
    qty: number;
    price: number;
    amount: number;
    odno: string;
  } | null;
}>();

const emit = defineEmits<{ close: []; edit: []; cancel: [] }>();

const router = useRouter();

const isPending = computed(() => !!props.order);
const isFilled = computed(() => !!props.filled);

const headerName = computed(() => props.order?.name ?? props.filled?.name ?? '');
const headerCode = computed(() => props.order?.code ?? props.filled?.code ?? '');
const headerSide = computed(() => props.order?.side ?? props.filled?.side ?? 'buy');

function fmtKst(ts: number) {
  return new Date(ts).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
}

const rows = computed<DetailRow[]>(() => {
  if (props.order) {
    const o = props.order;
    if (o.kind === 'unfilled') {
      return [
        { label: '종류', value: '미체결' },
        { label: '주문번호', value: o.odno ?? '-' },
        { label: '가격', value: o.orderPrice ? fmtKrw(o.orderPrice) : '시장가' },
        { label: '수량', value: `${o.qty ?? 0}주` },
        { label: '잔여', value: `${o.remaining ?? 0}주` },
      ];
    }
    if (o.kind === 'morning') {
      return [
        { label: '종류', value: '시가매매 예약' },
        { label: '발주 예정', value: '다음 영업일 09:00 시가' },
        { label: '수량', value: o.qtyDesc ?? '-' },
      ];
    }
    return [{ label: '종류', value: '전략 발동 대기' }];
  }
  if (props.filled) {
    const f = props.filled;
    return [
      { label: '체결 시각', value: fmtKst(f.ts) },
      { label: '주문번호', value: f.odno },
      { label: '체결가', value: fmtKrw(f.price) },
      { label: '수량', value: `${f.qty}주` },
      { label: '체결금액', value: fmtKrw(f.amount) },
    ];
  }
  return [];
});

function goSymbol() {
  emit('close');
  router.push(`/stocks/${headerCode.value}`);
}
</script>

<template>
  <BottomSheet :open="open" :title="isFilled ? '체결 상세' : '주문 상세'" @close="emit('close')">
    <template #default>
      <div class="space-y-4">
        <div class="flex items-baseline gap-2">
          <p class="text-base font-bold tracking-tight">{{ headerName }}</p>
          <span class="text-[10px] text-muted-foreground tabular-nums">{{ headerCode }}</span>
          <span
            class="ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold"
            :class="headerSide === 'buy' ? 'bg-up text-white' : 'bg-down text-white'"
          >{{ headerSide === 'buy' ? '매수' : '매도' }}</span>
        </div>

        <div class="space-y-2 rounded-xl border border-border/60 dark:border-0 bg-muted/30 px-4 py-3 text-sm">
          <div v-for="r in rows" :key="r.label" class="flex justify-between">
            <span class="text-muted-foreground">{{ r.label }}</span>
            <span class="font-semibold tabular-nums">{{ r.value }}</span>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="space-y-2">
        <div v-if="isPending && order?.kind !== 'strategy'" class="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" @click="emit('edit')">정정</Button>
          <Button variant="destructive" size="lg" class="bg-down text-white hover:bg-down/90" @click="emit('cancel')">취소</Button>
        </div>
        <Button variant="primary" size="lg" class="w-full" @click="goSymbol">이 종목 보기</Button>
      </div>
    </template>
  </BottomSheet>
</template>
