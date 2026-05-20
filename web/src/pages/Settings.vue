<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { CircleCheck, CircleX, Info, ExternalLink, Smartphone, Sparkles, Plus, ChevronRight, KeyRound, Bell, Download, X } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import { api } from '@/api/client';
import { usePrefs, type Mode, type Theme } from '@/stores/prefs';
import { toast } from '@/lib/toast';
import { usePwaInstall } from '@/composables/usePwaInstall';

const router = useRouter();
const pwa = usePwaInstall();

async function onInstallClick() {
  const outcome = await pwa.install();
  if (outcome === 'accepted') toast.success('앱이 설치됐어요');
  else if (outcome === 'dismissed') toast.info('설치를 건너뛰었어요');
}

const prefs = usePrefs();

const version = ref<{ sha: string; buildDate: string } | null>(null);
const keys = ref<{
  tradingMode: 'paper' | 'real';
  paperKeys: boolean;
  realKeys: boolean;
  realMarketKeys: boolean;
  marketDataMode: 'demo' | 'real';
  notice: string;
} | null>(null);

const strategyCount = ref<number>(0);

// 텔레그램 알림 설정 — POST /api/settings 재사용
const telegram = ref({ TELEGRAM_BOT_TOKEN: '', ALLOWED_CHAT_IDS: '' });
const savingTelegram = ref(false);

async function saveTelegram() {
  savingTelegram.value = true;
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        TELEGRAM_BOT_TOKEN: telegram.value.TELEGRAM_BOT_TOKEN,
        ALLOWED_CHAT_IDS: telegram.value.ALLOWED_CHAT_IDS,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    toast.success('저장됨. 봇 재시작 중…');
    telegram.value = { TELEGRAM_BOT_TOKEN: '', ALLOWED_CHAT_IDS: '' };
  } catch (err) {
    toast.error((err as Error).message);
  } finally { savingTelegram.value = false; }
}

function gotoOnboarding() {
  try { sessionStorage.removeItem('owlim:keys-cached'); } catch {}
  router.push('/onboarding');
}

async function loadAll() {
  try {
    const [v, k, list] = await Promise.all([
      api.version(),
      api.keysStatus(),
      api.strategies().catch(() => ({ items: [] })),
    ]);
    version.value = v;
    keys.value = k;
    strategyCount.value = list.items.length;
  } catch (err) {
    console.warn(err);
  }
}

const buildDate = computed(() => version.value?.buildDate ? version.value.buildDate.slice(0, 10) : '');

// 한국투자증권 앱 — 입출금 같은 KIS API 미지원 기능은 본 앱에서.
const KIS_APP = {
  ios: 'https://apps.apple.com/kr/app/id1621986905',
  android: 'https://play.google.com/store/apps/details?id=com.truefriend.neosmartarenewal',
};
function openKisApp() {
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const url = isAndroid ? KIS_APP.android : KIS_APP.ios;
  window.open(url, '_blank', 'noopener');
}

onMounted(loadAll);
</script>

