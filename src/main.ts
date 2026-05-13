import { getConfig } from './config.js';
import { ensureSchema } from './db/migrate.js';
import { connectMcp, closeMcp } from './mcp/client.js';
import { createBot } from './bot/index.js';
import { reconcileOnBoot } from './monitor/recovery.js';
import { startMonitor, stopMonitor } from './monitor/worker.js';

async function main() {
  const cfg = getConfig();
  console.log('[boot] mode =', cfg.MODE);

  console.log('[boot] db init');
  ensureSchema();

  console.log('[boot] connecting MCP at', cfg.KIS_MCP_URL);
  await connectMcp();
  console.log('[boot] MCP connected');

  console.log('[boot] reconciling positions');
  await reconcileOnBoot();

  console.log('[boot] starting monitor');
  startMonitor();

  console.log('[boot] starting telegram bot');
  const bot = createBot();

  const shutdown = async (signal: string) => {
    console.log(`[shutdown] ${signal} received`);
    stopMonitor();
    try {
      await bot.stop();
    } catch {}
    await closeMcp();
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  await bot.start({ onStart: (me) => console.log('[bot] started as @' + me.username) });
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
