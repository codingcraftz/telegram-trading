import { Bot } from 'grammy';
import { getConfig } from '../config.js';
import { registerHandlers } from './handlers.js';
import { setBot } from '../notify/telegram.js';

export function createBot(): Bot {
  const cfg = getConfig();
  const bot = new Bot(cfg.TELEGRAM_BOT_TOKEN);
  registerHandlers(bot);
  setBot(bot);
  return bot;
}
