<script setup lang="ts">
import { ref, watch } from 'vue';
import { Search, X } from 'lucide-vue-next';
import { api, type SearchItem } from '@/api/client';

const emit = defineEmits<{ pick: [SearchItem] }>();
const props = defineProps<{ placeholder?: string }>();

const q = ref('');
const results = ref<SearchItem[]>([]);
const loading = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;

watch(q, (v) => {
  if (timer) clearTimeout(timer);
  if (!v.trim()) {
    results.value = [];
    return;
  }
  // 6자리 코드면 자동완성 대신 즉시 emit
  if (/^\d{6}$/.test(v.trim())) {
    emit('pick', { code: v.trim(), name: '' });
    q.value = '';
    results.value = [];
    return;
  }
  timer = setTimeout(async () => {
    loading.value = true;
    try {
      const r = await api.search(v);
      results.value = r.items;
    } catch (err) {
      console.warn(err);
    } finally {
      loading.value = false;
    }
  }, 180);
});

function pick(item: SearchItem) {
  emit('pick', item);
  q.value = '';
  results.value = [];
}

function clear() {
  q.value = '';
  results.value = [];
}
</script>

<template>
  <div class="relative">
    <div class="relative">
      <Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        v-model="q"
        type="search"
        :placeholder="placeholder ?? '종목명 또는 6자리 코드'"
        class="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-9 text-sm focus:border-primary focus:outline-none"
      />
      <button v-if="q" class="absolute right-2 top-1/2 -translate-y-1/2 p-1" @click="clear">
        <X class="h-4 w-4 text-muted-foreground" />
      </button>
    </div>

    <div
      v-if="results.length > 0"
      class="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-auto rounded-lg border border-border bg-card shadow-lg"
    >
      <button
        v-for="r in results"
        :key="r.code"
        class="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
        @click="pick(r)"
      >
        <span>{{ r.name }}</span>
        <span class="font-mono text-xs text-muted-foreground">{{ r.code }}</span>
      </button>
    </div>
    <p v-else-if="q && !loading" class="mt-1 text-xs text-muted-foreground">
      검색 결과 없음
    </p>
  </div>
</template>