<template>
  <div class="space-y-4">
    <div class="px-1">
      <h2 class="text-lg font-bold tracking-tight">설정</h2>
    </div>

    <!-- PWA 앱 설치 — canShowInstallButton 일 때만 -->
    <Card v-if="pwa.canShowInstallButton.value">
      <template #header>
        <div class="flex items-center gap-2">
          <Download class="h-4 w-4 text-primary" />
          <h3 class="text-sm font-bold tracking-tight">📲 홈 화면에 앱으로 설치</h3>
        </div>
      </template>
      <p class="-mt-1 mb-3 text-[11px] leading-relaxed text-muted-foreground">
        홈 화면에 추가하면 브라우저 주소창 없이 전체 화면으로 빠르게 열 수 있어요.
      </p>
      <Button variant="primary" size="md" class="w-full" @click="onInstallClick">
        앱 설치하기
      </Button>
    </Card>

    <!-- iOS Safari 수동 안내 모달 -->
    <div
      v-if="pwa.iosManualOpen.value"
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      @click.self="pwa.iosManualOpen.value = false"
    >
      <div class="w-full max-w-sm rounded-t-2xl bg-card p-5 shadow-xl sm:rounded-2xl">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="text-base font-bold">📲 iOS에서 앱 설치</h3>
          <button class="rounded-md p-1 text-muted-foreground transition hover:bg-accent" @click="pwa.iosManualOpen.value = false">
            <X class="h-4 w-4" />
          </button>
        </div>
        <ol class="space-y-2 text-sm leading-relaxed">
          <li>1️⃣ 사파리 하단 <b>공유 버튼</b> (□↑) 을 눌러요</li>
          <li>2️⃣ 메뉴 아래로 내려서 <b>"홈 화면에 추가"</b>를 탭</li>
          <li>3️⃣ 우측 상단 <b>"추가"</b>를 누르면 끝</li>
        </ol>
        <p class="mt-3 text-[11px] text-muted-foreground">
          홈 화면 아이콘에서 열면 주소창 없이 전체 화면으로 보입니다.
        </p>
      </div>
    </div>

    <!-- 모드 & 색상 -->
    <Card>
      <template #header>
        <h3 class="text-sm font-bold tracking-tight">기본 설정</h3>
      </template>
      <div class="space-y-4">
        <div>
          <p class="mb-2 text-[11px] font-medium text-muted-foreground">사용 모드</p>
          <SegmentedControl
            :model-value="prefs.mode"
            :options="[
              { value: 'easy' as Mode, label: '쉬운 모드' },
              { value: 'advanced' as Mode, label: '고급 모드' },
            ]"
            @update:model-value="(v) => (prefs.mode = v)"
          />
          <p class="mt-1.5 text-[11px] text-muted-foreground">
            {{ prefs.mode === 'easy' ? '낯선 용어 옆에 작은 도움말이 함께 떠요.' : '도움말을 숨기고 화면을 간결하게 보여드려요.' }}
          </p>
        </div>
        <div>
          <p class="mb-2 text-[11px] font-medium text-muted-foreground">화면 색</p>
          <SegmentedControl
            :model-value="prefs.theme"
            :options="[
              { value: 'light' as Theme, label: '밝게' },
              { value: 'dark' as Theme, label: '어둡게' },
              { value: 'system' as Theme, label: '자동' },
            ]"
            @update:model-value="(v) => (prefs.theme = v)"
          />
        </div>
      </div>
    </Card>

    <!-- 전략 관리 -->
    <Card>
      <template #header>
        <h3 class="text-sm font-bold tracking-tight">전략 관리</h3>
      </template>
      <div class="-mx-1 divide-y divide-border">
        <RouterLink
          to="/more/strategy"
          class="flex items-center gap-3 px-1 py-2.5 transition hover:bg-accent rounded-md"
        >
          <Sparkles class="h-4 w-4 text-primary" />
          <span class="flex-1 text-sm font-medium">내 전략</span>
          <span class="text-[11px] text-muted-foreground tabular-nums">{{ strategyCount }}개</span>
          <ChevronRight class="h-4 w-4 text-muted-foreground" />
        </RouterLink>
        <RouterLink
          to="/more/strategy/new"
          class="flex items-center gap-3 px-1 py-2.5 transition hover:bg-accent rounded-md"
        >
          <Plus class="h-4 w-4 text-primary" />
          <span class="flex-1 text-sm font-medium">새 전략 만들기</span>
          <ChevronRight class="h-4 w-4 text-muted-foreground" />
        </RouterLink>
      </div>
    </Card>

    <!-- 연결 상태 -->
    <Card v-if="keys">
      <template #header>
        <h3 class="text-sm font-bold tracking-tight">연결 상태</h3>
      </template>
      <ul class="space-y-2 text-sm">
        <li class="flex items-center justify-between">
          <span class="text-muted-foreground">시세 / 차트</span>
          <span class="flex items-center gap-1 font-semibold" :class="keys.realMarketKeys ? 'text-up' : 'text-destructive'">
            <CircleCheck v-if="keys.realMarketKeys" class="h-4 w-4" />
            <CircleX v-else class="h-4 w-4" />
            {{ keys.realMarketKeys ? '연결됨' : '사용 불가' }}
          </span>
        </li>
        <li class="flex items-center justify-between">
          <span class="text-muted-foreground">매매</span>
          <span class="font-semibold">{{ keys.tradingMode === 'real' ? '실전' : '모의 모드' }}</span>
        </li>
      </ul>
      <div class="mt-3 flex items-start gap-2 rounded-xl bg-muted/40 px-3 py-2.5 text-[11px] text-muted-foreground">
        <Info class="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{{ keys.notice }}</span>
      </div>
      <button
        class="-mx-1 mt-3 flex w-full items-center gap-2 rounded-lg bg-muted/40 px-3 py-2.5 text-sm transition hover:bg-muted"
        @click="gotoOnboarding"
      >
        <KeyRound class="h-4 w-4 text-primary" />
        <span class="flex-1 text-left font-medium">KIS 키 / 모드 다시 입력</span>
        <ChevronRight class="h-4 w-4 text-muted-foreground" />
      </button>
    </Card>

    <!-- 텔레그램 알림 -->
    <Card>
      <template #header>
        <div class="flex items-center gap-2">
          <Bell class="h-4 w-4 text-primary" />
          <h3 class="text-sm font-bold tracking-tight">텔레그램 알림 <span class="ml-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">선택</span></h3>
        </div>
      </template>
      <p class="-mt-1 mb-3 text-[11px] leading-relaxed text-muted-foreground">
        매수 체결 / 매도 체결 시에만 알림이 발송돼요. 매매 자체는 텔레그램에서 안 되고 이 앱에서만 가능합니다.
        비워두면 알림 없이 동작.
      </p>
      <div class="space-y-2.5">
        <label class="block">
          <span class="text-[11px] font-semibold text-muted-foreground">봇 토큰</span>
          <input
            v-model="telegram.TELEGRAM_BOT_TOKEN"
            type="password"
            placeholder="1234567890:ABC..."
            class="mt-1 w-full rounded-lg bg-muted/40 px-3 py-2 font-mono text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span class="mt-1 block text-[10px] text-muted-foreground">@BotFather → /newbot 로 발급.</span>
        </label>
        <label class="block">
          <span class="text-[11px] font-semibold text-muted-foreground">알림 받을 chat_id</span>
          <input
            v-model="telegram.ALLOWED_CHAT_IDS"
            type="text"
            placeholder="12345678"
            class="mt-1 w-full rounded-lg bg-muted/40 px-3 py-2 font-mono text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span class="mt-1 block text-[10px] text-muted-foreground">@userinfobot → /start 로 본인 ID 확인. 콤마로 여러 명 등록 가능.</span>
        </label>
        <Button variant="secondary" size="sm" class="w-full" :disabled="savingTelegram" @click="saveTelegram">
          {{ savingTelegram ? '저장 중…' : '저장하고 봇 재시작' }}
        </Button>
      </div>
    </Card>


    <!-- 한국투자증권 앱 연결 -->
    <Card>
      <template #header>
        <h3 class="text-sm font-bold tracking-tight">한국투자증권 앱</h3>
      </template>
      <button
        class="-mx-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-accent"
        @click="openKisApp"
      >
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
          <Smartphone class="h-5 w-5 text-muted-foreground" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold">앱 열기</p>
          <p class="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            입출금·계좌이체 같은 기능은 한국투자증권 공식 앱에서 처리해요.
          </p>
        </div>
        <ExternalLink class="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    </Card>

    <p class="px-1 text-[11px] text-muted-foreground tabular-nums">
      <span v-if="version" class="font-mono">버전 {{ version.sha }}</span>
      <span v-if="buildDate" class="ml-1.5">· {{ buildDate }}</span>
    </p>
  </div>
</template>
