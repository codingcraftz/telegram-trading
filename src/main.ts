import { getConfig } from './config.js';
import { ensureSchema } from './db/migrate.js';
import { reconcileOnBoot } from './monitor/recovery.js';
import { startMonitor, stopMonitor } from './monitor/worker.js';
import { startScheduler, stopScheduler } from './scheduler/worker.js';
import { startWarmup, stopWarmup } from './fastpath/warmup.js';
import { ensureKrxSymbols } from './fastpath/symbols-fetcher.js';
import { reloadKrxMaster } from './fastpath/symbol.js';
import { startDashboard } from './dashboard/server.js';
import { prefetchHolidays } from './scheduler/holidays.js';
import { ensureInitialHotStocks } from './jobs/hot-stocks.js';

async function main() {
  console.log('[boot] starting dashboard');
  startDashboard(Number(process.env.DASHBOARD_PORT ?? 8080));

  let cfg;
  try {
    console.log('[boot] db init');
    ensureSchema();
    cfg = getConfig();
  } catch (err) {
    console.warn('[boot] 시작 보류 (대시보드는 동작) — 대시보드에서 키 입력 후 컨테이너 재시작.');
    console.warn('[boot] reason:', (err as Error).message);
    return;
  }

  console.log('[boot] mode =', cfg.MODE);

  console.log('[boot] KRX 종목 마스터 확인');
  await ensureKrxSymbols();
  reloadKrxMaster();

  console.log('[boot] KIS REST 직접 호출 모드');

  console.log('[boot] reconciling positions');
  await reconcileOnBoot();

  console.log('[boot] prefetching holidays');
  await prefetchHolidays(60).catch((err) =>
    console.warn('[boot] holiday prefetch error:', (err as Error).message),
  );

  console.log('[boot] starting monitor');
  startMonitor();

  console.log('[boot] starting market-open scheduler');
  startScheduler();

  console.log('[boot] checking HOT stocks initial data');
  ensureInitialHotStocks().catch(err =>
    console.warn('[boot] hot-stocks seed error:', (err as Error).message),
  );

  console.log('[boot] starting warmup (balance cache)');
  startWarmup();

  const shutdown = (signal: string) => {
    console.log(`[shutdown] ${signal} received`);
    stopWarmup();
    stopScheduler();
    stopMonitor();
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
