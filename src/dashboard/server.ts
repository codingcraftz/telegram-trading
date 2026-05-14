// 대시보드 HTTP 서버 — 봇 컨테이너 안에서 동작.
// Hono + 정적 HTML. 포트 8080. Caddy가 reverse-proxy로 HTTPS 처리.
// 인증은 Caddy의 basic_auth 미들웨어로 처리 (이 서버 자체는 인증 안 함).

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

const ENV_PATH = process.env.ENV_PATH ?? '/app/data/runtime.env';

type Settings = {
  TELEGRAM_BOT_TOKEN?: string;
  ALLOWED_CHAT_IDS?: string;
  KIS_PAPER_APP_KEY?: string;
  KIS_PAPER_APP_SECRET?: string;
  KIS_PAPER_STOCK?: string;
  KIS_APP_KEY?: string;
  KIS_APP_SECRET?: string;
  KIS_ACCT_STOCK?: string;
  MODE?: 'paper' | 'real';
};

function readSettings(): Settings {
  if (!existsSync(ENV_PATH)) return {};
  const text = readFileSync(ENV_PATH, 'utf-8');
  const out: Settings = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) (out as Record<string, string>)[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
  return out;
}

function writeSettings(s: Settings): void {
  mkdirSync(dirname(ENV_PATH), { recursive: true });
  const lines = Object.entries(s)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${v}`);
  writeFileSync(ENV_PATH, lines.join('\n') + '\n', 'utf-8');
}

function mask(v: string | undefined): string {
  if (!v) return '';
  if (v.length <= 8) return '••••';
  return v.slice(0, 4) + '••••' + v.slice(-4);
}

const HTML = (s: Settings) => `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>봇 대시보드</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background:#0f172a; color:#e2e8f0; margin:0; padding:24px; line-height:1.5; }
  .wrap { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  .sub { color:#94a3b8; font-size:14px; margin-bottom:24px; }
  .card { background:#1e293b; border:1px solid #334155; border-radius:12px; padding:20px; margin-bottom:16px; }
  .card h2 { font-size:16px; margin:0 0 12px; }
  label { display:block; font-size:13px; color:#cbd5e1; margin-bottom:6px; }
  input[type="text"], input[type="password"] { width:100%; box-sizing:border-box; padding:10px 12px; background:#0f172a; border:1px solid #334155; border-radius:6px; color:#e2e8f0; font-size:14px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  input:focus { outline:none; border-color:#3b82f6; }
  .grid { display:grid; gap:14px; }
  .row { display:flex; gap:8px; align-items:end; }
  .row > label { flex:1; }
  button { background:#3b82f6; color:white; border:0; padding:10px 18px; border-radius:6px; font-size:14px; cursor:pointer; font-weight:600; }
  button:hover { background:#2563eb; }
  button.secondary { background:#475569; }
  button.danger { background:#dc2626; }
  .toast { position:fixed; bottom:20px; right:20px; padding:12px 16px; border-radius:8px; background:#16a34a; color:white; opacity:0; transition: opacity .3s; }
  .toast.show { opacity:1; }
  .pill { display:inline-block; font-size:11px; padding:2px 8px; border-radius:9999px; }
  .pill.on { background:#16a34a; color:white; }
  .pill.off { background:#475569; color:white; }
  .hint { font-size:12px; color:#94a3b8; margin-top:4px; }
  a { color:#60a5fa; }
</style>
</head>
<body>
<div class="wrap">
  <h1>📈 KIS 텔레그램 봇 대시보드</h1>
  <p class="sub">키와 셋팅을 입력해 봇을 활성화합니다. 변경 후 [저장 + 봇 재시작]을 누르세요.</p>

  <form id="f">
    <div class="card">
      <h2>🤖 텔레그램</h2>
      <div class="grid">
        <label>봇 토큰
          <input type="password" name="TELEGRAM_BOT_TOKEN" value="${s.TELEGRAM_BOT_TOKEN ?? ''}" placeholder="1234567890:ABC..." />
          <div class="hint">@BotFather → /newbot</div>
        </label>
        <label>허용 chat_id (콤마 구분)
          <input type="text" name="ALLOWED_CHAT_IDS" value="${s.ALLOWED_CHAT_IDS ?? ''}" placeholder="12345678" />
          <div class="hint">@userinfobot → /start 로 본인 ID 확인</div>
        </label>
      </div>
    </div>

    <div class="card">
      <h2>🧪 KIS 모의투자 <span class="pill ${s.MODE === 'paper' ? 'on' : 'off'}">${s.MODE === 'paper' ? '활성' : '비활성'}</span></h2>
      <div class="grid">
        <label>APP_KEY
          <input type="password" name="KIS_PAPER_APP_KEY" value="${s.KIS_PAPER_APP_KEY ?? ''}" />
        </label>
        <label>APP_SECRET
          <input type="password" name="KIS_PAPER_APP_SECRET" value="${s.KIS_PAPER_APP_SECRET ?? ''}" />
        </label>
        <label>모의 종합계좌 8자리
          <input type="text" name="KIS_PAPER_STOCK" value="${s.KIS_PAPER_STOCK ?? ''}" placeholder="50012345" />
        </label>
      </div>
    </div>

    <div class="card">
      <h2>🔥 KIS 실전 <span class="pill ${s.MODE === 'real' ? 'on' : 'off'}">${s.MODE === 'real' ? '활성' : '비활성'}</span></h2>
      <div class="grid">
        <label>APP_KEY
          <input type="password" name="KIS_APP_KEY" value="${s.KIS_APP_KEY ?? ''}" />
        </label>
        <label>APP_SECRET
          <input type="password" name="KIS_APP_SECRET" value="${s.KIS_APP_SECRET ?? ''}" />
        </label>
        <label>실전 종합계좌 8자리
          <input type="text" name="KIS_ACCT_STOCK" value="${s.KIS_ACCT_STOCK ?? ''}" />
        </label>
      </div>
    </div>

    <div class="card">
      <h2>⚙️ 거래 모드</h2>
      <label>현재 모드
        <select name="MODE" style="width:100%;padding:10px 12px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:14px;">
          <option value="paper" ${s.MODE === 'paper' ? 'selected' : ''}>🧪 paper (모의투자)</option>
          <option value="real" ${s.MODE === 'real' ? 'selected' : ''}>🔥 real (실전)</option>
        </select>
      </label>
    </div>

    <div class="row">
      <button type="submit">💾 저장 + 봇 재시작</button>
      <button type="button" class="secondary" onclick="location.reload()">↺ 새로고침</button>
    </div>
  </form>
</div>

<div id="toast" class="toast"></div>

<script>
const f = document.getElementById('f');
const toast = document.getElementById('toast');
function showToast(msg, ok = true) {
  toast.textContent = msg;
  toast.style.background = ok ? '#16a34a' : '#dc2626';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3500);
}
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(f));
  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (res.ok) showToast('✅ 저장됨. 봇 재시작 중... (10~30초)');
  else {
    const t = await res.text();
    showToast('❌ ' + t.slice(0, 100), false);
  }
});
</script>
</body>
</html>`;

export function startDashboard(port = 8080): void {
  const app = new Hono();

  app.get('/', (c) => c.html(HTML(readSettings())));
  app.get('/health', (c) => c.text('ok'));

  app.post('/api/settings', async (c) => {
    const body = (await c.req.json()) as Settings;
    // 단순 검증
    if (body.MODE && body.MODE !== 'paper' && body.MODE !== 'real') {
      return c.text('mode must be paper or real', 400);
    }
    const cur = readSettings();
    writeSettings({ ...cur, ...body });
    // 봇 재시작 신호 — Docker가 다음 헬스체크 실패 시 자동 재시작 (또는 부모 프로세스가 SIGTERM 보냄)
    setTimeout(() => process.exit(0), 1000);
    return c.json({ ok: true });
  });

  serve({ fetch: app.fetch, port });
  console.log(`[dashboard] listening on :${port}`);
}
