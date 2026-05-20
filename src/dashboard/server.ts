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

  app.get('/health', (c) => c.text('ok'));

  // 현재 봇 버전 (업데이트 폴링용)
  app.get('/api/version', (c) =>
    c.json({ sha: shortSha(GIT_SHA), buildDate: BUILD_DATE }),
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
