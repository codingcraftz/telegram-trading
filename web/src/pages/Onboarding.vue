<script setup lang="ts">
// 첫 진입 온보딩 — KIS 모의/실전 키 + 거래 모드만.
// 텔레그램·UI 옵션은 Settings 페이지에서. router 가드가 /api/keys-status 로 키 미입력 감지 시 redirect.
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { TestTube2, Flame, Info, ChevronLeft } from 'lucide-vue-next';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import { toast } from '@/lib/toast';
import { api } from '@/api/client';

const router = useRouter();

// 이미 키가 있는 사용자 (= 설정에서 들어옴) 면 뒤로가기 노출. 첫 셋업이면 숨김.
const hasExistingKeys = ref(false);
onMounted(async () => {
  try {
    const k = await api.keysStatus();
    hasExistingKeys.value = k.paperKeys || k.realKeys || k.realMarketKeys;
  } catch { hasExistingKeys.value = false; }
});

function goBack() {
  if (window.history.length > 1) router.back();
  else router.push('/settings');
}

type Form = {
  KIS_PAPER_APP_KEY: string;
  KIS_PAPER_APP_SECRET: string;
  KIS_PAPER_STOCK: string;
  KIS_APP_KEY: string;
  KIS_APP_SECRET: string;
  KIS_ACCT_STOCK: string;
  MODE: 'paper' | 'real';
};

const form = ref<Form>({
  KIS_PAPER_APP_KEY: '',
  KIS_PAPER_APP_SECRET: '',
  KIS_PAPER_STOCK: '',
  KIS_APP_KEY: '',
  KIS_APP_SECRET: '',
  KIS_ACCT_STOCK: '',
  MODE: 'paper',
});
const submitting = ref(false);
const restarting = ref(false);

const paperFilled = computed(
  () => form.value.KIS_PAPER_APP_KEY && form.value.KIS_PAPER_APP_SECRET && form.value.KIS_PAPER_STOCK,
);
const realFilled = computed(
  () => form.value.KIS_APP_KEY && form.value.KIS_APP_SECRET && form.value.KIS_ACCT_STOCK,
);
const canSubmit = computed(
  () => !submitting.value && (!!paperFilled.value || !!realFilled.value),
);

async function submit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  try {
    // 거래 모드 (MODE) 는 이 페이지에서 안 다룸 — 설정 페이지의 매매 모드 전환에서.
    // 빈 값 필드는 제외해서 .env 의 기존 값을 보존.
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(form.value)) {
      if (k === 'MODE') continue;
      if (typeof v === 'string' && v.trim()) payload[k] = v;
    }
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const t = await res.text();
      toast.error('저장 실패: ' + t.slice(0, 100));
      submitting.value = false;
      return;
    }
    // 봇이 1초 후 process.exit(0) → docker 재시작 (10~30초). 폴링으로 부활 감지.
    restarting.value = true;
    toast.success('저장됨. 봇 재시작 중…');
    pollRestart();
  } catch (err) {
    toast.error((err as Error).message);
    submitting.value = false;
  }
}

async function pollRestart() {
  const start = Date.now();
  const TIMEOUT = 60_000;
  const INTERVAL = 2_000;
  while (Date.now() - start < TIMEOUT) {
    await new Promise((r) => setTimeout(r, INTERVAL));
    try {
      const res = await fetch('/api/keys-status', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as { paperKeys: boolean; realKeys: boolean };
        if (data.paperKeys || data.realKeys) {
          // sessionStorage 캐시 무효화 → 가드가 다시 keys-status 호출
          try { sessionStorage.removeItem('owlim:keys-cached'); } catch {}
          router.replace('/');
          return;
        }
      }
    } catch {
      // 재시작 중. 계속 폴링.
    }
  }
  toast.error('재시작 시간 초과 — 페이지를 새로고침해주세요');
  restarting.value = false;
  submitting.value = false;
}

// 신규 진입 — 빈 폼. 재설정도 동일하게 다시 입력 (보안: 키 평문 반환 X).
</script>

