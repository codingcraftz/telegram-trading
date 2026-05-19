<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { Settings as SettingsIcon } from 'lucide-vue-next';
import { api, type SessionResponse, type SearchItem } from '@/api/client';
import SymbolSearch from '@/components/SymbolSearch.vue';

const router = useRouter();
const session = ref<SessionResponse | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;

async function load() {
  try {
    session.value = await api.session();
  } catch {
    /* silent */
  }
}

const sessionInfo = computed(() => {
  const s = session.value?.session;
  if (s === 'regular') return { label: '장중', dotClass: 'bg-emerald-500', pingClass: 'bg-emerald-400' };
  if (s === 'pre_extended' || s === 'pre_auction') return { label: '장 시작 전', dotClass: 'bg-amber-500', pingClass: '' };
  if (s === 'close_auction' || s === 'post_extended' || s === 'after_single') return { label: '장 마감 후', dotClass: 'bg-amber-500', pingClass: '' };
  if (s === 'closed') return { label: '장 마감', dotClass: 'bg-zinc-400', pingClass: '' };
  if (s === 'holiday') return { label: '휴장', dotClass: 'bg-zinc-400', pingClass: '' };
  return null;
});

function onPick(item: SearchItem) {
  router.push(`/stocks/${item.code}`);
}

onMounted(() => {
  load();
  timer = setInterval(load, 60_000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <header class="sticky top-0 z-20 bg-background/90 backdrop-blur-lg">
    <div class="flex items-center gap-2 px-4 pt-3 pb-2">
      <div class="min-w-0 flex-1">
        <SymbolSearch placeholder="종목명·종목코드로 빠르게 찾기" @pick="onPick" />
      </div>
      <span
        v-if="sessionInfo"
        class="flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground"
      >
        <span class="relative flex h-1.5 w-1.5">
          <span
            v-if="sessionInfo.pingClass"
            class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
            :class="sessionInfo.pingClass"
          />
          <span class="relative inline-flex h-1.5 w-1.5 rounded-full" :class="sessionInfo.dotClass" />
        </span>
        {{ sessionInfo.label }}
      </span>
      <RouterLink
        to="/settings"
        class="-mr-1 rounded-full p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
      >
        <SettingsIcon class="h-5 w-5" />
      </RouterLink>
    </div>
  </header>
</template>
