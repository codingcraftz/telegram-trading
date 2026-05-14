import { Bot } from 'grammy';
import { getConfig } from '../config.js';
import { registerHandlers } from './handlers.js';
import { setBot } from '../notify/telegram.js';

// Telegram setMyCommands는 영문 a-z/0-9/underscore만 허용 — 한글 명령은 메뉴에 못 올림.
// 한글 위주 사용이라 메뉴 자체를 비우고 /도움말로 명령 안내.
export function createBot(): Bot {
  const cfg = getConfig();
  const bot = new Bot(cfg.TELEGRAM_BOT_TOKEN);
  registerHandlers(bot);
  setBot(bot);
  // 기존에 등록되어 있던 영어 메뉴 깨끗하게 비우기
  bot.api.setMyCommands([]).catch((err) => console.warn('[bot] clear commands failed:', err.message));
  return bot;
}
