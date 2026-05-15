<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Trash2 } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import Modal from '@/components/ui/Modal.vue';
import SymbolSearch from '@/components/SymbolSearch.vue';
import { api, type QuotesItem, type WatchlistResponse, type SearchItem } from '@/api/client';
import { fmtKrw, fmtPct, pflsColor } from '@/lib/format';
import { toast } from '@/lib/toast';

const router = useRouter();

const data = ref<WatchlistResponse | null>(null);
const quotes = ref<Map<string, QuotesItem>>(new Map());
const loading = ref(true);

// 백그라운드 폴링 (UI 노출 X). 페이지 visible일 때만.
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function loadList() {
  loading.value = true;
  try {
    data.value = await api.watchlist();
    await loadQuotes();
  } finally {
    loading.value = false;
  }
}

async function loadQuotes() {
  if (!data.value || data.value.items.length === 0) return;
  const codes = data.value.items.map((it) => it.code);
  try {
    const r = await api.quotes(codes);
    const m = new Map<string, QuotesItem>();
    for (const q of r.items) m.set(q.code, q);
    quotes.value = m;
  } catch (err) {
    console.warn('quotes poll fail:', (err as Error).message);
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(loadQuotes, 2_000);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

// 페이지 visible/hidden에 따라 폴링 on/off (배터리/네트워크 절약)
function onVisibility() {
  if (document.hidden) stopPolling();
  else startPolling();
}

async function add(item: SearchItem) {
  try {
    const r = await api.watchlistAdd(item.code);
    if (r.existed) toast.info('이미 관심종목에 있어요');
    else toast.success(`추가됨 — ${r.name}`);
    await loadList();
  } catch (err) {
    toast.error((err as Error).message);
  }
}

// 제거 확인 모달
const removeTarget = ref<{ id: number; name: string } | null>(null);
function askRemove(item: { id: number; name: string }) {
  removeTarget.value = item;
}
async function confirmRemove() {
  if (!removeTarget.value) return;
  try {
    await api.watchlistRemove(removeTarget.value.id);
    toast.success('제거됨');
    removeTarget.value = null;
    await loadList();
  } catch (err) {
    toast.error((err as Error).message);
  }
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
  <div class="space-y-3">
    <div class="px-1">
      <h2 class="text-base font-semibold tracking-tight">관심종목</h2>
    </div>

    <SymbolSearch placeholder="종목명 또는 6자리 코드" @pick="add" />

    <div v-if="data && data.items.length > 0" class="space-y-1.5">
      <div
        v-for="item in data.items"
        :key="item.id"
        class="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 transition hover:bg-accent"
      >
        <div
          class="min-w-0 flex-1 cursor-pointer"
          @click="router.push(`/quote?code=${item.code}`)"
        >
          <p class="truncate text-sm font-semibold">{{ item.name }}</p>
          <p class="text-[10px] text-muted-foreground tabular-nums">{{ item.code }}</p>
        </div>
        <div
          v-if="quotes.get(item.code)?.ok"
          class="cursor-pointer text-right tabular-nums"
          @click="router.push(`/quote?code=${item.code}`)"
        >
          <p class="text-sm font-bold">{{ fmtKrw(quotes.get(item.code)!.price) }}</p>
          <p class="text-xs font-medium" :class="pflsColor(quotes.get(item.code)!.changePct)">
            {{ fmtPct(quotes.get(item.code)!.changePct) }}
          </p>
        </div>
        <span v-else class="text-[11px] text-muted-foreground">—</span>
        <button
          class="rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
          @click.stop="askRemove({ id: item.id, name: item.name })"
        >
          <Trash2 class="h-4 w-4" />
        </button>
      </div>
    </div>

    <Card v-if="data && data.items.length === 0">
      <p class="text-sm text-muted-foreground">
        관심종목이 비어 있어요. 위 검색창에서 추가하세요.
      </p>
    </Card>

    <Modal :open="!!removeTarget" title="관심종목 제거" @close="removeTarget = null">
      <p class="text-sm text-muted-foreground">
        <span class="font-semibold text-foreground">{{ removeTarget?.name }}</span>을(를) 관심종목에서 제거할까요?
      </p>
      <div class="mt-5 grid grid-cols-2 gap-2">
        <Button variant="secondary" @click="removeTarget = null">아니요</Button>
        <Button variant="destructive" @click="confirmRemove">제거</Button>
      </div>
    </Modal>
  </div>
</template>
