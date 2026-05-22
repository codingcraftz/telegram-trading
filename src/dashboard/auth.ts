// 대시보드 PIN 로그인 / 세션 — Caddy basic_auth 대체.
// PIN 6자리는 bcrypt 로 저장(DASHBOARD_PIN_HASH), 세션 토큰은 HMAC-SHA256 으로 서명.
// 세션 쿠키는 Max-Age 미설정 → 브라우저 창 닫으면 만료.

import bcrypt from 'bcryptjs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'owlim_session';

export function authEnabled(): boolean {
  return !!process.env.DASHBOARD_PIN_HASH && !!process.env.DASHBOARD_SESSION_SECRET;
}

export async function verifyPin(pin: string): Promise<boolean> {
  const hash = process.env.DASHBOARD_PIN_HASH;
  if (!hash) return false;
  if (!/^\d{6}$/.test(pin)) return false;
  try {
    return await bcrypt.compare(pin, hash);
  } catch {
    return false;
  }
}

// 토큰 형식: <issuedAtMs>.<random16hex>.<sig>
// sig = HMAC-SHA256(secret, "<issuedAtMs>.<random16hex>") 의 hex.
// payload 자체로는 무상태 — 서버 측 세션 저장소 불필요.
export function issueSession(): string {
  const secret = process.env.DASHBOARD_SESSION_SECRET;
  if (!secret) throw new Error('DASHBOARD_SESSION_SECRET unset');
  const issuedAt = Date.now().toString();
  const nonce = randomBytes(16).toString('hex');
  const payload = `${issuedAt}.${nonce}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifySession(token: string | undefined): boolean {
  if (!token) return false;
  const secret = process.env.DASHBOARD_SESSION_SECRET;
  if (!secret) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [issuedAt, nonce, sig] = parts as [string, string, string];
  if (!/^\d{1,16}$/.test(issuedAt) || !/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(sig)) {
    return false;
  }
  const expected = createHmac('sha256', secret).update(`${issuedAt}.${nonce}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'hex');
  } catch {
    return false;
  }
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

// PIN 시도 rate limit — IP 별 최근 10분 내 실패 카운트, 10회 초과 시 5분 block.
// 봇 컨테이너는 단일 인스턴스라 인메모리로 충분.
type Bucket = { failures: number; firstAt: number; blockedUntil: number };
const buckets = new Map<string, Bucket>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 10;
const BLOCK_MS = 5 * 60 * 1000;

export function isBlocked(ip: string): boolean {
  const b = buckets.get(ip);
  if (!b) return false;
  return Date.now() < b.blockedUntil;
}

export function recordFailure(ip: string): void {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now - b.firstAt > WINDOW_MS) {
    buckets.set(ip, { failures: 1, firstAt: now, blockedUntil: 0 });
    return;
  }
  b.failures += 1;
  if (b.failures >= MAX_FAILURES) {
    b.blockedUntil = now + BLOCK_MS;
  }
}

export function recordSuccess(ip: string): void {
  buckets.delete(ip);
}

