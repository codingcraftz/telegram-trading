// PWA 설치 prompt 처리.
// - Chrome/Edge: beforeinstallprompt 이벤트가 index.html 에서 window.__pwaPrompt 로 보존됨.
//   install() 호출하면 native install dialog 표시.
// - iOS Safari: beforeinstallprompt 미지원 → "공유 → 홈 화면에 추가" 안내 모달.
// - 이미 설치된 standalone 모드면 버튼 자체 숨김.

import { ref, onMounted, onUnmounted, computed } from 'vue';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface Window {
    __pwaPrompt: BeforeInstallPromptEvent | null;
  }
}

export function usePwaInstall() {
  const installable = ref(!!window.__pwaPrompt);
  const installed = ref(false);
  const iosManualOpen = ref(false);

  // 이미 standalone 으로 띄워졌는지 (이미 설치된 PWA)
  const isStandalone = computed(() => {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
    // iOS Safari 는 navigator.standalone
    return !!(navigator as Navigator & { standalone?: boolean }).standalone;
  });

  // iOS Safari 감지 — UA + Apple platform + Safari 본체.
  const isIOSSafari = computed(() => {
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Mac/.test(ua) && 'ontouchend' in document);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    return isIOS && isSafari;
  });

  // 설치 가능 (Chrome 계열 자동 prompt 가능 OR iOS Safari 수동 안내 가능). 이미 설치된 경우는 숨김.
  const canShowInstallButton = computed(() => {
    if (isStandalone.value || installed.value) return false;
    return installable.value || isIOSSafari.value;
  });

  function onInstallable() { installable.value = true; }
  function onInstalled() {
    installable.value = false;
    installed.value = true;
  }

  onMounted(() => {
    window.addEventListener('owlim:pwa-installable', onInstallable);
    window.addEventListener('owlim:pwa-installed', onInstalled);
  });
  onUnmounted(() => {
    window.removeEventListener('owlim:pwa-installable', onInstallable);
    window.removeEventListener('owlim:pwa-installed', onInstalled);
  });

  async function install(): Promise<'accepted' | 'dismissed' | 'ios-manual' | 'unavailable'> {
    // iOS Safari 는 자동 prompt 없음 → 안내 모달 표시 신호
    if (isIOSSafari.value && !window.__pwaPrompt) {
      iosManualOpen.value = true;
      return 'ios-manual';
    }
    const evt = window.__pwaPrompt;
    if (!evt) return 'unavailable';
    try {
      await evt.prompt();
      const choice = await evt.userChoice;
      // prompt 는 한 번만 사용 가능 — 결과와 무관하게 제거
      window.__pwaPrompt = null;
      installable.value = false;
      return choice.outcome;
    } catch {
      return 'unavailable';
    }
  }

  return {
    canShowInstallButton,
    isIOSSafari,
    isStandalone,
    iosManualOpen,
    install,
  };
}
