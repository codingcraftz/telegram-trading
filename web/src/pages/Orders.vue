<script setup lang="ts">
// 주문 — [대기 | 체결] 세그먼트.
// 대기: orders 스토어 (3종 통합)
// 체결: /api/orders/filled (days 확장)
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';
import { Inbox, CheckCircle2, RefreshCw } from 'lucide-vue-next';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import Button from '@/components/ui/Button.vue';
import EmptyState from '@/components/EmptyState.vue';
import OrderCard from '@/components/order/OrderCard.vue';
import OrderEditSheet, { type EditableOrder } from '@/components/order/OrderEditSheet.vue';
import OrderDetailSheet from '@/components/order/OrderDetailSheet.vue';
import LoadingState from '@/components/ui/LoadingState.vue';
import { useInfiniteScroll } from '@/composables/useInfiniteScroll';
import { api, type FilledOrder } from '@/api/client';
import { fmtKrw } from '@/lib/format';
import { useOrdersStore } from '@/stores/orders';

// Trade 페이지 내 inline 사용 시 자체 헤더 (h2 '주문') 숨김.
defineProps<{ embedded?: boolean }>();

const route = useRoute();
const router = useRouter();
const store = useOrdersStore();

// ===== 세그먼트 =====
type Seg = 'pending' | 'filled';
const seg = ref<Seg>(((route.query.seg as string) === 'filled' ? 'filled' : 'pending'));

// 내부 변경 → URL 갱신 (같은 값이면 noop)
watch(seg, (v) => {
  if (route.query.seg === v) return;
  router.replace({ query: { ...route.query, seg: v } });
});

// 외부 URL 변경(뒤로가기/딥링크) → seg 동기화
watch(() => route.query.seg, (v) => {
  const next: Seg = v === 'filled' ? 'filled' : 'pending';
  if (seg.value !== next) seg.value = next;
});

// ===== 대기 =====
type PendingItem =
  | { type: 'unfilled'; key: string; createdAt: number; data: EditableOrder & { kind: 'unfilled' } & { orderPrice: number; qty: number; remaining: number } }
  | { type: 'morning';  key: string; createdAt: number; data: EditableOrder & { kind: 'morning' } & { qtyDesc: string } }
  | { type: 'strategy'; key: string; createdAt: number; data: EditableOrder & { kind: 'strategy' } };

