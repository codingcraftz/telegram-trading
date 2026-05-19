// 텔레그램 봇 — 알림 송신 전용.
// 매매 명령 수신은 폐기됨. 사용자는 대시보드(웹)에서만 매매한다.
// 봇은 단순히 grammy Bot 인스턴스를 생성해 notify() 에 등록만 한다.
//
// 들어오는 메시지는 다 무시 (handlers 등록 안 함). 토큰을 빈 값으로 두면 봇 자체가 비활성.

import { Bot } from 'grammy';
import { getConfig } from '../config.js';
import { setBot } from '../notify/telegram.js';

export function createBot(): Bot {
  const cfg = getConfig();
  const bot = new Bot(cfg.TELEGRAM_BOT_TOKEN);
  setBot(bot);
  // 기존에 등록되어 있던 명령 메뉴 비우기 (텔레그램에서 명령 표시 안 되게)
  bot.api.setMyCommands([]).catch((err) => console.warn('[bot] clear commands failed:', err.message));
  return bot;
}
