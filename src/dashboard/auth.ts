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

// /login 페이지 HTML — 단일 6자리 PIN input. 정적 (PWA 자산과 무관).
export const LOGIN_HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>로그인 — Owlim 대시보드</title>
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
  .brand .logo { font-size: 32px; }
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
</style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <div class="logo">🦉</div>
      <h1>Owlim</h1>
      <p>대시보드 PIN 입력</p>
    </div>
    <form id="f" autocomplete="off">
      <label for="pin">6자리 PIN</label>
      <input id="pin" name="pin" type="text" inputmode="numeric" pattern="\\d{6}" maxlength="6"
             autocomplete="one-time-code" autofocus required>
      <button id="btn" type="submit">로그인</button>
      <div id="err" class="err hidden"></div>
    </form>
  </div>
<script>
(function () {
  var f = document.getElementById('f');
  var input = document.getElementById('pin');
  var btn = document.getElementById('btn');
  var err = document.getElementById('err');

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
