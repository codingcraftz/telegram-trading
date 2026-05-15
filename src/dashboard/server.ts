// 대시보드 HTTP 서버 — 봇 컨테이너 안에서 동작.
// Hono + 정적 HTML. 포트 8080. Caddy가 reverse-proxy로 HTTPS 처리.
// 인증은 Caddy의 basic_auth 미들웨어로 처리 (이 서버 자체는 인증 안 함).

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

import { handleBalance } from '../api/balance.js';
import {
  handleCancelKis,
  handleTradeBuy,
  handleTradeCancel,
  handleTradeConfirm,
  handleTradeSell,
} from '../api/trade.js';
import { handleOrders } from '../api/orders.js';
import { handleQuote, handleSearch } from '../api/quote.js';
import { handleChartApi } from '../api/chart.js';
import {
  handleWatchlistAdd,
  handleWatchlistList,
  handleWatchlistRemove,
} from '../api/watchlist.js';
import { handleStrategyGet, handleStrategyPost } from '../api/strategy.js';
import { handleSession } from '../api/session.js';

const ENV_PATH = process.env.ENV_PATH ?? '/app/data/runtime.env';
const UPDATE_SENTINEL = '/app/data/.update-now';
const GIT_SHA = process.env.GIT_SHA ?? 'dev';
const BUILD_DATE = process.env.BUILD_DATE ?? '';
const REPO_API = 'https://api.github.com/repos/codingcraftz/telegram-trading/commits/main';

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

function shortSha(s: string): string {
  return s.length >= 7 ? s.slice(0, 7) : s;
}

function hasKeys(...keys: Array<string | undefined>): boolean {
  return keys.every((k) => !!k && k.length > 0);
}