// /login 페이지 HTML — 단일 6자리 PIN input.
// PWA 자산(manifest, SW, beforeinstallprompt 캡처) 도 포함 → 모바일 크롬에서 로그인 전에도 "앱 설치" 가능.
export const LOGIN_HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<meta name="theme-color" content="#0a0806">
<title>로그인 — Owlim 대시보드</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon-192.png" type="image/png">
<link rel="apple-touch-icon" href="/icon-192.png">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Pretendard', system-ui, sans-serif;
    background: radial-gradient(ellipse at top, #1a1410 0%, #0a0806 60%);
    color: #e8e0d0;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 24px;
  }
  .card {
    width: 100%;
    max-width: 360px;
    background: rgba(20, 16, 12, 0.7);
    border: 1px solid rgba(200, 160, 90, 0.25);
    border-radius: 16px;
    padding: 32px 24px;
    backdrop-filter: blur(8px);
    box-shadow: 0 24px 60px -12px rgba(0,0,0,0.7);
  }
  .brand {
    text-align: center;
    margin-bottom: 24px;
  }
  .brand .logo { width: 160px; height: auto; margin: 0 auto 8px; display: block; filter: invert(1) brightness(1.2); }
  .brand h1 {
    font-size: 16px;
    margin: 6px 0 0;
    color: #c8a05a;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    font-weight: 600;
  }
  .brand p {
    font-size: 12px;
    color: #8a7c64;
    margin: 6px 0 0;
  }
  label {
    display: block;
    font-size: 13px;
    color: #b8a888;
    margin-bottom: 8px;
  }
  input[type=text] {
    width: 100%;
    height: 56px;
    background: #0a0806;
    border: 1px solid rgba(200, 160, 90, 0.3);
    border-radius: 8px;
    color: #f0e8d8;
    font-family: ui-monospace, 'JetBrains Mono', monospace;
    font-size: 28px;
    text-align: center;
    letter-spacing: 0.6em;
    padding: 0 0 0 0.6em;
    outline: none;
    transition: border-color 0.2s;
  }
  input[type=text]:focus { border-color: #c8a05a; }
  button {
    width: 100%;
    height: 48px;
    margin-top: 16px;
    background: linear-gradient(135deg, #c8a05a, #a08040);
    color: #1a1410;
    border: none;
    border-radius: 8px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
  }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  .err {
    margin-top: 12px;
    padding: 10px 12px;
    background: rgba(200, 60, 60, 0.12);
    border: 1px solid rgba(200, 60, 60, 0.35);
    border-radius: 6px;
    color: #f4b8b8;
    font-size: 12px;
    line-height: 1.5;
  }
  .err.hidden { display: none; }
  .install {
    display: none;
    width: 100%;
    height: 44px;
    margin-top: 10px;
    background: transparent;
    border: 1px solid rgba(200, 160, 90, 0.4);
    color: #c8a05a;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  .install.show { display: block; }
  .ios-guide {
    display: none;
    margin-top: 14px;
    padding: 12px 14px;
    background: rgba(200, 160, 90, 0.08);
    border: 1px solid rgba(200, 160, 90, 0.25);
    border-radius: 8px;
    font-size: 12px;
    line-height: 1.6;
    color: #d8c8a8;
  }
  .ios-guide.show { display: block; }
  .ios-guide b { color: #c8a05a; }
</style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <img class="logo" src="/owlim-logo.png" alt="Owlim">
      <p>대시보드 PIN 입력</p>
    </div>
    <form id="f" autocomplete="off">
      <label for="pin">6자리 PIN</label>
      <input id="pin" name="pin" type="text" inputmode="numeric" pattern="\\d{6}" maxlength="6"
             autocomplete="one-time-code" autofocus required>
      <button id="btn" type="submit">로그인</button>
      <button id="install" class="install" type="button">📲 홈 화면에 앱으로 설치</button>
      <div id="iosGuide" class="ios-guide">
        <div>iOS Safari 에서는 자동 설치 prompt 가 없습니다.</div>
        <div style="margin-top: 6px;">
          <b>공유 아이콘</b> <span style="font-size:14px;">⎙</span> → <b>홈 화면에 추가</b> 를 눌러주세요.
        </div>
      </div>
      <div id="err" class="err hidden"></div>
    </form>
  </div>
<script>
  // beforeinstallprompt — Vue 마운트 전에도 캡처 (사실상 이 페이지는 정적 HTML 이라 항상 여기서 받음).
  // 같은 origin 의 SPA 와 공유하기 위해 window.__pwaPrompt 에 저장.
  window.__pwaPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    window.__pwaPrompt = e;
    var btn = document.getElementById('install');
    if (btn) btn.classList.add('show');
  });
  window.addEventListener('appinstalled', function () {
    window.__pwaPrompt = null;
    var btn = document.getElementById('install');
    if (btn) btn.classList.remove('show');
  });
  // Service Worker 등록 — Chrome 이 PWA 로 인식하는 필수 조건.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function (e) { console.warn('SW:', e); });
    });
  }
</script>
<script>
(function () {
  var f = document.getElementById('f');
  var input = document.getElementById('pin');
  var btn = document.getElementById('btn');
  var err = document.getElementById('err');
  var installBtn = document.getElementById('install');
  var iosGuide = document.getElementById('iosGuide');

  // iOS Safari 감지 — beforeinstallprompt 미지원이라 수동 안내가 필요.
  var ua = navigator.userAgent;
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (/Mac/.test(ua) && 'ontouchend' in document);
  var isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  var isStandalone =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    !!navigator.standalone;

  // 이미 설치된 상태면 버튼 숨김. iOS Safari 면 미리 노출 (prompt 없으므로 수동 안내).
  if (isStandalone) {
    installBtn.style.display = 'none';
  } else if (isIOS && isSafari) {
    installBtn.classList.add('show');
  } else if (window.__pwaPrompt) {
    installBtn.classList.add('show');
  }

  installBtn.addEventListener('click', async function () {
    if (isIOS && isSafari) {
      iosGuide.classList.add('show');
      return;
    }
    var evt = window.__pwaPrompt;
    if (!evt) {
      iosGuide.classList.add('show');
      iosGuide.innerHTML =
        '<div>브라우저가 아직 설치 prompt 를 보내지 않았어요.</div>' +
        '<div style="margin-top:6px;">크롬 우측 상단 <b>⋮ 메뉴 → 앱 설치</b> 를 직접 눌러주세요.</div>';
      return;
    }
    try {
      await evt.prompt();
      await evt.userChoice;
    } catch (_) {}
    window.__pwaPrompt = null;
    installBtn.classList.remove('show');
  });

  input.addEventListener('input', function () {
    input.value = input.value.replace(/\\D/g, '').slice(0, 6);
    err.classList.add('hidden');
  });

  f.addEventListener('submit', async function (e) {
    e.preventDefault();
    var pin = input.value;
    if (!/^\\d{6}$/.test(pin)) {
      err.textContent = '6자리 숫자를 입력해주세요.';
      err.classList.remove('hidden');
      return;
    }
    btn.disabled = true;
    try {
      var res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ pin: pin })
      });
      if (res.ok) {
        var next = new URLSearchParams(location.search).get('next') || '/';
        if (next.charAt(0) !== '/' || next.indexOf('//') === 0) next = '/';
        location.replace(next);
        return;
      }
      var data = {};
      try { data = await res.json(); } catch (_) {}
      err.textContent = data.error || ('로그인 실패 (' + res.status + ')');
      err.classList.remove('hidden');
      input.value = '';
      input.focus();
    } catch (ex) {
      err.textContent = '네트워크 오류 — 다시 시도해주세요.';
      err.classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  });
})();
</script>
</body>
</html>`;
