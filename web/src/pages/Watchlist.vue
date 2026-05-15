<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { Trash2, RefreshCw, LineChart } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import SymbolSearch from '@/components/SymbolSearch.vue';
import { api, type WatchlistResponse, type SearchItem } from '@/api/client';

const data = ref<WatchlistResponse | null>(null);
const loading = ref(true);
const adding = ref(false);

async function load() {
  loading.value = true;
  try {
    data.value = await api.watchlist();
  } finally {
    loading.value = false;
  }
}

async function add(item: SearchItem) {
  adding.value = true;
  try {
    const r = await api.watchlistAdd(item.code);
    if (r.existed) alert('이미 관심종목에 있음');
    await load();
  } catch (err) {
    alert(`❌ ${(err as Error).message}`);
  } finally {
    adding.value = false;
  }
}

async function remove(id: number) {
  if (!confirm('관심종목에서 제거하시겠어요?')) return;
  await api.watchlistRemove(id);
  await load();
}

onMounted(load);
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-bold">⭐ 관심종목</h2>
      <Button variant="ghost" size="icon" :disabled="loading" @click="load">
        <RefreshCw class="h-4 w-4" :class="loading ? 'animate-spin' : ''" />
      </Button>
    </div>

    <SymbolSearch placeholder="검색해서 추가" @pick="add" />

    <Card v-if="data && data.items.length === 0">
      <p class="text-sm text-muted-foreground">
        관심종목이 비어 있습니다. 위 검색창에서 추가하세요.
      </p>
    </Card>

    <Card v-if="data && data.items.length > 0">
      <div class="space-y-1">
        <div
          v-for="item in data.items"
          :key="item.id"
          class="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-accent"
        >
          <RouterLink :to="`/quote?code=${item.code}`" class="flex-1">
            <p class="text-sm font-medium">{{ item.name }}</p>
            <p class="text-[11px] text-muted-foreground">{{ item.code }}</p>
          </RouterLink>
          <div class="flex gap-1">
            <RouterLink :to="`/chart?code=${item.code}`">
              <Button variant="ghost" size="icon">
                <LineChart class="h-4 w-4" />
              </Button>
            </RouterLink>
            <Button variant="ghost" size="icon" @click="remove(item.id)">
              <Trash2 class="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      </div>
    </Card>
  </div>
</template>
