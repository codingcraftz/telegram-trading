import type { Bot, Context } from 'grammy';
import { getConfig } from '../config.js';
import {
  listChatPositions,
  loadPendingIntent,
  markIntentConsumed,
  logTrade,
  type OrderSpec,
} from '../db/repo.js';
import { processUserMessage } from '../execution/confirm-flow.js';
import { placeBuyOrder, pollFill } from '../execution/order.js';
import { closePosition } from '../execution/close.js';
import { getBalance, type Market } from '../mcp/kis.js';
import { getAllTools } from '../mcp/client.js';

function whitelistMiddleware() {
  const allowed = new Set(getConfig().ALLOWED_CHAT_IDS);
  return async (ctx: Context, next: () => Promise<void>) => {
    const id = ctx.chat?.id;
    if (!id || !allowed.has(id)) {
      console.warn('[bot] rejected chat_id', id);
      return;
    }
    await next();
  };
}

const HELP = `🤖 KIS 자연어 매매 봇

자연어 매매:
  "삼성전자 지금호가 3개 아래 매수, TP 5% SL 3%, 시드 10%"
  "애플 1000달러어치 사줘"
  "SK하이닉스 10만원어치 사줘"
  "내 잔고 알려줘"
  "삼성전자 현재가"

명령어:
  /help - 이 도움말
  /status - 봇 상태 (모드/MCP/포지션 수)
  /balance [krx|nasdaq|...] - 국내(기본) 또는 해외 잔고
  /positions - 보유 포지션
  /confirm <id> - 제안된 주문 실행
  /cancel <id> - 제안된 주문 취소
  /close <position_id> - 보유 포지션 청산 (국내=시장가, 해외=지정가 진입가)

⚠️ 주문은 /confirm 받기 전까진 실행되지 않습니다.`;

const MARKET_FROM_INPUT: Record<string, Market> = {
  krx: 'KRX',
  국내: 'KRX',
  nasdaq: 'NASDAQ',
  나스닥: 'NASDAQ',
  nyse: 'NYSE',
  amex: 'AMEX',
  tse: 'TSE',
  hkex: 'HKEX',
  sse: 'SSE',
  szse: 'SZSE',
  hnx: 'HNX',
  hsx: 'HSX',
};

