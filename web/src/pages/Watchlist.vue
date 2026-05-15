<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Trash2, RefreshCw, LineChart, Pause, Play } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import SymbolSearch from '@/components/SymbolSearch.vue';
import {
  api,
  type QuotesItem,
  type WatchlistResponse,
  type SearchItem,
} from '@/api/client';
import { fmtKrw, fmtPct, pflsColor } from '@/lib/format';

const router = useRouter();

const data = ref<WatchlistResponse | null>(null);
const quotes = ref<Map<string, QuotesItem>>(new Map());
const loading = ref(true);
const adding = ref(false);

// 폴링 간격 (1/3/5초 옵션 + 일시정지)
const intervalSec = ref(3);
const paused = ref(false);
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
    // 폴링 에러는 silent (네트워크 일시 단절 등). 콘솔에만.
    console.warn('quotes poll fail:', (err as Error).message);
  }
}

function startPolling() {
  stopPolling();
  if (paused.value) return;
  pollTimer = setInterval(loadQuotes, intervalSec.value * 1000);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
function togglePause() {
  paused.value = !paused.value;
  if (paused.value) stopPolling();
  else startPolling();
}

watch(intervalSec, () => startPolling());

async function add(item: SearchItem) {
  adding.value = true;
  try {
    const r = await api.watchlistAdd(item.code);
    if (r.existed) alert('이미 관심종목에 있음');
    await loadList();
  } catch (err) {
    alert(`❌ ${(err as Error).message}`);
  } finally {
    adding.value = false;
  }
}

async function remove(id: number) {
  if (!confirm('관심종목에서 제거하시겠어요?')) return;
  await api.watchlistRemove(id);
  await loadList();
}

function openSymbol(code: string) {
  router.push(`/quote?code=${code}`);
}

onMounted(async () => {
  await loadList();
  startPolling();
});
onUnmounted(() => {
  stopPolling();
});

const lastUpdate = ref<number>(0);
watch(quotes, () => {
  lastUpdate.value = Date.now();
});
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-bold">⭐ 관심종목</h2>
      <Button variant="ghost" size="icon" :disabled="loading" @click="loadList">
        <RefreshCw class="h-4 w-4" :class="loading ? 'animate-spin' : ''" />
      </Button>
    </div>

    <SymbolSearch placeholder="검색해서 추가" @pick="add" />

    <Card v-if="data && data.items.length > 0">
      <template #header>
        <div class="flex items-center justify-between">
          <p class="text-xs text-muted-foreground">
            🔄 {{ paused ? '일시정지' : `${intervalSec}초 간격 자동 갱신` }}
          </p>
          <div class="flex gap-1">
            <Button
              v-for="sec in [1, 3, 5]"
              :key="sec"
              :variant="intervalSec === sec ? 'primary' : 'outline'"
              size="sm"
              @click="intervalSec = sec"
            >
              {{ sec }}s
            </Button>
            <Button variant="ghost" size="icon" @click="togglePause">
              <Pause v-if="!paused" class="h-4 w-4" />
              <Play v-else class="h-4 w-4" />
            </Button>
          </div>
        </div>
      </template>

      <div class="space-y-1">
        <div
          v-for="item in data.items"
          :key="item.id"
          class="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-accent"
        >
          <button class="flex-1 text-left" @click="openSymbol(item.code)">
            <p class="text-sm font-medium">{{ item.name }}</p>
            <p class="text-[11px] text-muted-foreground">{{ item.code }}</p>
          </button>
          <div class="flex items-center gap-3 mr-2">
            <div v-if="quotes.get(item.code)?.ok" class="text-right">
              <p class="text-sm font-semibold" :class="pflsColor(quotes.get(item.code)!.changePct)">
                {{ fmtKrw(quotes.get(item.code)!.price) }}
              </p>
              <p class="text-[11px]" :class="pflsColor(quotes.get(item.code)!.changePct)">
                {{ quotes.get(item.code)!.signLabel }}
                {{ fmtPct(quotes.get(item.code)!.changePct) }}
              </p>
            </div>
            <span v-else class="text-[11px] text-muted-foreground">시세 로딩…</span>
          </div>
          <div class="flex gap-1">
            <Button variant="ghost" size="icon" @click="router.push(`/chart?code=${item.code}`)">
              <LineChart class="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" @click="remove(item.id)">
              <Trash2 class="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      </div>
    </Card>

    <Card v-if="data && data.items.length === 0">
      <p class="text-sm text-muted-foreground">
        관심종목이 비어 있습니다. 위 검색창에서 추가하세요.
      </p>
    </Card>
  </div>
</template>