const pending = computed<PendingItem[]>(() => {
  const out: PendingItem[] = [];
  const o = store.data;
  if (!o) return out;
  if (o.kis.ok) {
    for (const k of o.kis.items) {
      const isBuy = String(k.side).includes('매수') || String(k.side) === '02';
      out.push({
        type: 'unfilled',
        key: `u-${k.odno}`,
        createdAt: 0,
        data: {
          kind: 'unfilled', code: k.code, name: k.name, side: isBuy ? 'buy' : 'sell',
          orderPrice: k.price, qty: k.qty, remaining: k.remaining,
          odno: k.odno, orgno: k.orgno, ordDvsn: k.ordDvsn,
        },
      });
    }
  }
  for (const r of o.reservations) {
    const qtyDesc =
      r.qtyMode === 'shares' ? `${r.qtyValue}주`
      : r.qtyMode === 'amount' ? `${r.qtyValue.toLocaleString('ko-KR')}원어치`
      : `예수금 ${r.qtyValue}%`;
    out.push({
      type: 'morning',
      key: `m-${r.id}`,
      createdAt: r.scheduledFor,
      data: {
        kind: 'morning', code: r.code, name: r.name, side: 'buy',
        reservationId: r.id, qtyDesc,
      },
    });
  }
  // 전략 감시 중
  for (const s of o.strategies ?? []) {
    const phaseLabel =
      s.phase === 'pending' ? '시가매매 대기'
      : s.phase === 'stage1_firing' ? '1차 발주 중'
      : s.phase === 'stage1_filled' ? '1차 체결 · 감시 중'
      : s.phase === 'stage2_firing' ? '2차 발주 중'
      : s.phase === 'stage2_filled' ? '2차 체결 · 감시 중'
      : s.phase === 'tp1_done' ? '1차 익절 · 잔량 감시'
      : s.phase === 'completed' ? '완료'
      : '대기';
    out.push({
      type: 'strategy',
      key: `s-${s.id}`,
      createdAt: s.appliedAt,
      data: {
        kind: 'strategy',
        code: s.code,
        name: s.name || s.code,
        side: 'buy',
        applicationId: s.id,
        strategyId: s.strategyId,
        strategyName: s.strategyName,
        phaseLabel,
        budgetAmount: s.budgetAmount,
        heldQty: s.heldQty,
        avgPrice: s.avgPrice,
        phase: s.phase,
      },
    });
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
});

// 대기 무한스크롤
const {
  visibleItems: visiblePending,
  sentinelRef: pendingSentinel,
  hasMore: pendingHasMore,
} = useInfiniteScroll(pending, 20);

// ===== 체결 =====
const filledItems = ref<FilledOrder[]>([]);
const filledLoading = ref(false);
const filledDays = ref<number>(7);
const filledHasMore = ref<boolean>(true);

async function loadFilled(days: number) {
  filledLoading.value = true;
  try {
    const r = await api.ordersFilled(days);
    filledItems.value = r.items;
    filledHasMore.value = days < 90 && r.items.length >= 50;
  } catch { filledHasMore.value = false; }
  finally { filledLoading.value = false; }
}
function loadMoreFilled() {
  const next = filledDays.value === 7 ? 30 : 90;
  if (next === filledDays.value) { filledHasMore.value = false; return; }
  filledDays.value = next;
  loadFilled(next);
}

// 날짜 그룹
type DateGroup = { label: string; items: FilledOrder[] };
function dayKeyKst(ts: number): string {
  const k = new Date(new Date(ts).getTime() + 9 * 3600 * 1000);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')}`;
}
function todayKey(): string { return dayKeyKst(Date.now()); }
function dateLabel(key: string): string {
  const td = new Date(todayKey() + 'T00:00:00+09:00').getTime();
  const it = new Date(key + 'T00:00:00+09:00').getTime();
  const diff = Math.round((td - it) / (24 * 3600 * 1000));
  if (diff === 0) return '오늘';
  if (diff === 1) return '어제';
  if (diff <= 6) return `${diff}일 전`;
  return key;
}
// 체결 무한스크롤 — flat list에 limit 적용 후 그룹핑
const {
  visibleItems: visibleFilled,
  sentinelRef: filledSentinel,
  hasMore: filledRowHasMore,
} = useInfiniteScroll(filledItems, 20);

const filledGroups = computed<DateGroup[]>(() => {
  const map = new Map<string, FilledOrder[]>();
  for (const it of visibleFilled.value) {
    const k = dayKeyKst(it.ts);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(it);
  }
  return Array.from(map.entries()).map(([k, arr]) => ({ label: dateLabel(k), items: arr }));
});

function fmtTimeKst(ts: number) {
  return new Date(ts).toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

// 시트
const detailOpen = ref(false);
const detailPending = ref<EditableOrder | null>(null);
const detailFilled = ref<FilledOrder | null>(null);
const editOpen = ref(false);
const editMode = ref<'edit' | 'cancel'>('cancel');
const editOrder = ref<EditableOrder | null>(null);

// strategy 카드 — 보유 있으면 수량/평단, 없으면 예산/phase 표시
function strategyMiddle(d: EditableOrder): string {
  const held = d.heldQty ?? 0;
  const avg = d.avgPrice ?? 0;
  const phase = d.phaseLabel ?? '대기';
  if (held > 0 && avg > 0) return `${held}주 보유 · 평단 ${fmtKrw(avg)} · ${phase}`;
  if (d.budgetAmount && d.budgetAmount > 0) return `자금 ${fmtKrw(d.budgetAmount)} · ${phase}`;
  return phase;
}

function openDetailPending(p: PendingItem) { detailFilled.value = null; detailPending.value = p.data; detailOpen.value = true; }
function openDetailFilled(f: FilledOrder) { detailPending.value = null; detailFilled.value = f; detailOpen.value = true; }
function closeDetail() { detailOpen.value = false; }
function openEdit(order: EditableOrder, mode: 'edit' | 'cancel') {
  editOrder.value = order; editMode.value = mode; editOpen.value = true; detailOpen.value = false;
}
function closeEdit() { editOpen.value = false; }
async function onEditSuccess() { editOpen.value = false; await store.refresh(); }

onMounted(() => {
  store.subscribe(4000);
  loadFilled(filledDays.value);
});
onUnmounted(() => store.unsubscribe());

// 체결 탭 전환 시 최신 데이터 갱신
watch(seg, (v) => { if (v === 'filled') loadFilled(filledDays.value); });
</script>

<template>
  <div class="space-y-4">
    <div v-if="!embedded" class="flex items-center justify-between px-1">
      <h2 class="text-lg font-bold tracking-tight">주문</h2>
      <button
        v-if="seg === 'pending'"
        class="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent"
        :disabled="store.loading"
        @click="store.refresh()"
      >
        <RefreshCw class="h-4 w-4" :class="store.loading ? 'animate-spin' : ''" />
      </button>
    </div>

    <SegmentedControl
      v-model="seg"
      :options="[
        { value: 'pending', label: `대기${store.count ? ` ${store.count}` : ''}` },
        { value: 'filled', label: '체결' },
      ]"
    />

    <!-- 대기 — store.data 가 null 이면 첫 fetch 안 됐다는 뜻 → skeleton.
         이후엔 pending.length 기준으로 카드/EmptyState 정적 전환. -->
    <template v-if="seg === 'pending'">
      <div v-if="store.data === null" class="space-y-2">
        <div v-for="n in 3" :key="n" class="h-[96px] animate-pulse rounded-2xl bg-card" />
      </div>
      <div v-else-if="pending.length > 0" class="space-y-2">
        <OrderCard
          v-for="p in visiblePending"
          :key="p.key"
          :type="p.type"
          :side="p.data.side"
          :name="p.data.name"
          :code="p.data.code"
          :type-label="
            p.type === 'unfilled' ? '미체결' :
            p.type === 'morning' ? '내일 09:00 시가매매' :
            p.data.strategyName ? `전략 · ${p.data.strategyName}` : '전략 감시'
          "
          :middle-line="
            p.type === 'unfilled'
              ? `${p.data.orderPrice === 0 ? '시장가' : fmtKrw(p.data.orderPrice)} × ${p.data.remaining}주 잔여`
              : p.type === 'morning'
                ? `다음 영업일 09:00 / ${p.data.qtyDesc}`
                : strategyMiddle(p.data)
          "
          :action1-label="p.type === 'unfilled' ? '정정' : '수정'"
          :action2-label="p.type === 'unfilled' || p.type === 'morning' ? '취소' : '중지'"
          @open="openDetailPending(p)"
          @action1="openEdit(p.data, 'edit')"
          @action2="openEdit(p.data, 'cancel')"
        />
        <div v-if="pendingHasMore" ref="pendingSentinel" class="h-2" />
      </div>
      <EmptyState
        v-else
        :icon="Inbox"
        title="대기 중인 주문이 없어요"
        description="종목을 골라 매수해보세요."
      >
        <template #action>
          <RouterLink to="/stocks">
            <Button variant="primary" size="md">종목 둘러보기</Button>
          </RouterLink>
        </template>
      </EmptyState>
    </template>

    <!-- 체결 -->
    <template v-else>
      <div v-if="filledGroups.length > 0" class="space-y-4">
        <section v-for="g in filledGroups" :key="g.label" class="space-y-1.5">
          <p class="px-1 text-xs font-semibold text-muted-foreground">{{ g.label }}</p>
          <div class="space-y-1">
            <button
              v-for="f in g.items"
              :key="`f-${f.odno}-${f.ts}`"
              type="button"
              class="flex w-full cursor-pointer items-center gap-3 rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 px-4 py-3 text-left transition active:scale-[0.99]"
              @click="openDetailFilled(f)"
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-baseline gap-1.5">
                  <span class="truncate text-sm font-bold">{{ f.name }}</span>
                  <span
                    class="rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none"
                    :class="f.side === 'buy' ? 'bg-up text-white' : 'bg-down text-white'"
                  >{{ f.side === 'buy' ? '매수' : '매도' }}</span>
                </div>
                <p class="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                  {{ fmtTimeKst(f.ts) }} · {{ fmtKrw(f.price) }} × {{ f.qty }}주
                </p>
              </div>
              <div class="shrink-0 text-right tabular-nums">
                <p class="text-sm font-bold">{{ fmtKrw(f.amount) }}</p>
                <p
                  v-if="f.side === 'sell' && f.pnl !== undefined && f.pnl !== null"
                  class="mt-0.5 text-[11px] font-semibold"
                  :class="f.pnl > 0 ? 'text-up' : f.pnl < 0 ? 'text-down' : 'text-muted-foreground'"
                >
                  {{ f.pnl > 0 ? '+' : '' }}{{ fmtKrw(f.pnl) }}
                </p>
              </div>
            </button>
          </div>
        </section>

        <!-- 클라 visible limit 확장용 sentinel -->
        <div v-if="filledRowHasMore" ref="filledSentinel" class="h-2" />

        <!-- 클라 limit 끝까지 갔는데 서버 days 확장 가능 시 버튼 -->
        <div v-if="!filledRowHasMore && filledHasMore" class="pt-2 text-center">
          <Button
            variant="secondary"
            size="md"
            :disabled="filledLoading"
            @click="loadMoreFilled"
          >
            {{ filledLoading ? '불러오는 중…' : '더 긴 기간 보기' }}
          </Button>
        </div>
      </div>

      <div v-else-if="filledLoading" class="space-y-2">
        <div v-for="n in 3" :key="n" class="h-[96px] animate-pulse rounded-2xl bg-card" />
      </div>

      <EmptyState
        v-else
        :icon="CheckCircle2"
        title="체결 내역이 없어요"
        description="첫 거래를 시작해보세요."
      />
    </template>

    <OrderDetailSheet
      :open="detailOpen"
      :order="detailPending"
      :filled="detailFilled"
      @close="closeDetail"
      @edit="detailPending && openEdit(detailPending, 'edit')"
      @cancel="detailPending && openEdit(detailPending, 'cancel')"
    />

    <OrderEditSheet
      :open="editOpen"
      :mode="editMode"
      :order="editOrder"
      @close="closeEdit"
      @success="onEditSuccess"
    />
  </div>
</template>