export function registerHandlers(bot: Bot) {
  bot.use(whitelistMiddleware());

  bot.command('start', async (ctx) => {
    await ctx.reply(HELP);
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(HELP);
  });

  bot.command('status', async (ctx) => {
    const cfg = getConfig();
    const tools = getAllTools();
    const list = listChatPositions(ctx.chat!.id);
    const open = list.filter((p) => p.state === 'open').length;
    const pending = list.filter((p) => p.state === 'pending').length;
    const closing = list.filter((p) => p.state === 'closing').length;
    await ctx.reply(
      `📊 상태\n` +
        `• 모드: ${cfg.MODE} (env_dv=${cfg.MODE === 'paper' ? 'demo' : 'real'})\n` +
        `• 모델: ${cfg.GEMINI_MODEL}\n` +
        `• MCP 도구: ${tools.length}개 (${tools.map((t) => t.name).join(', ')})\n` +
        `• 포지션: open=${open}, pending=${pending}, closing=${closing}\n` +
        `• 한도: 거래 ${cfg.MAX_TRADE_KRW.toLocaleString()}원 / 보유 ${cfg.MAX_OPEN_POSITIONS}종목 / 일손실 ${cfg.DAILY_LOSS_KRW.toLocaleString()}원`,
    );
  });

  bot.command('balance', async (ctx) => {
    const arg = ctx.match?.trim().toLowerCase() ?? '';
    const market = (MARKET_FROM_INPUT[arg] || 'KRX') as Market;
    try {
      const res = await getBalance(market);
      const text = JSON.stringify(res, null, 2).slice(0, 3500);
      await ctx.reply(`잔고 (${market}):\n<pre>${text}</pre>`, { parse_mode: 'HTML' });
    } catch (err) {
      await ctx.reply(`❌ 잔고 조회 실패: ${(err as Error).message}`);
    }
  });

  bot.command('positions', async (ctx) => {
    const list = listChatPositions(ctx.chat!.id);
    if (list.length === 0) {
      await ctx.reply('보유/대기 포지션 없음');
      return;
    }
    const lines = list.map(
      (p) =>
        `• [${p.state}] ${p.symbolName} (${p.market}/${p.symbolCode}) ${p.quantity}주` +
        (p.avgPrice ? ` @ ${p.avgPrice.toLocaleString()}` : '') +
        ` (id: ${p.id})` +
        (p.tpPrice ? `\n   TP ${p.tpPrice.toLocaleString()}` : '') +
        (p.slPrice ? ` / SL ${p.slPrice.toLocaleString()}` : ''),
    );
    await ctx.reply(lines.join('\n'));
  });

  bot.command('confirm', async (ctx) => {
    const id = ctx.match?.trim();
    if (!id) {
      await ctx.reply('사용: /confirm <id>');
      return;
    }
    const intent = loadPendingIntent(id, ctx.chat!.id);
    if (!intent) {
      await ctx.reply('해당 제안을 찾을 수 없습니다.');
      return;
    }
    if (intent.consumedAt) {
      await ctx.reply('이미 처리된 제안입니다.');
      return;
    }
    if (intent.expiresAt < Date.now()) {
      await ctx.reply('만료된 제안입니다. 다시 요청해 주세요.');
      return;
    }
    let spec: OrderSpec;
    try {
      spec = JSON.parse(intent.orderSpecJson);
    } catch {
      await ctx.reply('제안 데이터 파싱 실패');
      return;
    }

    if (spec.action !== 'buy') {
      await ctx.reply('v1은 매수 제안만 /confirm 지원합니다. (매도는 /close 사용)');
      return;
    }

    markIntentConsumed(id);
    await ctx.reply('⏳ 주문 접수 중…');

    try {
      const { positionId, orderId } = await placeBuyOrder({
        chatId: ctx.chat!.id,
        spec,
      });
      await ctx.reply(`📨 주문번호 ${orderId} (position: ${positionId})\n체결 폴링 중…`);
      pollFill({
        chatId: ctx.chat!.id,
        positionId,
        market: spec.market as Market,
        orderId,
        expectedQty: spec.quantity,
      }).catch((err) => console.error('[pollFill] failed', err));
    } catch (err) {
      logTrade({
        chatId: ctx.chat!.id,
        kind: 'order_error',
        payload: { error: (err as Error).message },
      });
      await ctx.reply(`❌ 주문 실패: ${(err as Error).message}`);
    }
  });

  bot.command('cancel', async (ctx) => {
    const id = ctx.match?.trim();
    if (!id) {
      await ctx.reply('사용: /cancel <id>');
      return;
    }
    const intent = loadPendingIntent(id, ctx.chat!.id);
    if (!intent) {
      await ctx.reply('해당 제안을 찾을 수 없습니다.');
      return;
    }
    if (intent.consumedAt) {
      await ctx.reply('이미 처리된 제안입니다.');
      return;
    }
    markIntentConsumed(id);
    await ctx.reply('🗑️ 제안 취소됨');
  });

  bot.command('close', async (ctx) => {
    const id = ctx.match?.trim();
    if (!id) {
      await ctx.reply('사용: /close <position_id>');
      return;
    }
    await ctx.reply('⏳ 청산 중…');
    try {
      await closePosition({ positionId: id, reason: 'manual' });
    } catch (err) {
      await ctx.reply(`❌ 청산 실패: ${(err as Error).message}`);
    }
  });

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return;
    await ctx.replyWithChatAction('typing');
    try {
      const out = await processUserMessage({ chatId: ctx.chat!.id, text });
      if (out.kind === 'reply') {
        await ctx.reply(out.text);
      } else {
        await ctx.reply(out.summary);
      }
    } catch (err) {
      console.error('[message] error', err);
      await ctx.reply(`❌ 처리 실패: ${(err as Error).message}`);
    }
  });
}
