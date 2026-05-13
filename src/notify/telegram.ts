import type { Bot } from 'grammy';

let _bot: Bot | null = null;

export function setBot(bot: Bot) {
  _bot = bot;
}

export async function notify(chatId: number, text: string) {
  if (!_bot) {
    console.warn('[notify] bot not initialized');
    return;
  }
  try {
    await _bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('[notify] failed:', (err as Error).message);
  }
}
