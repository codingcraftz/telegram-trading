import { getConfig } from './config.js';
import { ensureSchema } from './db/migrate.js';
import { connectMcp, closeMcp } from './mcp/client.js';
import { createBot } from './bot/index.js';
import { reconcileOnBoot } from './monitor/recovery.js';
import { startMonitor, stopMonitor } from './monitor/worker.js';
import { startScheduler, stopScheduler } from './scheduler/worker.js';
import { ensureKrxSymbols } from './fastpath/symbols-fetcher.js';
import { reloadKrxMaster } from './fastpath/symbol.js';
import { startDashboard } from './dashboard/server.js';

async function main() {
  // 1) 대시보드는 항상 시작 (키가 없어도 사용자가 키 입력할 수 있게)
  console.log('[boot] starting dashboard');
  startDashboard(Number(process.env.DASHBOARD_PORT ?? 8080));

  // 2) DB 초기화
  console.log('[boot] db init');
  ensureSchema();

  // 3) 봇 시작 시도 — 키 부족하면 대시보드만 동작 + 사용자가 입력하면 supervisord/docker가 재시작
  let cfg;
  try {
    cfg = getConfig();
  } catch (err) {
    console.warn('[boot] 키 부족 — 봇 시작 보류. 대시보드에서 입력 후 자동 재시작.');
    console.warn('[boot] reason:', (err as Error).message);
    return; // process는 살아있음 (대시보드 + serve)
  }

  console.log('[boot] mode =', cfg.MODE);

  console.log('[boot] KRX 종목 마스터 확인');
  await ensureKrxSymbols();
  reloadKrxMaster();

  console.log('[boot] connecting MCP at', cfg.KIS_MCP_URL);
  await connectMcp();
  console.log('[boot] MCP connected');

  console.log('[boot] reconciling positions');
  await reconcileOnBoot();

  console.log('[boot] starting monitor');
  startMonitor();

  console.log('[boot] starting market-open scheduler');
  startScheduler();

  console.log('[boot] starting telegram bot');
  const bot = createBot();

  const shutdown = async (signal: string) => {
    console.log(`[shutdown] ${signal} received`);
    stopScheduler();
    stopMonitor();
    try {
      await bot.stop();
    } catch {}
    await closeMcp();
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await bot.start({ onStart: (me) => console.log('[bot] started as @' + me.username) });
  } catch (err) {
    console.error('[bot] start failed (대시보드는 동작):', (err as Error).message);
    // 대시보드 listen 살아있으니 process는 종료 안 됨
  }
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
