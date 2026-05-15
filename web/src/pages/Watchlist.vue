<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Trash2, RefreshCw } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import { api, type WatchlistResponse } from '@/api/client';

const data = ref<WatchlistResponse | null>(null);
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    data.value = await api.watchlist();
  } finally {
    loading.value = false;
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
    <p class="text-xs text-muted-foreground">
      PR3에서 검색·추가 기능 구현 예정. 현재는 목록 + 제거만 가능.
    </p>

    <Card v-if="data && data.items.length === 0">
      <p class="text-sm text-muted-foreground">관심종목 없음</p>
    </Card>

    <Card v-if="data && data.items.length > 0">
      <div class="space-y-1">
        <div
          v-for="item in data.items"
          :key="item.id"
          class="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-accent"
        >
          <div>
            <p class="text-sm font-medium">{{ item.name }}</p>
            <p class="text-[11px] text-muted-foreground">{{ item.code }}</p>
          </div>
          <Button variant="ghost" size="icon" @click="remove(item.id)">
            <Trash2 class="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>
    </Card>
  </div>
</template>
