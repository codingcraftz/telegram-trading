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
import { handleOrders, handleOrdersFilled } from '../api/orders.js';
import { handleOrderable } from '../api/orderable.js';
import { handleQuote, handleQuotes, handleSearch } from '../api/quote.js';
import { handleCandles } from '../api/candles.js';
import { handleIndices } from '../api/indices.js';
import { handleRanking } from '../api/ranking.js';
import {
  handleStrategiesList,
  handleStrategyApplicationDelete,
  handleStrategyApply,
  handleStrategyClone,
  handleStrategyCreate,
  handleStrategyDelete,
  handleStrategyExecutions,
  handleStrategyGet as handleStrategyGetById,
  handleStrategyToggle,
  handleStrategyUpdate,
} from '../api/strategies.js';
import { handleAsking } from '../api/asking.js';
import { handleStreamAsking } from '../api/stream-asking.js';
import { handleStreamTick } from '../api/stream-tick.js';
import {
  handleWatchlistAdd,
  handleWatchlistList,
  handleWatchlistRemove,
} from '../api/watchlist.js';
import { handleStrategyGet, handleStrategyPost } from '../api/strategy.js';
import { handleKeysStatus, handleSession } from '../api/session.js';
import { handleThemes, handleThemeDetail, handleThemeSearch } from '../api/themes.js';
import {
  authEnabled,
  isBlocked,
  issueSession,
  LOGIN_HTML,
  recordFailure,
  recordSuccess,
  SESSION_COOKIE,
  verifyPin,
  verifySession,
} from './auth.js';

const ENV_PATH = process.env.ENV_PATH ?? '/app/data/runtime.env';
const UPDATE_SENTINEL = '/app/data/.update-now';
const GIT_SHA = process.env.GIT_SHA ?? 'dev';
const BUILD_DATE = process.env.BUILD_DATE ?? '';
// 사용자에게 보여줄 의미 있는 버전 (package.json 의 version 필드). Dockerfile 의
// runtime stage 가 package.json 을 /app 으로 복사하므로 process.cwd() 기준에서 읽음.
const APP_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch { return '0.0.0'; }
})();
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

