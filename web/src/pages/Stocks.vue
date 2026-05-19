<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { Star, Trash2, ArrowUpRight, ArrowDownRight, Check } from 'lucide-vue-next';
import EmptyState from '@/components/EmptyState.vue';
import SectionHeader from '@/components/SectionHeader.vue';
import Button from '@/components/ui/Button.vue';
import Modal from '@/components/ui/Modal.vue';
import { api, type QuotesItem, type WatchlistResponse, type BalanceResponse } from '@/api/client';
import { fmtKrw, fmtPct, fmtSigned, pflsColor } from '@/lib/format';
import { toast } from '@/lib/toast';

const router = useRouter();

const data = ref<WatchlistResponse | null>(null);
const balance = ref<BalanceResponse | null>(null);
const quotes = ref<Map<string, QuotesItem>>(new Map());
const editing = ref(false);
const selectedIds = ref<Set<number>>(new Set());
const removeOpen = ref(false);

let pollTimer: ReturnType<typeof setInterval> | null = null;

async function loadList() {
  const [w, b] = await Promise.all([api.watchlist(), api.balance().catch(() => null)]);
  data.value = w;
  if (b) balance.value = b;
  await loadQuotes();
}

async function loadQuotes() {
  const codes = new Set<string>();
  for (const it of data.value?.items ?? []) codes.add(it.code);
  for (const h of balance.value?.holdings ?? []) codes.add(h.code);
  if (codes.size === 0) return;
  try {
    const r = await api.quotes(Array.from(codes));
    const m = new Map<string, QuotesItem>();
    for (const q of r.items) m.set(q.code, q);
    quotes.value = m;
  } catch (err) {
    console.warn('quotes poll fail:', (err as Error).message);
  }
}

async function loadBalance() {
  try {
    balance.value = await api.balance();
  } catch { /* silent */ }
}