<template>
  <div class="mx-auto max-w-xl space-y-4 p-4 pb-28">
    <!-- 뒤로가기 — 이미 키 있는 사용자(설정에서 들어옴) 만 노출. 첫 셋업엔 숨김. -->
    <div class="flex items-center gap-2">
      <button
        v-if="hasExistingKeys"
        class="-ml-2 rounded-md p-2 text-muted-foreground transition hover:bg-accent"
        aria-label="뒤로가기"
        @click="goBack"
      >
        <ChevronLeft class="h-5 w-5" />
      </button>
      <div class="flex-1">
        <h1 class="text-xl font-bold tracking-tight">
          {{ hasExistingKeys ? 'KIS 키 / 계좌' : '처음 설정' }}
        </h1>
        <p v-if="!hasExistingKeys" class="mt-1 text-[12px] text-muted-foreground">
          한국투자증권(KIS) API 키를 입력하면 매매가 활성화돼요. <b>모의</b> 또는 <b>실전</b> 중 하나만 입력해도 시작 가능합니다.
        </p>
      </div>
    </div>

    <!-- 모의투자 -->
    <Card>
      <template #header>
        <div class="flex items-center gap-2">
          <TestTube2 class="h-4 w-4 text-primary" />
          <h2 class="text-sm font-bold tracking-tight">KIS 모의투자</h2>
        </div>
      </template>
      <p class="-mt-1 mb-3 text-[11px] leading-relaxed text-muted-foreground">
        실제 현금 거래 X. KIS 모의 계좌(시드 1억 자동 지급)로 안전하게 테스트.
        <a href="https://apiportal.koreainvestment.com" target="_blank" rel="noreferrer" class="text-primary underline">KIS 개발자센터</a>
        에서 발급.
      </p>
      <div class="space-y-2.5">
        <label class="block">
          <span class="text-[11px] font-semibold text-muted-foreground">APP_KEY</span>
          <input
            v-model="form.KIS_PAPER_APP_KEY"
            type="password"
            placeholder="발급받은 APP_KEY"
            class="mt-1 w-full rounded-lg bg-muted/40 px-3 py-2 font-mono text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <label class="block">
          <span class="text-[11px] font-semibold text-muted-foreground">APP_SECRET</span>
          <input
            v-model="form.KIS_PAPER_APP_SECRET"
            type="password"
            placeholder="발급받은 APP_SECRET"
            class="mt-1 w-full rounded-lg bg-muted/40 px-3 py-2 font-mono text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <label class="block">
          <span class="text-[11px] font-semibold text-muted-foreground">모의 종합계좌</span>
          <input
            v-model="form.KIS_PAPER_STOCK"
            type="text"
            placeholder="50012345-01"
            class="mt-1 w-full rounded-lg bg-muted/40 px-3 py-2 font-mono text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <p class="mt-1 text-[10px] text-muted-foreground">전체(<code>50012345-01</code>) 또는 앞 8자리 둘 다 OK.</p>
        </label>
      </div>
    </Card>

    <!-- 실전 -->
    <Card>
      <template #header>
        <div class="flex items-center gap-2">
          <Flame class="h-4 w-4 text-down" />
          <h2 class="text-sm font-bold tracking-tight">KIS 실전</h2>
        </div>
      </template>
      <p class="-mt-1 mb-3 text-[11px] leading-relaxed text-muted-foreground">
        ⚠️ 실제 자금 거래. <b>거래 모드</b>를 [실전]으로 바꿔야 활성화됩니다.
        출금 권한 없는 키만 사용하세요.
      </p>
      <div class="space-y-2.5">
        <label class="block">
          <span class="text-[11px] font-semibold text-muted-foreground">APP_KEY</span>
          <input
            v-model="form.KIS_APP_KEY"
            type="password"
            placeholder="발급받은 APP_KEY"
            class="mt-1 w-full rounded-lg bg-muted/40 px-3 py-2 font-mono text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <label class="block">
          <span class="text-[11px] font-semibold text-muted-foreground">APP_SECRET</span>
          <input
            v-model="form.KIS_APP_SECRET"
            type="password"
            placeholder="발급받은 APP_SECRET"
            class="mt-1 w-full rounded-lg bg-muted/40 px-3 py-2 font-mono text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <label class="block">
          <span class="text-[11px] font-semibold text-muted-foreground">실전 종합계좌</span>
          <input
            v-model="form.KIS_ACCT_STOCK"
            type="text"
            placeholder="12345678-01"
            class="mt-1 w-full rounded-lg bg-muted/40 px-3 py-2 font-mono text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <p class="mt-1 text-[10px] text-muted-foreground">선물옵션(<code>-22</code>)처럼 상품 코드가 다르면 전체 입력 필수.</p>
        </label>
      </div>
    </Card>

    <!-- 거래 모드 카드 — 이 페이지에선 제거. 매매 모드 전환은 설정 → 연결 상태에서. -->


    <div class="flex items-start gap-2 rounded-xl bg-muted/40 px-3 py-2.5 text-[11px] text-muted-foreground">
      <Info class="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        텔레그램 알림(체결 알림용) 같은 추가 설정은 매매 시작 후 <b class="text-foreground">설정</b> 페이지에서 자유롭게 입력하세요.
      </span>
    </div>

    <div v-if="restarting" class="rounded-xl bg-primary/10 px-3 py-3 text-center text-sm">
      <p class="font-semibold">⏳ 봇 재시작 중…</p>
      <p class="mt-1 text-[11px] text-muted-foreground">10~30초 안에 자동으로 매매 화면으로 이동합니다.</p>
    </div>

    <div class="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-background/95 p-4 backdrop-blur">
      <div class="mx-auto max-w-xl">
        <Button variant="primary" size="lg" class="w-full" :disabled="!canSubmit" @click="submit">
          {{ submitting ? '저장 중…' : '저장하고 시작하기' }}
        </Button>
      </div>
    </div>
  </div>
</template>
