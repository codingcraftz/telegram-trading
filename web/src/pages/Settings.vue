<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { CircleCheck, CircleX, Info, ExternalLink, Smartphone, NotebookPen, Plus, ChevronRight, KeyRound, Bell, Download, X, RefreshCw, Rocket } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import BottomSheet from '@/components/ui/BottomSheet.vue';
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

const version = ref<{ version: string; sha: string; buildDate: string } | null>(null);
const keys = ref<{
  tradingMode: 'paper' | 'real';
  paperKeys: boolean;
  realKeys: boolean;
  realMarketKeys: boolean;
  marketDataMode: 'demo' | 'real';
  notice: string;
} | null>(null);

const strategyCount = ref<number>(0);

// 텔레그램 알림 설정 — POST /api/settings 재사용. 시트로 분리.
const telegram = ref({ TELEGRAM_BOT_TOKEN: '', ALLOWED_CHAT_IDS: '' });
const savingTelegram = ref(false);
const telegramSheetOpen = ref(false);

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

// 매매 모드 전환 — 즉시 적용.
const modeSwitching = ref(false);
async function switchTradingMode(next: 'paper' | 'real') {
  if (!keys.value || modeSwitching.value || keys.value.tradingMode === next) return;
  if (next === 'real' && !keys.value.realKeys) {
    toast.error('실전 키/계좌가 연결돼 있어야 실전 모드로 전환 가능합니다.');
    return;
  }
  modeSwitching.value = true;
  try {
    await api.setTradingMode(next);
    // 새 모드 상태 반영 위해 keys 다시 fetch
    keys.value = await api.keysStatus();
    toast.success(`${next === 'real' ? '실전' : '모의'} 모드로 전환됐어요`);
  } catch (err) {
    toast.error((err as Error).message);
  } finally { modeSwitching.value = false; }
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

// ===== 업데이트 =====
const updateInfo = ref<{
  current: string;
  latest: string;
  latestMessage: string;
  updateAvailable: boolean;
} | null>(null);
const updateChecking = ref(false);
const updateCheckedAt = ref<number | null>(null);

// 업데이트 phase — 풀스크린 오버레이 상태 관리.
//   'idle'        : 진행 없음 (오버레이 hidden)
//   'requesting'  : sentinel 파일 만드는 중
//   'building'    : 호스트가 새 이미지 받는 중 (polling sha)
//   'done'        : sha 변경 감지 — 사용자가 앱 끄고 다시 켜야 함
//   'failed'      : 일정 시간 안에 변경 감지 못함 또는 에러
const updatePhase = ref<'idle' | 'requesting' | 'building' | 'done' | 'failed'>('idle');
const updateError = ref<string>('');
let updatePollTimer: ReturnType<typeof setInterval> | null = null;
let updateTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

async function checkForUpdate(silent = false) {
  updateChecking.value = true;
  try {
    const r = await api.checkUpdate();
    updateInfo.value = r;
    updateCheckedAt.value = Date.now();
    if (!silent) {
      if (r.updateAvailable) toast.success(`새 버전이 있어요 (${r.latestMessage})`);
      else toast.info('최신 버전이에요');
    }
  } catch (err) {
    if (!silent) toast.error((err as Error).message);
  } finally { updateChecking.value = false; }
}

function stopUpdateTimers() {
  if (updatePollTimer) { clearInterval(updatePollTimer); updatePollTimer = null; }
  if (updateTimeoutTimer) { clearTimeout(updateTimeoutTimer); updateTimeoutTimer = null; }
}

function closeUpdateOverlay() {
  stopUpdateTimers();
  updatePhase.value = 'idle';
  updateError.value = '';
}

async function runUpdate() {
  if (updatePhase.value !== 'idle') return;
  updateError.value = '';
  updatePhase.value = 'requesting';
  try {
    const r = await api.triggerUpdate();
    if (!r.ok) {
      updateError.value = r.message || '업데이트 요청 실패';
      updatePhase.value = 'failed';
      return;
    }
    // 요청 성공 — 봇 컨테이너가 곧 재시작. 현재 sha 기억 후 변경 감지까지 폴링.
    updatePhase.value = 'building';
    const startSha = version.value?.sha ?? null;
    updatePollTimer = setInterval(async () => {
      try {
        const v = await api.version();
        if (startSha && v.sha !== startSha) {
          stopUpdateTimers();
          updatePhase.value = 'done';
          // 3초 후 자동 reload — 사용자가 안내 메시지 읽을 시간.
          setTimeout(() => {
            try { location.reload(); } catch {}
          }, 3000);
        }
      } catch { /* 컨테이너 재시작 중엔 일시 unreachable — 다음 폴링에서 다시 */ }
    }, 3000);
    // 5분 timeout — 그동안 변경 감지 못 하면 failed (사용자가 직접 확인 권유).
    updateTimeoutTimer = setTimeout(() => {
      if (updatePhase.value === 'building') {
        stopUpdateTimers();
        updateError.value = '업데이트 확인 시간이 초과됐어요. 잠시 후 앱을 끄고 다시 열어보세요.';
        updatePhase.value = 'failed';
      }
    }, 5 * 60 * 1000);
  } catch (err) {
    updateError.value = (err as Error).message;
    updatePhase.value = 'failed';
  }
}

const updateCheckedLabel = computed(() => {
  if (!updateCheckedAt.value) return '';
  const diff = Math.max(0, Date.now() - updateCheckedAt.value);
  const m = Math.floor(diff / 60_000);
  if (m === 0) return '방금 확인';
  if (m < 60) return `${m}분 전 확인`;
  return new Date(updateCheckedAt.value).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
});

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

onMounted(() => {
  loadAll();
  // 진입 시 백그라운드로 업데이트 확인 (silent — 토스트 없음, 결과만 카드에 표시)
  checkForUpdate(true);
});
onUnmounted(() => {
  stopUpdateTimers();
});
</script>

<template>
  <div class="space-y-4">
    <div class="px-1">
      <h2 class="text-lg font-bold tracking-tight">설정</h2>
    </div>

    <!-- 버전 정보 — 한 줄 row (최상단). 새 버전 있으면 우측 업데이트 버튼 활성. -->
    <Card class="!py-2.5 !px-3">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0 flex items-baseline gap-2">
          <span class="text-[10px] text-muted-foreground">버전</span>
          <span class="text-sm font-bold tabular-nums">v{{ version?.version ?? '—' }}</span>
          <span v-if="updateInfo?.updateAvailable" class="text-[10px] font-semibold text-primary">
            · 새 버전 ({{ updateInfo.latestMessage || '업데이트' }})
          </span>
        </div>
        <div class="flex items-center gap-1.5">
          <button
            class="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent disabled:opacity-40"
            :disabled="updateChecking"
            aria-label="업데이트 확인"
            @click="checkForUpdate(false)"
          >
            <RefreshCw class="h-3.5 w-3.5" :class="updateChecking ? 'animate-spin' : ''" />
          </button>
          <button
            v-if="updateInfo?.updateAvailable"
            class="rounded-md bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground transition disabled:opacity-40"
            :disabled="updatePhase !== 'idle'"
            @click="runUpdate"
          >
            업데이트
          </button>
        </div>
      </div>
    </Card>

    <!-- PWA 앱 설치 — canShowInstallButton 일 때만 -->
    <!-- PWA 설치 카드 — 사용자 요청으로 제거 (iOS 수동 안내 모달은 PWA prompt 처리 위해 유지). -->

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

    <!-- 화면 색 — 밝게/어둡게/자동 -->
    <Card>
      <template #header>
        <h3 class="text-sm font-bold tracking-tight">화면 색</h3>
      </template>
      <SegmentedControl
        :model-value="prefs.theme"
        :options="[
          { value: 'light' as Theme, label: '밝게' },
          { value: 'dark' as Theme, label: '어둡게' },
          { value: 'system' as Theme, label: '자동' },
        ]"
        @update:model-value="(v) => (prefs.theme = v)"
      />
    </Card>

    <!-- 내 전략 — 단일 메뉴 항목. 추가/편집/삭제는 내 전략 페이지 안에서. -->
    <Card>
      <RouterLink
        to="/more/strategy"
        class="-mx-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-accent"
      >
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
          <NotebookPen class="h-5 w-5 text-primary" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold">내 전략</p>
          <p class="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {{ strategyCount > 0 ? `${strategyCount}개 저장됨 — 활성/편집/추가` : '전략 만들기' }}
          </p>
        </div>
        <ChevronRight class="h-4 w-4 shrink-0 text-muted-foreground" />
      </RouterLink>
    </Card>

    <!-- 연결 상태 — 모의/실전 키 연결 유무. KIS 키 입력은 별도 카드로 분리. -->
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
          <span class="text-muted-foreground">모의투자 키</span>
          <span class="flex items-center gap-1 font-semibold" :class="keys.paperKeys ? 'text-up' : 'text-muted-foreground'">
            <CircleCheck v-if="keys.paperKeys" class="h-4 w-4" />
            <CircleX v-else class="h-4 w-4" />
            {{ keys.paperKeys ? '연결됨' : '없음' }}
          </span>
        </li>
        <li class="flex items-center justify-between">
          <span class="text-muted-foreground">실전투자 키</span>
          <span class="flex items-center gap-1 font-semibold" :class="keys.realKeys ? 'text-up' : 'text-muted-foreground'">
            <CircleCheck v-if="keys.realKeys" class="h-4 w-4" />
            <CircleX v-else class="h-4 w-4" />
            {{ keys.realKeys ? '연결됨' : '없음' }}
          </span>
        </li>
      </ul>

      <!-- 매매 모드 전환 — 봇 재시작 없이 즉시 적용 -->
      <div class="mt-3 border-t border-border/60 pt-3">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-[11px] font-medium text-muted-foreground">매매 모드</span>
          <span v-if="modeSwitching" class="text-[10px] text-muted-foreground">전환 중…</span>
        </div>
        <SegmentedControl
          :model-value="keys.tradingMode"
          :options="[
            { value: 'paper' as const, label: '모의' },
            { value: 'real' as const, label: '실전' },
          ]"
          @update:model-value="(v) => switchTradingMode(v)"
        />
        <p class="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
          전환 즉시 다음 주문부터 적용됩니다. 진행 중인 주문은 영향 없음.
        </p>
      </div>
    </Card>

    <!-- 텔레그램 알림 — 메뉴 항목. 클릭 시 시트로 설명 + 입력. -->
    <Card>
      <button
        class="-mx-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-accent"
        @click="telegramSheetOpen = true"
      >
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
          <Bell class="h-5 w-5 text-primary" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold">텔레그램 알림 설정</p>
          <p class="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            매수/매도 체결 시 텔레그램으로 알림 받기 (선택)
          </p>
        </div>
        <ChevronRight class="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    </Card>

    <!-- KIS 키 다시 입력 — 별도 메뉴 항목. -->
    <Card>
      <button
        class="-mx-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-accent"
        @click="gotoOnboarding"
      >
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
          <KeyRound class="h-5 w-5 text-primary" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold">KIS 키 다시 입력</p>
          <p class="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            한국투자증권 API key·계좌·모드 변경
          </p>
        </div>
        <ChevronRight class="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
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

    <!-- 업데이트 진행 풀스크린 오버레이 — phase 별 분기 -->
    <div
      v-if="updatePhase !== 'idle'"
      class="fixed inset-0 z-[300] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
    >
      <div class="w-full max-w-sm rounded-2xl bg-card p-6 text-center shadow-xl">
        <!-- requesting / building : 로딩 -->
        <template v-if="updatePhase === 'requesting' || updatePhase === 'building'">
          <div class="mx-auto mb-4 h-12 w-12 rounded-full border-4 border-primary/30 border-t-primary animate-spin" />
          <p class="text-base font-bold">
            {{ updatePhase === 'requesting' ? '업데이트 요청 중…' : '업데이트 다운로드 중…' }}
          </p>
          <p class="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            보통 1~3분 정도 걸려요. 이 화면을 닫지 말고 잠시 기다려주세요.
          </p>
        </template>

        <!-- done : 완료 — 자동 reload 안내 -->
        <template v-else-if="updatePhase === 'done'">
          <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-3xl">
            ✅
          </div>
          <p class="text-base font-bold text-emerald-500">업데이트 완료</p>
          <p class="mt-2 text-[13px] leading-relaxed">
            잠시 후 새로고침할게요.
          </p>
        </template>

        <!-- failed : 에러 안내 -->
        <template v-else-if="updatePhase === 'failed'">
          <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/15 text-3xl">
            ⚠️
          </div>
          <p class="text-base font-bold">업데이트 진행 확인 안 됨</p>
          <p class="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            {{ updateError || '잠시 후 다시 시도해주세요.' }}
          </p>
          <button
            class="mt-4 w-full rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground"
            @click="closeUpdateOverlay"
          >닫기</button>
        </template>
      </div>
    </div>

    <!-- 텔레그램 알림 시트 -->
    <BottomSheet :open="telegramSheetOpen" title="텔레그램 알림 설정" @close="telegramSheetOpen = false">
      <div class="space-y-4">
        <p class="text-[12px] leading-relaxed text-muted-foreground">
          매수/매도 <b class="text-foreground">체결</b> 시 텔레그램으로 알림을 보내드려요.
          매매 자체는 텔레그램이 아니라 이 앱에서만 가능합니다. 비워두면 알림 없이 동작.
        </p>

        <!-- 단계 안내 -->
        <ol class="space-y-2 text-[12px] leading-relaxed">
          <li class="flex gap-2">
            <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">1</span>
            <span>
              텔레그램에서 <b>@BotFather</b> 를 검색해 대화 시작 →
              <code class="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">/newbot</code> 입력 → 봇 이름 정하면
              <b>봇 토큰</b>이 발급돼요.
            </span>
          </li>
          <li class="flex gap-2">
            <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">2</span>
            <span>
              <b>@userinfobot</b> 을 검색해 <code class="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">/start</code> →
              본인 chat ID 가 나와요. 여러 명한테 알림 받으려면 쉼표로 이어 쓰기.
            </span>
          </li>
          <li class="flex gap-2">
            <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">3</span>
            <span>위에서 받은 두 값을 아래에 입력하고 <b>저장</b>.</span>
          </li>
        </ol>

        <div class="space-y-2.5 border-t border-border/60 pt-4">
          <label class="block">
            <span class="text-[11px] font-semibold text-muted-foreground">봇 토큰</span>
            <input
              v-model="telegram.TELEGRAM_BOT_TOKEN"
              type="password"
              placeholder="8123456789:AAEx_abcDEFghIJKL..."
              class="mt-1 w-full rounded-lg bg-muted/40 px-3 py-2 font-mono text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
          <label class="block">
            <span class="text-[11px] font-semibold text-muted-foreground">알림 받을 chat ID</span>
            <input
              v-model="telegram.ALLOWED_CHAT_IDS"
              type="text"
              placeholder="987654321"
              class="mt-1 w-full rounded-lg bg-muted/40 px-3 py-2 font-mono text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span class="mt-1 block text-[10px] text-muted-foreground">여러 명일 땐 쉼표로 — 예: 987654321,123456789</span>
          </label>
          <Button
            variant="primary"
            size="md"
            class="w-full"
            :disabled="savingTelegram"
            @click="saveTelegram"
          >
            {{ savingTelegram ? '저장 중…' : '저장하고 봇 재시작' }}
          </Button>
        </div>
      </div>
    </BottomSheet>
  </div>
</template>