const HTML = (s: Settings) => {
  const paperKeysOk = hasKeys(s.KIS_PAPER_APP_KEY, s.KIS_PAPER_APP_SECRET, s.KIS_PAPER_STOCK);
  const realKeysOk = hasKeys(s.KIS_APP_KEY, s.KIS_APP_SECRET, s.KIS_ACCT_STOCK);
  const paperActive = paperKeysOk && s.MODE === 'paper';
  const realActive = realKeysOk && s.MODE === 'real';
  return `<!DOCTYPE html>
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
  .row { display:flex; gap:8px; align-items:center; flex-wrap: wrap; }
  button { background:#3b82f6; color:white; border:0; padding:10px 18px; border-radius:6px; font-size:14px; cursor:pointer; font-weight:600; }
  button:hover { background:#2563eb; }
  button:disabled { background:#475569; cursor:not-allowed; opacity:0.6; }
  button.secondary { background:#475569; }
  button.danger { background:#dc2626; }
  button.success { background:#16a34a; }
  .toast { position:fixed; bottom:20px; right:20px; padding:12px 16px; border-radius:8px; background:#16a34a; color:white; opacity:0; transition: opacity .3s; max-width: 80%; }
  .toast.show { opacity:1; }
  .pill { display:inline-block; font-size:11px; padding:2px 8px; border-radius:9999px; }
  .pill.on { background:#16a34a; color:white; }
  .pill.off { background:#475569; color:white; }
  .pill.update { background:#f59e0b; color:white; }
  .hint { font-size:12px; color:#94a3b8; margin-top:4px; }
  .version { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; color:#94a3b8; }
  a { color:#60a5fa; }
</style>
</head>
<body>
<div class="wrap">
  <h1>📈 KIS 텔레그램 봇 대시보드</h1>
  <p class="sub">키와 셋팅을 입력해 봇을 활성화합니다. 변경 후 [저장 + 봇 재시작]을 누르세요.</p>

  <div class="card">
    <h2>🔧 버전 / 업데이트</h2>
    <div class="row" style="gap:12px; margin-bottom:8px;">
      <span class="version">현재 버전: <b id="curVersion">${shortSha(GIT_SHA)}</b>${BUILD_DATE ? ` <span style="color:#64748b">(${BUILD_DATE.slice(0, 10)})</span>` : ''}</span>
      <span id="updateBadge"></span>
    </div>
    <div class="row" style="gap:8px;">
      <button id="checkUpdateBtn" class="secondary" type="button">🔍 업데이트 확인</button>
      <button id="doUpdateBtn" type="button" disabled>⬇️ 지금 업데이트</button>
    </div>
    <div class="hint" id="updateHint">업데이트는 백그라운드에서 진행되며 1~2분 안에 봇이 재시작됩니다.</div>
  </div>

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
      <h2>🧪 KIS 모의투자
        <span class="pill ${paperKeysOk ? 'on' : 'off'}">${paperKeysOk ? '🔑 키 등록됨' : '키 미입력'}</span>
        <span class="pill ${paperActive ? 'on' : 'off'}">${paperActive ? '✅ 사용 중' : '대기'}</span>
      </h2>
      <div class="hint" style="margin-bottom:12px;">실제 현금 거래 X · KIS 모의계좌(시드 1억 자동 지급)로 테스트.</div>
      <div class="grid">
        <label>APP_KEY
          <input type="password" name="KIS_PAPER_APP_KEY" value="${s.KIS_PAPER_APP_KEY ?? ''}" placeholder="발급받은 APP_KEY" />
        </label>
        <label>APP_SECRET
          <input type="password" name="KIS_PAPER_APP_SECRET" value="${s.KIS_PAPER_APP_SECRET ?? ''}" placeholder="발급받은 APP_SECRET" />
        </label>
        <label>모의 종합계좌
          <input type="text" name="KIS_PAPER_STOCK" value="${s.KIS_PAPER_STOCK ?? ''}" placeholder="50012345-01" />
          <div class="hint">계좌번호 전체(<code>50012345-01</code>) 또는 앞 8자리만 둘 다 OK.</div>
        </label>
      </div>
    </div>

    <div class="card">
      <h2>🔥 KIS 실전
        <span class="pill ${realKeysOk ? 'on' : 'off'}">${realKeysOk ? '🔑 키 등록됨' : '키 미입력'}</span>
        <span class="pill ${realActive ? 'on' : 'off'}">${realActive ? '✅ 사용 중' : '대기'}</span>
      </h2>
      <div class="hint" style="margin-bottom:12px;">⚠️ 실제 자금 거래 — 모드를 [real]로 바꿔야 실전이 활성됩니다.</div>
      <div class="grid">
        <label>APP_KEY
          <input type="password" name="KIS_APP_KEY" value="${s.KIS_APP_KEY ?? ''}" placeholder="발급받은 APP_KEY" />
        </label>
        <label>APP_SECRET
          <input type="password" name="KIS_APP_SECRET" value="${s.KIS_APP_SECRET ?? ''}" placeholder="발급받은 APP_SECRET" />
        </label>
        <label>실전 종합계좌
          <input type="text" name="KIS_ACCT_STOCK" value="${s.KIS_ACCT_STOCK ?? ''}" placeholder="12345678-01" />
          <div class="hint">계좌번호 전체(<code>12345678-01</code>) 또는 앞 8자리만. 상품코드(<code>-01</code>)가 다른 경우(선물옵션 <code>-22</code> 등)는 전체 입력 필수.</div>
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
  setTimeout(() => toast.classList.remove('show'), 5000);
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

const checkBtn = document.getElementById('checkUpdateBtn');
const doBtn = document.getElementById('doUpdateBtn');
const badge = document.getElementById('updateBadge');
const hint = document.getElementById('updateHint');

checkBtn.addEventListener('click', async () => {
  checkBtn.disabled = true;
  badge.innerHTML = '⏳ 확인 중...';
  try {
    const res = await fetch('/api/check-update');
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (data.updateAvailable) {
      badge.innerHTML = '<span class="pill update">🔔 업데이트 가능: ' + data.latest + '</span>';
      hint.innerHTML = '<b>최신 변경:</b> ' + (data.latestMessage || '(메시지 없음)') + '<br><b>[⬇️ 지금 업데이트]</b>를 누르면 1~2분 안에 적용됩니다.';
      doBtn.disabled = false;
    } else {
      badge.innerHTML = '<span class="pill on">✅ 최신 버전</span>';
      hint.textContent = '업데이트할 내용이 없습니다.';
    }
  } catch (e) {
    badge.innerHTML = '<span class="pill off">❌ 확인 실패</span>';
    hint.textContent = '⚠️ ' + (e.message || '확인 실패');
  } finally {
    checkBtn.disabled = false;
  }
});

const initialVersion = '${shortSha(GIT_SHA)}';
let updatePollTimer = null;

function startUpdatePolling() {
  // 1분 간격으로 GitHub vs 현재 봇 버전 비교. 같아지면 "업데이트 완료" 표시.
  if (updatePollTimer) clearInterval(updatePollTimer);
  updatePollTimer = setInterval(async () => {
    try {
      // health endpoint로 봇 살아있는지 + version은 hash로 GET /
      const v = await fetch('/api/version').then((r) => r.json()).catch(() => null);
      if (v && v.sha && v.sha !== initialVersion) {
        clearInterval(updatePollTimer);
        updatePollTimer = null;
        // UI: 로딩 → 완료
        checkBtn.style.display = 'inline-block';
        doBtn.style.display = 'none';
        badge.innerHTML = '<span class="pill on">✅ 업데이트 완료: ' + v.sha + '</span>';
        hint.innerHTML = '✅ <b>업데이트 완료!</b> 새 버전(' + v.sha + ')으로 봇이 재시작됐습니다. <a href="javascript:location.reload()">새로고침</a>해서 전체 UI 갱신.';
        document.getElementById('curVersion').textContent = v.sha;
        showToast('✅ 업데이트 완료!');
      }
    } catch {}
  }, 10_000);
}

doBtn.addEventListener('click', async () => {
  if (!confirm('지금 봇을 업데이트하시겠어요? 1~2분 동안 봇이 재시작됩니다.')) return;
  // UI: 버튼 숨김 + 로딩 표시
  checkBtn.style.display = 'none';
  doBtn.style.display = 'none';
  badge.innerHTML = '<span class="pill update">⏳ 업데이트 중…</span> <span class="spinner"></span>';
  hint.textContent = '업데이트 요청 중...';
  try {
    const res = await fetch('/api/update', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'failed');
    showToast('✅ ' + (data.message || '업데이트 요청됨'));
    hint.innerHTML = '⏳ <b>업데이트 진행 중...</b><br>cron 감지 → docker pull → 컨테이너 재시작 → 새 버전 확인 (1~3분 소요).';
    startUpdatePolling();
  } catch (e) {
    showToast('❌ ' + e.message, false);
    hint.textContent = '❌ ' + e.message;
    // 실패 시 버튼 복구
    checkBtn.style.display = 'inline-block';
    doBtn.style.display = 'inline-block';
    doBtn.disabled = false;
  }
});
</script>
<style>
  @keyframes spin { to { transform: rotate(360deg); } }
  .spinner { display:inline-block; width:14px; height:14px; border:2px solid #94a3b8; border-top-color:#3b82f6; border-radius:50%; animation: spin 1s linear infinite; vertical-align: middle; margin-left:6px; }
</style>
</body>
</html>`;
};