function startPolling() {
  stopPolling();
  if (document.hidden) return;
  pollTimer = setInterval(() => {
    loadQuotes();
    loadBalance();
  }, 5_000);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
function onVisibility() {
  if (document.hidden) stopPolling();
  else startPolling();
}

function toggleEditing() {
  editing.value = !editing.value;
  selectedIds.value.clear();
}

function toggleSelect(id: number) {
  if (selectedIds.value.has(id)) selectedIds.value.delete(id);
  else selectedIds.value.add(id);
  selectedIds.value = new Set(selectedIds.value);
}

const selectedCount = computed(() => selectedIds.value.size);
const holdings = computed(() => balance.value?.holdings ?? []);

async function confirmRemove() {
  removeOpen.value = false;
  const ids = Array.from(selectedIds.value);
  try {
    await Promise.all(ids.map((id) => api.watchlistRemove(id)));
    toast.success(`${ids.length}개 종목을 관심에서 뺐어요`);
    selectedIds.value.clear();
    editing.value = false;
    await loadList();
  } catch (err) {
    toast.error((err as Error).message);
  }
}

function go(code: string) {
  if (editing.value) return;
  router.push(`/stocks/${code}`);
}

function goSell(code: string, e: Event) {
  e.stopPropagation();
  router.push({ path: `/stocks/${code}`, query: { tab: 'sell' } });
}

onMounted(async () => {
  await loadList();
  startPolling();
  document.addEventListener('visibilitychange', onVisibility);
});
onUnmounted(() => {
  stopPolling();
  document.removeEventListener('visibilitychange', onVisibility);
});
</script>

<template>
  <div class="space-y-4">
    <div class="px-1">
      <h2 class="text-lg font-bold tracking-tight">종목</h2>
    </div>

    <!-- 보유 종목 -->
    <section v-if="holdings.length > 0" class="space-y-2">
      <SectionHeader title="갖고 있는 종목" :count="holdings.length" />
      <div class="space-y-1.5">
        <div
          v-for="h in holdings"
          :key="h.code"
          class="rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 px-4 py-3.5 transition active:scale-[0.99]"
          @click="go(h.code)"
          role="link"
          tabindex="0"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <p class="truncate text-base font-bold tracking-tight">{{ h.name }}</p>
              <p class="mt-0.5 truncate text-[11px] text-muted-foreground tabular-nums">
                {{ h.qty }}주 · 매수가 {{ fmtKrw(h.avg) }}
              </p>
            </div>
            <div class="shrink-0 text-right tabular-nums">
              <p class="flex items-center justify-end gap-0.5 text-base font-bold leading-none" :class="pflsColor(h.pflsAmt)">
                <ArrowUpRight v-if="h.pflsAmt > 0" class="h-3.5 w-3.5" />
                <ArrowDownRight v-else-if="h.pflsAmt < 0" class="h-3.5 w-3.5" />
                {{ fmtPct(h.pflsRt) }}
              </p>
              <p class="mt-0.5 text-[11px] font-medium" :class="pflsColor(h.pflsAmt)">
                {{ fmtSigned(h.pflsAmt) }}원
              </p>
            </div>
          </div>
          <div class="mt-2 flex items-center justify-between border-t border-border/60 pt-2 text-[11px]">
            <span class="text-muted-foreground">지금 <span class="font-semibold text-foreground tabular-nums">{{ fmtKrw(h.cur) }}</span></span>
            <button
              class="rounded-md bg-muted px-2.5 py-1 text-[11px] font-semibold transition hover:bg-accent"
              @click="goSell(h.code, $event)"
            >
              팔기
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 관심 종목 -->
    <section class="space-y-2">
      <SectionHeader title="관심 종목" :count="data?.items.length ?? 0">
        <template #action>
          <button
            v-if="(data?.items.length ?? 0) > 0"
            class="rounded-full px-2.5 py-1 text-xs font-semibold transition"
            :class="editing ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="toggleEditing"
          >
            {{ editing ? '완료' : '편집' }}
          </button>
        </template>
      </SectionHeader>

      <div v-if="data && data.items.length > 0" class="space-y-1.5">
        <div
          v-for="item in data.items"
          :key="item.id"
          class="flex items-center gap-3 rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 px-4 py-3.5 transition active:scale-[0.99] cursor-pointer"
          @click="editing ? toggleSelect(item.id) : go(item.code)"
        >
          <div
            v-if="editing"
            class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
            :class="selectedIds.has(item.id) ? 'border-destructive bg-destructive text-destructive-foreground' : 'border-border'"
          >
            <Check v-if="selectedIds.has(item.id)" class="h-3 w-3" />
          </div>

          <div class="min-w-0 flex-1">
            <p class="truncate text-base font-bold tracking-tight">{{ item.name }}</p>
            <p class="mt-0.5 text-[11px] text-muted-foreground tabular-nums">{{ item.code }}</p>
          </div>

          <div v-if="quotes.get(item.code)?.ok" class="shrink-0 text-right tabular-nums">
            <p class="text-base font-bold">{{ fmtKrw(quotes.get(item.code)!.price) }}</p>
            <p class="flex items-center justify-end gap-0.5 text-xs font-medium" :class="pflsColor(quotes.get(item.code)!.changePct)">
              <ArrowUpRight v-if="quotes.get(item.code)!.changePct > 0" class="h-3 w-3" />
              <ArrowDownRight v-else-if="quotes.get(item.code)!.changePct < 0" class="h-3 w-3" />
              {{ fmtPct(quotes.get(item.code)!.changePct) }}
            </p>
          </div>
          <span v-else class="shrink-0 text-[11px] text-muted-foreground">—</span>
        </div>
      </div>

      <EmptyState
        v-else-if="data"
        :icon="Star"
        title="관심 종목이 비어 있어요"
        description="상단 검색창에서 종목을 찾아 별표 ★를 누르면 여기 담겨요."
      />

      <!-- 편집 모드 액션 바 -->
      <div
        v-if="editing && selectedCount > 0"
        class="sticky bottom-20 z-10 mt-3 flex items-center gap-2 rounded-2xl bg-card ring-1 ring-border/60 dark:ring-0 px-4 py-3 shadow-lg"
      >
        <span class="text-sm font-medium">{{ selectedCount }}개 선택됨</span>
        <Button variant="destructive" size="sm" class="ml-auto" @click="removeOpen = true">
          <Trash2 class="mr-1 h-3.5 w-3.5" />
          관심에서 빼기
        </Button>
      </div>
    </section>

    <Modal :open="removeOpen" title="관심 종목에서 뺄까요?" @close="removeOpen = false">
      <p class="text-sm text-muted-foreground">
        선택한 <span class="font-semibold text-foreground">{{ selectedCount }}개</span> 종목을 관심에서 뺄게요.
      </p>
      <div class="mt-5 grid grid-cols-2 gap-2">
        <Button variant="secondary" @click="removeOpen = false">아니요</Button>
        <Button variant="destructive" @click="confirmRemove">빼기</Button>
      </div>
    </Modal>
  </div>
</template>