// PWA 빌드 누락 시만 표시되는 fallback. 정상 운영에선 보이지 않음 — Dockerfile 이 항상 dist/web 빌드.
const PWA_MISSING_HTML = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><title>PWA 빌드 누락</title></head>
<body style="font-family:system-ui;background:#0f172a;color:#e2e8f0;padding:32px;line-height:1.6">
<h1>⚠️ PWA 빌드 누락</h1>
<p>대시보드 PWA 자산이 빌드되지 않았습니다. 개발 환경이라면 <code>cd web &amp;&amp; pnpm build</code> 로 빌드 후 다시 시작하세요.</p>
</body></html>`;


export function startDashboard(port = 8080): void {
  const app = new Hono();

  // 정적 SPA 파일이 있으면 어떤 경로인지 확인 (Dockerfile에서 dist/web으로 복사)
  const WEB_ROOT = resolve('./dist/web');
  const WEB_INDEX = `${WEB_ROOT}/index.html`;
  const hasSpa = existsSync(WEB_INDEX);
  console.log(`[dashboard] SPA at ${WEB_ROOT}: ${hasSpa ? 'found' : 'not built yet'}`);

  // 전역 에러 핸들러 — handler에서 throw 시 JSON으로 반환
  app.onError((err, c) => {
    console.error('[api] error:', err.message);
    return c.json({ error: err.message }, 500);
  });

  // ===== 인증 미들웨어 =====
  // DASHBOARD_PIN_HASH + DASHBOARD_SESSION_SECRET 가 설정된 경우에만 활성.
  // 미설정 시(구버전 .env, 수동 설치 등)는 통과 — Caddy basic_auth 또는 무인증 fallback.
  if (authEnabled()) {
    console.log('[dashboard] PIN auth enabled');
    app.use('*', async (c, next) => {
      const path = c.req.path;
      // 통과 경로 — 로그인 UI, 로그인/로그아웃 액션, 헬스체크
      if (
        path === '/login' ||
        path === '/api/login' ||
        path === '/api/logout' ||
        path === '/health'
      ) {
        return next();
      }
      // 정적 자산은 인증 불필요 (민감 정보 없음). 확장자 기반 매칭.
      if (/\.(?:js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|webmanifest|json|txt)$/i.test(path)) {
        return next();
      }
      // 세션 쿠키 검증
      const cookieHeader = c.req.header('cookie') ?? '';
      const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
      const token = m?.[1];
      if (verifySession(token)) {
        return next();
      }
      // 미인증 처리 — API 는 401 JSON, 페이지는 /login 으로 redirect
      if (path.startsWith('/api/')) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      const nextPath = path === '/' ? '' : `?next=${encodeURIComponent(path)}`;
      return c.redirect(`/login${nextPath}`, 302);
    });

    // 로그인 페이지
    app.get('/login', (c) => c.html(LOGIN_HTML));

    // PIN 검증 → 세션 쿠키 발급. 브라우저 세션 쿠키 (Max-Age 미설정 → 창 닫으면 만료).
    app.post('/api/login', async (c) => {
      const ip =
        c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
        c.req.header('x-real-ip') ||
        'unknown';
      if (isBlocked(ip)) {
        return c.json({ error: '시도가 너무 많습니다. 5분 후 다시 시도해주세요.' }, 429);
      }
      let pin = '';
      try {
        const body = (await c.req.json()) as { pin?: unknown };
        pin = typeof body.pin === 'string' ? body.pin : '';
      } catch {
        return c.json({ error: '잘못된 요청 형식' }, 400);
      }
      const ok = await verifyPin(pin);
      if (!ok) {
        recordFailure(ip);
        return c.json({ error: 'PIN 이 일치하지 않습니다.' }, 401);
      }
      recordSuccess(ip);
      const token = issueSession();
      c.header(
        'Set-Cookie',
        `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/`,
      );
      return c.json({ ok: true });
    });

    app.post('/api/logout', (c) => {
      c.header(
        'Set-Cookie',
        `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
      );
      return c.json({ ok: true });
    });
  }

  app.get('/health', (c) => c.text('ok'));

  // 현재 봇 버전 (업데이트 폴링용)
  app.get('/api/version', (c) =>
    c.json({ version: APP_VERSION, sha: shortSha(GIT_SHA), buildDate: BUILD_DATE }),
  );

  // ===== 데이터 조회 API (PWA용) =====
  app.get('/api/session', handleSession);
  app.get('/api/keys-status', handleKeysStatus);
  app.get('/api/balance', handleBalance);
  app.get('/api/orderable', handleOrderable); // 종목+가격 기준 정확한 매수가능
  app.get('/api/orders', handleOrders);
  app.get('/api/orders/filled', handleOrdersFilled); // 체결 내역 (days 파라미터)
  app.get('/api/quote', handleQuote);
  app.get('/api/quotes', handleQuotes); // batch (실시간 폴링용)
  app.get('/api/search', handleSearch);
  app.get('/api/candles', handleCandles); // 인터랙티브 차트용 JSON
  app.get('/api/indices', handleIndices); // 코스피·코스닥·나스닥·다우
  app.get('/api/ranking', handleRanking); // 거래대금/거래량/상승률/하락률 순위
  app.get('/api/themes', handleThemes); // 네이버 테마 랭킹
  app.get('/api/themes/search', handleThemeSearch); // 종목명으로 속한 테마 검색
  app.get('/api/themes/:no', handleThemeDetail); // 테마 소속 종목 list

  // ===== 전략 시스템 (스텝 5) =====
  app.get('/api/strategies', handleStrategiesList);
  app.post('/api/strategies', handleStrategyCreate);
  app.get('/api/strategies/:id', handleStrategyGetById);
  app.put('/api/strategies/:id', handleStrategyUpdate);
  app.delete('/api/strategies/:id', handleStrategyDelete);
  app.post('/api/strategies/:id/clone', handleStrategyClone);
  app.post('/api/strategies/:id/apply', handleStrategyApply);
  app.delete('/api/strategies/:id/applications/:appId', handleStrategyApplicationDelete);
  app.post('/api/strategies/:id/toggle', handleStrategyToggle);
  app.get('/api/strategies/:id/executions', handleStrategyExecutions);
  app.get('/api/asking', handleAsking); // 10단계 호가 + 잔량 (REST fallback)
  app.get('/api/stream/asking', handleStreamAsking); // KIS WS → SSE 실시간 호가
  app.get('/api/stream/tick', handleStreamTick); // KIS WS → SSE 실시간 체결가
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

  // 매매 모드 전환 — 봇 재시작 없이 즉시 적용. runtime.setMode + .env 영속.
  app.post('/api/mode', async (c) => {
    let body: { mode?: string } = {};
    try { body = await c.req.json(); } catch { return c.json({ error: 'invalid json' }, 400); }
    if (body.mode !== 'paper' && body.mode !== 'real') {
      return c.json({ error: 'mode must be paper or real' }, 400);
    }
    // 동적 import — 부팅 순서 의존 회피.
    const { setMode } = await import('../runtime.js');
    setMode(body.mode);
    // .env 영속 (봇 재시작 시 동일 값 유지)
    const cur = readSettings();
    writeSettings({ ...cur, MODE: body.mode });
    return c.json({ ok: true, mode: body.mode });
  });

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
  // conventional commit prefix → 사용자 친화 라벨. 우리 PR 단위 commit 메시지가 그대로
  // 노출되면 너무 디테일 → '기능 추가' / '버그 수정' / '디자인 다듬기' 같이 카테고리만.
  function friendlyChangeLabel(rawMsg: string): string {
    const m = rawMsg.match(/^(\w+)(\([^)]+\))?:/);
    const prefix = m?.[1]?.toLowerCase() ?? '';
    switch (prefix) {
      case 'feat': return '기능 추가';
      case 'fix': return '버그 수정';
      case 'polish': return '디자인 수정';
      case 'perf': return '속도 개선';
      case 'refactor':
      case 'chore': return '코드 정리';
      case 'docs': return '안내 수정';
      case 'security': return '보안 강화';
      default: return '업데이트';
    }
  }

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
      const rawMsg = (data.commit?.message ?? '').split('\n')[0] ?? '';
      // 옛 클라이언트 호환 위해 latestMessage 키 유지하되 friendly 라벨로 채움.
      const latestMessage = friendlyChangeLabel(rawMsg);
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

  // PWA 빌드 자산 서빙 + SPA history fallback. 빌드 누락 시는 안내 페이지 한 장.
  if (hasSpa) {
    app.use('/*', serveStatic({ root: './dist/web' }));
    app.get('*', (c) => c.html(readFileSync(WEB_INDEX, 'utf-8')));
  } else {
    app.get('/', (c) => c.html(PWA_MISSING_HTML));
  }

  serve({ fetch: app.fetch, port });
  console.log(`[dashboard] listening on :${port}  ·  version=${shortSha(GIT_SHA)}`);
}