export function startDashboard(port = 8080): void {
  const app = new Hono();

  // 정적 SPA 파일이 있으면 어떤 경로인지 확인 (Dockerfile에서 dist/web으로 복사)
  const WEB_ROOT = resolve('./dist/web');
  const WEB_INDEX = `${WEB_ROOT}/index.html`;
  const hasSpa = existsSync(WEB_INDEX);
  console.log(`[dashboard] SPA at ${WEB_ROOT}: ${hasSpa ? 'found' : 'not built yet'}`);

  app.get('/health', (c) => c.text('ok'));

  // 현재 봇 버전 (업데이트 폴링용)
  app.get('/api/version', (c) =>
    c.json({ sha: shortSha(GIT_SHA), buildDate: BUILD_DATE }),
  );

  // ===== 데이터 조회 API (PWA용) =====
  app.get('/api/session', handleSession);
  app.get('/api/balance', handleBalance);
  app.get('/api/orders', handleOrders);
  app.get('/api/quote', handleQuote);
  app.get('/api/search', handleSearch);
  app.get('/api/chart', handleChartApi);
  app.get('/api/watchlist', handleWatchlistList);
  app.get('/api/strategy', handleStrategyGet);

  // ===== 액션 API =====
  app.post('/api/trade/buy', handleTradeBuy);
  app.post('/api/trade/sell', handleTradeSell);
  app.post('/api/trade/confirm/:id', handleTradeConfirm);
  app.post('/api/trade/cancel/:id', handleTradeCancel);
  app.post('/api/trade/cancel-kis', handleCancelKis);
  app.post('/api/watchlist/add', handleWatchlistAdd);
  app.post('/api/watchlist/remove/:id', handleWatchlistRemove);
  app.post('/api/strategy', handleStrategyPost);

  app.post('/api/settings', async (c) => {
    const body = (await c.req.json()) as Settings;
    if (body.MODE && body.MODE !== 'paper' && body.MODE !== 'real') {
      return c.text('mode must be paper or real', 400);
    }
    const cur = readSettings();
    writeSettings({ ...cur, ...body });
    setTimeout(() => process.exit(0), 1000);
    return c.json({ ok: true });
  });

  // GitHub API로 latest main commit 확인 → 현재 GIT_SHA와 비교
  app.get('/api/check-update', async (c) => {
    try {
      const res = await fetch(REPO_API, {
        headers: { 'User-Agent': 'owlim-bot-dashboard' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        return c.json({ error: `GitHub API ${res.status}` }, 502);
      }
      const data = (await res.json()) as { sha?: string; commit?: { message?: string } };
      const latest = data.sha ?? '';
      const latestMessage = (data.commit?.message ?? '').split('\n')[0]?.slice(0, 200) ?? '';
      const current = GIT_SHA === 'dev' ? '' : GIT_SHA;
      const updateAvailable = !!current && !!latest && shortSha(latest) !== shortSha(current);
      return c.json({
        current: shortSha(current || 'dev'),
        latest: shortSha(latest),
        latestMessage,
        updateAvailable,
      });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  // 업데이트 trigger — sentinel 파일 touch. 호스트의 cron(매분)이 감지 후 docker compose pull + up.
  app.post('/api/update', async (c) => {
    try {
      mkdirSync(dirname(UPDATE_SENTINEL), { recursive: true });
      writeFileSync(UPDATE_SENTINEL, new Date().toISOString(), 'utf-8');
      return c.json({
        ok: true,
        message: '업데이트 요청됨. 1분 안에 docker pull + 재시작 시작 (총 1~2분 소요).',
      });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  // SPA가 빌드되어 있으면: 정적 파일 + SPA fallback
  // SPA 없으면: 옛 HTML 폼 (키 입력 등)
  if (hasSpa) {
    // PWA용 manifest / icons / app.js / css 등 정적 파일 서빙
    app.use('/*', serveStatic({ root: './dist/web' }));
    // SPA history 모드 fallback: 매치 안 된 모든 GET → index.html
    app.get('*', (c) => c.html(readFileSync(WEB_INDEX, 'utf-8')));
  } else {
    // PWA 빌드 전: 기존 SSR HTML 폼 유지 (대시보드 설정만 가능)
    app.get('/', (c) => c.html(HTML(readSettings())));
  }

  serve({ fetch: app.fetch, port });
  console.log(`[dashboard] listening on :${port}  ·  version=${shortSha(GIT_SHA)}`);
}
