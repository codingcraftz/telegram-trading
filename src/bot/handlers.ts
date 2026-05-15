import type { Bot, Context } from 'grammy';
import { InlineKeyboard, Keyboard } from 'grammy';
import { getConfig } from '../config.js';
import {
  listChatPositions,
  loadPendingIntent,
  markIntentConsumed,
  logTrade,
  cancelReservation,
  confirmReservation,
  getReservation,
  type OrderSpec,
} from '../db/repo.js';
import { formatKst } from '../scheduler/calendar.js';
import { placeBuyOrder, pollFill } from '../execution/order.js';
import { closePosition } from '../execution/close.js';
import { placeOrder, type Market } from '../mcp/kis.js';
// KIS는 REST 직접 호출 (MCP 제거됨)
import { tryFastPath } from '../fastpath/index.js';
import { buildBalanceView } from '../fastpath/balance.js';
import { buildPositionsView } from '../fastpath/positions.js';
import { buildOrdersView } from '../fastpath/orders.js';
import { cancelKrxOrder } from '../mcp/kis.js';
import { checkKisOk, parseMcpResult } from '../fastpath/extract.js';
import {
  handleMarketOpenCommand,
  handleMarketOpenReserve,
  tryMatchMarketOpen,
} from '../fastpath/market-open.js';
import {
  buildChartIntervalMenu,
  buildChartMainMenu,
  buildChartSearchPrompt,
  buildChartSearchResults,
  handleChart,
  tryMatchChart,
} from '../fastpath/chart.js';
import {
  buildQuoteMainMenu,
  buildQuoteResult,
  buildQuoteSearchPrompt,
  buildQuoteSearchResults,
} from '../fastpath/quote.js';
import {
  buildBuyAmountMenu,
  buildBuyConfirmAndRegister,
  buildBuyDirectInputPrompt,
  buildBuyNowConfirmAndRegister,
  buildBuyNowQtyMenu,
  buildBuyNowSlMenu,
  buildBuyNowTpMenu,
  buildBuySearchPrompt,
  buildBuySearchResults,
  buildBuyStrategyMenu,
  buildBuySymbolMenu,
  buildSellConfirmAndRegister,
  buildSellQtyMenu,
  buildSellSymbolMenu,
  buildTradeMainMenu,
  parseBuyAmount,
  type BuyAmountSpec,
} from '../fastpath/trade.js';

// handlers.ts 안 인라인 헬퍼 — TP/SL 라벨
function pctOrOffLabel(v: string, prefix: '+' | '-'): string {
  return v === 'off' ? '없음' : `${prefix}${v}%`;
}
import { getChatMeta } from './state.js';
import {
  applyFieldChange,
  buildEditField,
  buildMarketOpenStrategyView,
  buildStrategyAddPlaceholder,
  buildStrategyMainMenu,
} from '../fastpath/strategy.js';
import { InputFile } from 'grammy';
import {
  buildWatchlistAddPrompt,
  buildWatchlistMenu,
  buildWatchlistRemoveMenu,
  handleWatchlistAdd,
  handleWatchlistAddCallback,
  handleWatchlistRemove,
  removeWatchlistOne,
  renderWatchlist,
} from '../fastpath/watchlist.js';
import { resolveSymbol, searchSymbolCandidates } from '../fastpath/symbol.js';
import { clearChatMode, getChatMode, setChatMode } from './state.js';
import { getMode, setMode } from '../runtime.js';

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

// 메인 단축 버튼. /시작, /도움말 호출 시 같이 보냄.
const MAIN_KEYBOARD = new Keyboard()
  .text('⭐ 관심종목').text('💵 잔고').row()
  .text('🔍 시세조회').text('📈 차트').row()
  .text('💼 거래').text('📋 대기').row()
  .text('📊 포지션').text('🧩 전략').row()
  .text('📖 도움말')
  .resized()
  .persistent();

const HELP = `🤖 KIS 한글 매매 봇

⚡ 즉시 주문 (정규장):
  "삼성전자 5주 매수" / "삼성전자 10만원어치 매수"
  "삼성전자 전량 매도"
  ※ 장 외/시간외 시간엔 옵션 메시지로 선택지 제공

📅 다음 날 시가매매 예약:
  "삼성전자 시가매매 10주" · "150만원" · "20%"
  /시가매매 set gap=5 tp=5 sl=3   - 갭가드/TP/SL 갱신

📊 내 자산 보기:
  💵 잔고  — 계좌 전체 보유 종목 + 현재가/손익
  📊 포지션 — 봇이 만든 거래 (TP/SL 추적)
  📋 대기  — 미체결 + 시가매매 예약 + 즉시주문 대기 통합
  📈 차트  — PNG (1m/5m/15m/1h/4h/1d)

⭐ 관심종목:
  /관심종목                  - 목록
  /관심종목추가 삼성전자     - 추가 (여러 후보면 버튼)
  /관심종목제거 1, 2         - 번호로 일괄 제거

📋 명령:
  /도움말 /상태 /모의투자 /실전
  /잔고 /포지션 /대기 /예약
  /확정 <id>  /취소 <id>  /청산 <position_id>

🔖 아이콘 컨벤션:
  ✅성공  ❌실패  ⌛만료  ⏳처리중
  📨접수  📤매도  📥매수  🎯TP  🛑SL  ✋수동  📅예약

⚠️ 주문은 /확정 받기 전까진 실행되지 않습니다.`;

export function registerHandlers(bot: Bot) {
  bot.use(whitelistMiddleware());

  bot.command('start', async (ctx) => {
    await ctx.reply(HELP, { reply_markup: MAIN_KEYBOARD });
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(HELP, { reply_markup: MAIN_KEYBOARD });
  });

  bot.command('status', async (ctx) => {
    const cfg = getConfig();
    const list = listChatPositions(ctx.chat!.id);
    const open = list.filter((p) => p.state === 'open').length;
    const pending = list.filter((p) => p.state === 'pending').length;
    const closing = list.filter((p) => p.state === 'closing').length;
    const mode = getMode();
    await ctx.reply(
      `📊 상태\n` +
        `• 모드: <b>${mode === 'paper' ? '모의투자(paper)' : '실전(real)'}</b> (env_dv=${mode === 'paper' ? 'demo' : 'real'})\n` +
        `• KIS API: REST 직접 호출\n` +
        `• 포지션: open=${open}, pending=${pending}, closing=${closing}\n` +
        `• 한도: 거래 ${cfg.MAX_TRADE_KRW.toLocaleString()}원\n` +
        `\n전환: /모의투자  /라이브계좌`,
      { parse_mode: 'HTML' },
    );
  });

  bot.command(['paper', 'demo'], async (ctx) => {
    setMode('paper');
    await ctx.reply('🧪 <b>모의투자 모드</b>로 전환됨 (env_dv=demo)', {
      parse_mode: 'HTML',
    });
  });

  bot.command(['real', 'live'], async (ctx) => {
    setMode('real');
    await ctx.reply(
      '⚠️ <b>실전 모드</b>로 전환됨 (env_dv=real)\n실제 자금 거래입니다. 주의하세요.',
      { parse_mode: 'HTML' },
    );
  });

  bot.command('balance', async (ctx) => {
    try {
      const v = await buildBalanceView();
      await ctx.reply(v.text, { reply_markup: v.kb, parse_mode: 'HTML' });
    } catch (err) {
      await ctx.reply(`❌ 잔고 조회 실패: ${(err as Error).message}`);
    }
  });

  bot.command(['reservations', 'orders', 'pending'], async (ctx) => {
    try {
      const v = await buildOrdersView(ctx.chat!.id);
      await ctx.reply(v.text, { reply_markup: v.kb, parse_mode: 'HTML' });
    } catch (err) {
      await ctx.reply(`❌ 대기 조회 실패: ${(err as Error).message}`);
    }
  });

  bot.command('positions', async (ctx) => {
    try {
      const v = await buildPositionsView(ctx.chat!.id);
      await ctx.reply(v.text, { reply_markup: v.kb, parse_mode: 'HTML' });
    } catch (err) {
      await ctx.reply(`❌ 포지션 조회 실패: ${(err as Error).message}`);
    }
  });

  // 텍스트 응답으로 confirm/cancel 처리 (callback과 공통)
  async function runConfirm(chatId: number, id: string): Promise<string> {
    // 1) 시가매매 예약 우선 (awaiting_confirm 상태인 경우)
    const reservation = getReservation(id, chatId);
    if (reservation) {
      if (reservation.state === 'awaiting_confirm') {
        if (reservation.expiresAt < Date.now()) {
          return '⌛ 만료된 예약 제안입니다. 다시 요청해 주세요.';
        }
        const ok = confirmReservation(id);
        if (!ok) return '예약 확정 실패 (이미 처리되었을 수 있음).';
        return (
          `📅 시가매매 예약 확정\n` +
          `${reservation.symbolName} (${reservation.symbolCode}) — ${formatKst(new Date(reservation.scheduledFor))} 발주 예정\n` +
          `취소: /cancel ${id}`
        );
      }
      return `예약 상태: ${reservation.state} — 추가 처리 불가`;
    }

    // 2) 즉시 주문 제안 (pendingIntents)
    const intent = loadPendingIntent(id, chatId);
    if (!intent) return '해당 제안을 찾을 수 없습니다.';
    if (intent.consumedAt) return '이미 처리된 제안입니다.';
    if (intent.expiresAt < Date.now()) return '⌛ 만료된 제안입니다. 다시 요청해 주세요.';

    let spec: OrderSpec;
    try {
      spec = JSON.parse(intent.orderSpecJson);
    } catch {
      return '제안 데이터 파싱 실패';
    }
    markIntentConsumed(id);

    if (spec.action === 'buy') {
      try {
        const { positionId, orderId } = await placeBuyOrder({ chatId, spec });
        pollFill({
          chatId,
          positionId,
          market: spec.market as Market,
          orderId,
          expectedQty: spec.quantity,
          tpPct: spec.tp_pct ?? null,
          slPct: spec.sl_pct ?? null,
        }).catch((err) => console.error('[pollFill] failed', err));
        return `📨 매수 주문 접수 (#${orderId})\n포지션 ${positionId} · 체결 확인 중…`;
      } catch (err) {
        logTrade({ chatId, kind: 'order_error', payload: { error: (err as Error).message } });
        return `❌ 매수 실패: ${(err as Error).message}`;
      }
    }

    // sell
    try {
      const result = await placeOrder({
        market: spec.market as Market,
        side: 'sell',
        code: spec.symbol_code,
        quantity: spec.quantity,
        orderType: spec.order_type,
        price: spec.price,
      });
      // KIS 응답 rt_cd 체크 — '0'이 아니면 거절
      const parsed = parseMcpResult(result);
      const kisOk = checkKisOk(parsed);
      if (!kisOk.ok) {
        logTrade({ chatId, kind: 'sell_rejected', payload: { spec, msg: kisOk.message } });
        return `❌ 매도 거절 (KIS): ${kisOk.message ?? '알 수 없는 오류'}`;
      }
      const ext = (obj: unknown, ...keys: string[]): string | undefined => {
        if (!obj || typeof obj !== 'object') return undefined;
        const o = obj as Record<string, unknown>;
        const lc = keys.map((k) => k.toLowerCase());
        for (const k of Object.keys(o)) {
          if (lc.includes(k.toLowerCase()) && typeof o[k] === 'string' && (o[k] as string).trim()) {
            return o[k] as string;
          }
        }
        for (const k of Object.keys(o)) {
          if (o[k] && typeof o[k] === 'object') {
            const r = ext(o[k], ...keys);
            if (r) return r;
          } else if (typeof o[k] === 'string' && (o[k] as string).startsWith('{')) {
            try {
              const r = ext(JSON.parse(o[k] as string), ...keys);
              if (r) return r;
            } catch {}
          }
        }
        return undefined;
      };
      const orderId = ext(result, 'ODNO', 'odno', 'ord_no') ?? `sell-${Date.now()}`;
      logTrade({ chatId, kind: 'sell_submitted', payload: { orderId, spec } });
      return `📤 매도 주문 접수 (#${orderId})\n${spec.symbol_name} ${spec.quantity}주 ${spec.order_type === 'market' ? '시장가' : `${spec.price?.toLocaleString()}원`}`;
    } catch (err) {
      logTrade({ chatId, kind: 'order_error', payload: { error: (err as Error).message } });
      return `❌ 매도 실패: ${(err as Error).message}`;
    }
  }

  function runCancel(chatId: number, id: string): string {
    // 1) 시가매매 예약 우선
    const reservation = getReservation(id, chatId);
    if (reservation) {
      if (
        reservation.state === 'awaiting_confirm' ||
        reservation.state === 'pending'
      ) {
        const ok = cancelReservation(id);
        return ok ? '🗑️ 예약 취소됨' : '취소 실패';
      }
      return `예약 상태: ${reservation.state} — 추가 처리 불가`;
    }
    // 2) 즉시 주문 제안
    const intent = loadPendingIntent(id, chatId);
    if (!intent) return '해당 제안을 찾을 수 없습니다.';
    if (intent.consumedAt) return '이미 처리된 제안입니다.';
    markIntentConsumed(id);
    return '🗑️ 제안 취소됨';
  }

  bot.command('confirm', async (ctx) => {
    const id = ctx.match?.trim();
    if (!id) {
      await ctx.reply('사용: /confirm <id>');
      return;
    }
    const reply = await runConfirm(ctx.chat!.id, id);
    await ctx.reply(reply);
  });

  bot.command('cancel', async (ctx) => {
    const id = ctx.match?.trim();
    if (!id) {
      await ctx.reply('사용: /cancel <id>');
      return;
    }
    await ctx.reply(runCancel(ctx.chat!.id, id));
  });

  // 인라인 버튼 콜백
  bot.callbackQuery(/^(confirm|cancel):(.+)$/, async (ctx) => {
    const m = ctx.callbackQuery.data!.match(/^(confirm|cancel):(.+)$/);
    if (!m) {
      await ctx.answerCallbackQuery();
      return;
    }
    const action = m[1] as 'confirm' | 'cancel';
    const id = m[2]!;
    const chatId = ctx.chat!.id;

    // 빠른 응답 (인디케이터 해제)
    await ctx.answerCallbackQuery(action === 'confirm' ? '주문 접수 중…' : '취소 중…');

    const reply =
      action === 'confirm'
        ? await runConfirm(chatId, id)
        : runCancel(chatId, id);

    // 원본 메시지의 버튼 제거 + 결과 표시
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    } catch {}
    await ctx.reply(reply);
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

  // /시가매매 — 셋업 메뉴 / 갱신
  bot.command(['시가매매', 'marketopen'], async (ctx) => {
    const reply = await handleMarketOpenCommand(ctx.chat!.id, ctx.match?.trim() ?? '');
    await ctx.reply(reply, { parse_mode: 'HTML' });
  });

  // 관심종목
  bot.command(['관심종목', 'watchlist'], async (ctx) => {
    await ctx.reply(renderWatchlist(ctx.chat!.id), { parse_mode: 'HTML' });
  });

  bot.command(['관심종목추가', 'watchlist_add', 'wladd'], async (ctx) => {
    const r = await handleWatchlistAdd(ctx.chat!.id, ctx.match?.trim() ?? '');
    if (r.kind === 'choices') {
      await ctx.reply(r.text, { reply_markup: r.kb, parse_mode: 'HTML' });
    } else {
      await ctx.reply(r.text, { parse_mode: 'HTML' });
    }
  });

  bot.command(['관심종목제거', 'watchlist_remove', 'wlrm'], async (ctx) => {
    await ctx.reply(handleWatchlistRemove(ctx.chat!.id, ctx.match?.trim() ?? ''), {
      parse_mode: 'HTML',
    });
  });

  // 관심종목 추가 — 검색 결과 InlineKeyboard 콜백
  bot.callbackQuery(/^wladd:(\d{6}):(.+)$/, async (ctx) => {
    const m = ctx.callbackQuery.data!.match(/^wladd:(\d{6}):(.+)$/);
    if (!m) {
      await ctx.answerCallbackQuery();
      return;
    }
    const [, code, name] = m;
    await ctx.answerCallbackQuery('추가 중…');
    const text = handleWatchlistAddCallback(ctx.chat!.id, code!, name!);
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    } catch {}
    await ctx.reply(text, { parse_mode: 'HTML' });
  });

  // 관심종목 메뉴 callbacks
  bot.callbackQuery('wlmenu:add', async (ctx) => {
    await ctx.answerCallbackQuery();
    setChatMode(ctx.chat!.id, 'awaiting_watchlist_add');
    const p = buildWatchlistAddPrompt();
    try {
      await ctx.editMessageText(p.text, { reply_markup: p.kb, parse_mode: 'HTML' });
    } catch {
      await ctx.reply(p.text, { reply_markup: p.kb, parse_mode: 'HTML' });
    }
  });

  bot.callbackQuery('wlmenu:rm', async (ctx) => {
    await ctx.answerCallbackQuery();
    const m = buildWatchlistRemoveMenu(ctx.chat!.id);
    try {
      await ctx.editMessageText(m.text, { reply_markup: m.kb });
    } catch {
      await ctx.reply(m.text, { reply_markup: m.kb });
    }
  });

  bot.callbackQuery('wlmenu:back', async (ctx) => {
    await ctx.answerCallbackQuery();
    clearChatMode(ctx.chat!.id);
    const m = buildWatchlistMenu(ctx.chat!.id);
    try {
      await ctx.editMessageText(m.text, { reply_markup: m.kb, parse_mode: 'HTML' });
    } catch {
      await ctx.reply(m.text, { reply_markup: m.kb, parse_mode: 'HTML' });
    }
  });

  // ===== 차트 메뉴 callbacks =====

  // ===== 시세조회 메뉴 callbacks =====

  bot.callbackQuery('qm:back', async (ctx) => {
    await ctx.answerCallbackQuery();
    clearChatMode(ctx.chat!.id);
    const m = buildQuoteMainMenu(ctx.chat!.id);
    try {
      await ctx.editMessageText(m.text, { reply_markup: m.kb, parse_mode: 'HTML' });
    } catch {
      await ctx.reply(m.text, { reply_markup: m.kb, parse_mode: 'HTML' });
    }
  });

  bot.callbackQuery('qm:search', async (ctx) => {
    await ctx.answerCallbackQuery();
    setChatMode(ctx.chat!.id, 'awaiting_quote_symbol');
    const p = buildQuoteSearchPrompt();
    try {
      await ctx.editMessageText(p.text, { reply_markup: p.kb, parse_mode: 'HTML' });
    } catch {
      await ctx.reply(p.text, { reply_markup: p.kb, parse_mode: 'HTML' });
    }
  });

  bot.callbackQuery(/^qm:pick:(\d{6})$/, async (ctx) => {
    const m = ctx.callbackQuery.data!.match(/^qm:pick:(\d{6})$/);
    if (!m) {
      await ctx.answerCallbackQuery();
      return;
    }
    const code = m[1]!;
    await ctx.answerCallbackQuery('시세 조회 중…');
    try {
      const r = await buildQuoteResult(code);
      try {
        await ctx.editMessageText(r.text, { reply_markup: r.kb, parse_mode: 'HTML' });
      } catch {
        await ctx.reply(r.text, { reply_markup: r.kb, parse_mode: 'HTML' });
      }
    } catch (err) {
      await ctx.reply(`❌ 시세 조회 실패: ${(err as Error).message}`);
    }
  });

  bot.callbackQuery('chartmenu:search', async (ctx) => {
    await ctx.answerCallbackQuery();
    setChatMode(ctx.chat!.id, 'awaiting_chart_symbol');
    const p = buildChartSearchPrompt();
    try {
      await ctx.editMessageText(p.text, { reply_markup: p.kb, parse_mode: 'HTML' });
    } catch {
      await ctx.reply(p.text, { reply_markup: p.kb, parse_mode: 'HTML' });
    }
  });

  bot.callbackQuery('chartmenu:back', async (ctx) => {
    await ctx.answerCallbackQuery();
    clearChatMode(ctx.chat!.id);
    const menu = buildChartMainMenu(ctx.chat!.id);
    try {
      await ctx.editMessageText(menu.text, { reply_markup: menu.kb, parse_mode: 'HTML' });
    } catch {
      await ctx.reply(menu.text, { reply_markup: menu.kb, parse_mode: 'HTML' });
    }
  });

  // 종목 선택 → 분봉 선택 화면
  bot.callbackQuery(/^chartpick:(\d{6})$/, async (ctx) => {
    const m = ctx.callbackQuery.data!.match(/^chartpick:(\d{6})$/);
    if (!m) {
      await ctx.answerCallbackQuery();
      return;
    }
    const code = m[1]!;
    await ctx.answerCallbackQuery();
    const sym = await resolveSymbol(code);
    const name = sym?.name ?? code;
    const menu = buildChartIntervalMenu(code, name);
    try {
      await ctx.editMessageText(menu.text, { reply_markup: menu.kb, parse_mode: 'HTML' });
    } catch {
      await ctx.reply(menu.text, { reply_markup: menu.kb, parse_mode: 'HTML' });
    }
  });

  // 분봉 선택 → 차트 PNG
  bot.callbackQuery(/^chartint:(\d{6}):(1m|5m|15m|1h|4h|1d)$/, async (ctx) => {
    const m = ctx.callbackQuery.data!.match(/^chartint:(\d{6}):(1m|5m|15m|1h|4h|1d)$/);
    if (!m) {
      await ctx.answerCallbackQuery();
      return;
    }
    const code = m[1]!;
    const interval = m[2] as '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
    await ctx.answerCallbackQuery('차트 생성 중…');
    try {
      const r = await handleChart({ sym: code, interval });
      if (typeof r === 'string') {
        await ctx.reply(r);
      } else {
        await ctx.replyWithPhoto(new InputFile(r.png, 'chart.png'), { caption: r.caption });
      }
    } catch (err) {
      await ctx.reply(`❌ 차트 생성 실패: ${(err as Error).message}`);
    }
  });

  // ===== 전략 메뉴 callbacks =====

  bot.callbackQuery('st:main', async (ctx) => {
    await ctx.answerCallbackQuery();
    const m = buildStrategyMainMenu();
    try {
      await ctx.editMessageText(m.text, { reply_markup: m.kb, parse_mode: 'HTML' });
    } catch {
      await ctx.reply(m.text, { reply_markup: m.kb, parse_mode: 'HTML' });
    }
  });

  bot.callbackQuery('st:mo', async (ctx) => {
    await ctx.answerCallbackQuery();
    const m = buildMarketOpenStrategyView(ctx.chat!.id);
    try {
      await ctx.editMessageText(m.text, { reply_markup: m.kb, parse_mode: 'HTML' });
    } catch {
      await ctx.reply(m.text, { reply_markup: m.kb, parse_mode: 'HTML' });
    }
  });

  bot.callbackQuery('st:add', async (ctx) => {
    await ctx.answerCallbackQuery();
    const m = buildStrategyAddPlaceholder();
    try {
      await ctx.editMessageText(m.text, { reply_markup: m.kb, parse_mode: 'HTML' });
    } catch {
      await ctx.reply(m.text, { reply_markup: m.kb, parse_mode: 'HTML' });
    }
  });

  bot.callbackQuery(/^st:mo:(gap|tp|sl|trail)$/, async (ctx) => {
    const m = ctx.callbackQuery.data!.match(/^st:mo:(gap|tp|sl|trail)$/);
    if (!m) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    const field = m[1]! as 'gap' | 'tp' | 'sl' | 'trail';
    const v = buildEditField(field);
    try {
      await ctx.editMessageText(v.text, { reply_markup: v.kb, parse_mode: 'HTML' });
    } catch {
      await ctx.reply(v.text, { reply_markup: v.kb, parse_mode: 'HTML' });
    }
  });

  bot.callbackQuery(/^st:mo:set:(gap|tp|sl|trail):(\d+(?:\.\d+)?|off)$/, async (ctx) => {
    const m = ctx.callbackQuery.data!.match(/^st:mo:set:(gap|tp|sl|trail):(\d+(?:\.\d+)?|off)$/);
    if (!m) {
      await ctx.answerCallbackQuery();
      return;
    }
    const field = m[1]! as 'gap' | 'tp' | 'sl' | 'trail';
    const val = m[2]!;
    const r = applyFieldChange(ctx.chat!.id, field, val);
    await ctx.answerCallbackQuery(r.ok ? r.message : `❌ ${r.message}`);
    // 시가매매 화면으로 복귀
    const view = buildMarketOpenStrategyView(ctx.chat!.id);
    try {
      await ctx.editMessageText(view.text, { reply_markup: view.kb, parse_mode: 'HTML' });
    } catch {
      await ctx.reply(view.text, { reply_markup: view.kb, parse_mode: 'HTML' });
    }
  });

  // ===== 거래 흐름 callbacks =====

  // [💼 거래] 메인
  bot.callbackQuery('tr:back', async (ctx) => {
    await ctx.answerCallbackQuery();
    clearChatMode(ctx.chat!.id);
    const m = buildTradeMainMenu();
    try {
      await ctx.editMessageText(m.text, { reply_markup: m.kb, parse_mode: 'HTML' });
    } catch {
      await ctx.reply(m.text, { reply_markup: m.kb, parse_mode: 'HTML' });
    }
  });

  // 매수 진입
  bot.callbackQuery('tr:buy', async (ctx) => {
    await ctx.answerCallbackQuery();
    clearChatMode(ctx.chat!.id);
    const m = buildBuySymbolMenu(ctx.chat!.id);
    try {
      await ctx.editMessageText(m.text, { reply_markup: m.kb, parse_mode: 'HTML' });
    } catch {
      await ctx.reply(m.text, { reply_markup: m.kb, parse_mode: 'HTML' });
    }
  });

  // 매수 검색
  bot.callbackQuery('tr:bsearch', async (ctx) => {
    await ctx.answerCallbackQuery();
    setChatMode(ctx.chat!.id, 'awaiting_trade_buy_search');
    const p = buildBuySearchPrompt();
    try {
      await ctx.editMessageText(p.text, { reply_markup: p.kb, parse_mode: 'HTML' });
    } catch {
      await ctx.reply(p.text, { reply_markup: p.kb, parse_mode: 'HTML' });
    }
  });

  // 매수 종목 선택 → 전략 메뉴
  bot.callbackQuery(/^tr:bs:(\d{6})$/, async (ctx) => {
    const m = ctx.callbackQuery.data!.match(/^tr:bs:(\d{6})$/);
    if (!m) {
      await ctx.answerCallbackQuery();
      return;
    }
    const code = m[1]!;
    await ctx.answerCallbackQuery();
    const sym = await resolveSymbol(code);
    const name = sym?.name ?? code;
    const menu = buildBuyStrategyMenu(code, name);
    try {
      await ctx.editMessageText(menu.text, { reply_markup: menu.kb, parse_mode: 'HTML' });
    } catch {
      await ctx.reply(menu.text, { reply_markup: menu.kb, parse_mode: 'HTML' });
    }
  });

  // 매수 전략 선택 → mo는 금액 메뉴 / now는 TP 메뉴
  bot.callbackQuery(/^tr:bstr:(\d{6}):(mo|now)$/, async (ctx) => {
    const m = ctx.callbackQuery.data!.match(/^tr:bstr:(\d{6}):(mo|now)$/);
    if (!m) {
      await ctx.answerCallbackQuery();
      return;
    }
    const [, code, strategy] = m;
    await ctx.answerCallbackQuery();
    const sym = await resolveSymbol(code!);
    const name = sym?.name ?? code!;
    const menu =
      strategy === 'now'
        ? buildBuyNowTpMenu(code!, name)
        : buildBuyAmountMenu(code!, name, strategy!);
    try {
      await ctx.editMessageText(menu.text, { reply_markup: menu.kb, parse_mode: 'HTML' });
    } catch {
      await ctx.reply(menu.text, { reply_markup: menu.kb, parse_mode: 'HTML' });
    }
  });

  // 즉시매수 — TP 선택 → SL 메뉴 (% 또는 off)
  bot.callbackQuery(/^tr:bnow:tp:(\d{6}):(\d+(?:\.\d+)?|off)$/, async (ctx) => {
    const m = ctx.callbackQuery.data!.match(/^tr:bnow:tp:(\d{6}):(\d+(?:\.\d+)?|off)$/);
    if (!m) {
      await ctx.answerCallbackQuery();
      return;
    }
    const [, code, tp] = m;
    await ctx.answerCallbackQuery();
    const sym = await resolveSymbol(code!);
    const menu = buildBuyNowSlMenu(code!, sym?.name ?? code!, tp!);
    try {
      await ctx.editMessageText(menu.text, { reply_markup: menu.kb, parse_mode: 'HTML' });
    } catch {
      await ctx.reply(menu.text, { reply_markup: menu.kb, parse_mode: 'HTML' });
    }
  });

  // 즉시매수 — TP 직접 입력 모드 진입
  bot.callbackQuery(/^tr:bnow:tp:(\d{6}):input$/, async (ctx) => {
    const m = ctx.callbackQuery.data!.match(/^tr:bnow:tp:(\d{6}):input$/);
    if (!m) {
      await ctx.answerCallbackQuery();
      return;
    }
    const code = m[1]!;
    await ctx.answerCallbackQuery();
    setChatMode(ctx.chat!.id, 'awaiting_trade_buy_now_tp', { buyCode: code });
    await ctx.reply(
      '✏️ <b>TP % 직접 입력</b>\n채팅으로 % 입력 (예: <code>7.5</code> · <code>10</code>)\n' +
        '"<code>없음</code>" 입력 시 TP 끔.',
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('⬅️ 뒤로', `tr:bstr:${code}:now`),
      },
    );
  });

  // 즉시매수 — SL 선택 → 수량 메뉴 (% 또는 off, async)
  bot.callbackQuery(/^tr:bnow:sl:(\d{6}):(\d+(?:\.\d+)?|off):(\d+(?:\.\d+)?|off)$/, async (ctx) => {
    const m = ctx.callbackQuery.data!.match(/^tr:bnow:sl:(\d{6}):(\d+(?:\.\d+)?|off):(\d+(?:\.\d+)?|off)$/);
    if (!m) {
      await ctx.answerCallbackQuery();
      return;
    }
    const [, code, tp, sl] = m;
    await ctx.answerCallbackQuery('잔고 조회 중…');
    const sym = await resolveSymbol(code!);
    try {
      const menu = await buildBuyNowQtyMenu(code!, sym?.name ?? code!, tp!, sl!);
      try {
        await ctx.editMessageText(menu.text, { reply_markup: menu.kb, parse_mode: 'HTML' });
      } catch {
        await ctx.reply(menu.text, { reply_markup: menu.kb, parse_mode: 'HTML' });
      }
    } catch (err) {
      await ctx.reply(`❌ 수량 메뉴 로드 실패: ${(err as Error).message}`);
    }
  });

  // 즉시매수 — SL 직접 입력 모드 진입
  bot.callbackQuery(/^tr:bnow:sl:(\d{6}):(\d+(?:\.\d+)?|off):input$/, async (ctx) => {
    const m = ctx.callbackQuery.data!.match(/^tr:bnow:sl:(\d{6}):(\d+(?:\.\d+)?|off):input$/);
    if (!m) {
      await ctx.answerCallbackQuery();
      return;
    }
    const [, code, tp] = m;
    await ctx.answerCallbackQuery();
    setChatMode(ctx.chat!.id, 'awaiting_trade_buy_now_sl', {
      buyCode: code!,
      buyNowTp: tp!,
    });
    await ctx.reply(
      '✏️ <b>SL % 직접 입력</b>\n채팅으로 % 입력 (예: <code>2.5</code> · <code>3</code>)\n' +
        '"<code>없음</code>" 입력 시 SL 끔.',
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('⬅️ 뒤로', `tr:bnow:tp:${code}:${tp}`),
      },
    );
  });

  // 즉시매수 — 수량 % 선택 → 확정 화면
  bot.callbackQuery(/^tr:bnow:qty:(\d{6}):(\d+|off):(\d+|off):p(\d+)$/, async (ctx) => {
    const m = ctx.callbackQuery.data!.match(/^tr:bnow:qty:(\d{6}):(\d+|off):(\d+|off):p(\d+)$/);
    if (!m) {
      await ctx.answerCallbackQuery();
      return;
    }
    const [, code, tp, sl, pctStr] = m;
    await ctx.answerCallbackQuery('등록 중…');
    const r = await buildBuyNowConfirmAndRegister({
      chatId: ctx.chat!.id,
      code: code!,
      tp: tp!,
      sl: sl!,
      amount: { mode: 'percent', value: Number(pctStr) },
    });
    if ('error' in r) {
      await ctx.reply(`❌ ${r.error}`);
      return;
    }
    const kb = new InlineKeyboard()
      .text('✅ 매수 발주', `confirm:${r.intentId}`)
      .text('❌ 취소', `cancel:${r.intentId}`);
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    } catch {}
    await ctx.reply(r.text, { reply_markup: kb, parse_mode: 'HTML' });
  });

  // 즉시매수 — 수량 직접 입력 모드 진입
  bot.callbackQuery(/^tr:bnow:qty:(\d{6}):(\d+|off):(\d+|off):input$/, async (ctx) => {
    const m = ctx.callbackQuery.data!.match(/^tr:bnow:qty:(\d{6}):(\d+|off):(\d+|off):input$/);
    if (!m) {
      await ctx.answerCallbackQuery();
      return;
    }
    const [, code, tp, sl] = m;
    await ctx.answerCallbackQuery();
    setChatMode(ctx.chat!.id, 'awaiting_trade_buy_now_amount', {
      buyCode: code!,
      buyNowTp: tp!,
      buyNowSl: sl!,
    });
    await ctx.reply(
      `✏️ <b>즉시매수 — 수량/금액 직접 입력</b>\n` +
        `TP ${pctOrOffLabel(tp!, '+')} · SL ${pctOrOffLabel(sl!, '-')}\n` +
        '예: <code>10주</code> · <code>150만원</code> · <code>1500000원</code> · <code>20%</code>',
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('⬅️ 뒤로', `tr:bnow:sl:${code}:${tp}:${sl}`),
      },
    );
  });

  // 매수 금액 (% 비율) 선택 → 예약 등록
  bot.callbackQuery(/^tr:bamt:(\d{6}):(mo):p(\d+)$/, async (ctx) => {
    const m = ctx.callbackQuery.data!.match(/^tr:bamt:(\d{6}):(mo):p(\d+)$/);
    if (!m) {
      await ctx.answerCallbackQuery();
      return;
    }
    const [, code, strategy, pctStr] = m;
    const pct = Number(pctStr);
    await ctx.answerCallbackQuery('예약 등록 중…');
    const amount: BuyAmountSpec = { mode: 'percent', value: pct };
    const r = await buildBuyConfirmAndRegister({
      chatId: ctx.chat!.id,
      code: code!,
      strategy: strategy!,
      amount,
    });
    if ('error' in r) {
      await ctx.reply(`❌ ${r.error}`);
      return;
    }
    const kb = new InlineKeyboard()
      .text('✅ 확정', `confirm:${r.reservationId}`)
      .text('❌ 취소', `cancel:${r.reservationId}`);
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    } catch {}
    await ctx.reply(r.text, { reply_markup: kb, parse_mode: 'HTML' });
  });

  // 매수 금액 직접 입력 진입
  bot.callbackQuery(/^tr:binput:(\d{6}):(mo)$/, async (ctx) => {
    const m = ctx.callbackQuery.data!.match(/^tr:binput:(\d{6}):(mo)$/);
    if (!m) {
      await ctx.answerCallbackQuery();
      return;
    }
    const [, code, strategy] = m;
    await ctx.answerCallbackQuery();
    setChatMode(ctx.chat!.id, 'awaiting_trade_buy_amount', {
      buyCode: code!,
      buyStrategy: strategy!,
    });
    const sym = await resolveSymbol(code!);
    const name = sym?.name ?? code!;
    const p = buildBuyDirectInputPrompt(code!, name, strategy!);
    try {
      await ctx.editMessageText(p.text, { reply_markup: p.kb, parse_mode: 'HTML' });
    } catch {
      await ctx.reply(p.text, { reply_markup: p.kb, parse_mode: 'HTML' });
    }
  });

  // 매도 진입
  bot.callbackQuery('tr:sell', async (ctx) => {
    await ctx.answerCallbackQuery('보유 종목 조회 중…');
    clearChatMode(ctx.chat!.id);
    try {
      const m = await buildSellSymbolMenu();
      try {
        await ctx.editMessageText(m.text, { reply_markup: m.kb, parse_mode: 'HTML' });
      } catch {
        await ctx.reply(m.text, { reply_markup: m.kb, parse_mode: 'HTML' });
      }
    } catch (err) {
      await ctx.reply(`❌ 잔고 조회 실패: ${(err as Error).message}`);
    }
  });

  // 매도 종목 선택 → 수량 메뉴
  bot.callbackQuery(/^tr:ss:(\d{6})$/, async (ctx) => {
    const m = ctx.callbackQuery.data!.match(/^tr:ss:(\d{6})$/);
    if (!m) {
      await ctx.answerCallbackQuery();
      return;
    }
    const code = m[1]!;
    await ctx.answerCallbackQuery();
    const r = await buildSellQtyMenu(code);
    if ('error' in r) {
      await ctx.reply(`❌ ${r.error}`);
      return;
    }
    try {
      await ctx.editMessageText(r.text, { reply_markup: r.kb, parse_mode: 'HTML' });
    } catch {
      await ctx.reply(r.text, { reply_markup: r.kb, parse_mode: 'HTML' });
    }
  });

  // 매도 수량 (전량/절반) 선택 → pendingIntent 등록 + confirm 메시지 (매수와 동일 흐름)
  bot.callbackQuery(/^tr:sq:(\d{6}):(all|half)$/, async (ctx) => {
    const m = ctx.callbackQuery.data!.match(/^tr:sq:(\d{6}):(all|half)$/);
    if (!m) {
      await ctx.answerCallbackQuery();
      return;
    }
    const [, code, qtyMode] = m;
    await ctx.answerCallbackQuery();
    const r = await buildSellConfirmAndRegister({
      chatId: ctx.chat!.id,
      code: code!,
      qtyMode: qtyMode as 'all' | 'half',
    });
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    } catch {}
    if (!r.ok) {
      await ctx.reply(r.text, { parse_mode: 'HTML' });
      return;
    }
    const kb = new InlineKeyboard()
      .text('✅ 매도 발주', `confirm:${r.intentId}`)
      .text('❌ 취소', `cancel:${r.intentId}`);
    await ctx.reply(r.text, { reply_markup: kb, parse_mode: 'HTML' });
  });

  // 매도 수량 직접 입력 진입
  bot.callbackQuery(/^tr:sinput:(\d{6})$/, async (ctx) => {
    const m = ctx.callbackQuery.data!.match(/^tr:sinput:(\d{6})$/);
    if (!m) {
      await ctx.answerCallbackQuery();
      return;
    }
    const code = m[1]!;
    await ctx.answerCallbackQuery();
    setChatMode(ctx.chat!.id, 'awaiting_trade_sell_qty', { sellCode: code });
    const sym = await resolveSymbol(code);
    const name = sym?.name ?? code;
    await ctx.reply(
      `✏️ <b>매도 — 수량 직접 입력</b>\n${name} (${code})\n수량을 보내주세요 (예: <code>5주</code> · <code>10</code>)`,
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('⬅️ 뒤로', `tr:ss:${code}`),
      },
    );
  });

  bot.callbackQuery(/^wlrm:(\d+)$/, async (ctx) => {
    const m = ctx.callbackQuery.data!.match(/^wlrm:(\d+)$/);
    if (!m) {
      await ctx.answerCallbackQuery();
      return;
    }
    const id = Number(m[1]);
    const removed = removeWatchlistOne(ctx.chat!.id, id);
    await ctx.answerCallbackQuery(removed > 0 ? '제거됨' : '제거 실패');
    // 제거 화면 갱신
    const menu = buildWatchlistRemoveMenu(ctx.chat!.id);
    try {
      await ctx.editMessageText(menu.text, { reply_markup: menu.kb });
    } catch {}
  });

  // ===== 잔고/포지션 화면 인라인 액션 =====

  // 잔고 화면 → [📊 포지션] / [📋 대기] 단축
  bot.callbackQuery('nav:balance', async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      const v = await buildBalanceView();
      try {
        await ctx.editMessageText(v.text, { reply_markup: v.kb, parse_mode: 'HTML' });
      } catch {
        await ctx.reply(v.text, { reply_markup: v.kb, parse_mode: 'HTML' });
      }
    } catch (err) {
      await ctx.reply(`❌ 잔고 조회 실패: ${(err as Error).message}`);
    }
  });

  bot.callbackQuery('nav:positions', async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      const v = await buildPositionsView(ctx.chat!.id);
      try {
        await ctx.editMessageText(v.text, { reply_markup: v.kb, parse_mode: 'HTML' });
      } catch {
        await ctx.reply(v.text, { reply_markup: v.kb, parse_mode: 'HTML' });
      }
    } catch (err) {
      await ctx.reply(`❌ 포지션 조회 실패: ${(err as Error).message}`);
    }
  });

  // nav:orders / od:refresh — 통합 대기 뷰
  async function renderOrdersView(ctx: Context) {
    try {
      const v = await buildOrdersView(ctx.chat!.id);
      try {
        await ctx.editMessageText(v.text, { reply_markup: v.kb, parse_mode: 'HTML' });
      } catch {
        await ctx.reply(v.text, { reply_markup: v.kb, parse_mode: 'HTML' });
      }
    } catch (err) {
      await ctx.reply(`❌ 대기 조회 실패: ${(err as Error).message}`);
    }
  }
  bot.callbackQuery('nav:orders', async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderOrdersView(ctx);
  });
  bot.callbackQuery('od:refresh', async (ctx) => {
    await ctx.answerCallbackQuery('새로고침');
    await renderOrdersView(ctx);
  });

  // KIS 미체결 취소
  bot.callbackQuery(/^kis:cx:(\w+):(\w+):(\w+)$/, async (ctx) => {
    const m = ctx.callbackQuery.data!.match(/^kis:cx:(\w+):(\w+):(\w+)$/);
    if (!m) {
      await ctx.answerCallbackQuery();
      return;
    }
    const [, orgno, odno, ordDvsn] = m;
    await ctx.answerCallbackQuery('취소 요청 중…');
    try {
      const res = await cancelKrxOrder({ orgno: orgno!, odno: odno!, ordDvsn });
      const parsed = parseMcpResult(res);
      const raw = parsed.raw ?? {};
      const rtCd = (raw as Record<string, unknown>).rt_cd;
      const msg = String((raw as Record<string, unknown>).msg1 ?? '');
      if (rtCd === '0' || rtCd === undefined) {
        await ctx.reply(`✅ 주문취소 요청 성공 (#${odno})${msg ? `\n${msg}` : ''}`);
      } else {
        await ctx.reply(`❌ 주문취소 실패 (#${odno}): ${msg || 'rt_cd=' + rtCd}`);
      }
      await renderOrdersView(ctx);
    } catch (err) {
      await ctx.reply(`❌ 주문취소 실패: ${(err as Error).message}`);
    }
  });

  // 포지션/잔고 종목별 매도 — 매도 수량 메뉴로 진입 (tr:ss 로직 재사용)
  bot.callbackQuery(/^(pos|bal):sell:(\d{6})$/, async (ctx) => {
    const m = ctx.callbackQuery.data!.match(/^(pos|bal):sell:(\d{6})$/);
    if (!m) {
      await ctx.answerCallbackQuery();
      return;
    }
    const code = m[2]!;
    await ctx.answerCallbackQuery();
    try {
      const r = await buildSellQtyMenu(code);
      if ('error' in r) {
        await ctx.reply(`❌ ${r.error}`);
        return;
      }
      await ctx.reply(r.text, { reply_markup: r.kb, parse_mode: 'HTML' });
    } catch (err) {
      await ctx.reply(`❌ 매도 수량 메뉴 실패: ${(err as Error).message}`);
    }
  });

  // 포지션/잔고 차트/청산 버튼은 제거됨 (사용자 요청: 매도 버튼만 유지).
  // 차트는 메인 키보드 [📈 차트], 청산은 매도 메뉴의 [전량] 사용.

  async function handleText(ctx: Context, text: string) {
    await ctx.replyWithChatAction('typing');
    const chatId = ctx.chat!.id;

    // chatState — "다음 메시지 = 종목명" 모드면 그쪽으로 라우팅
    const mode = getChatMode(chatId);
    if (mode === 'awaiting_watchlist_add' && !text.startsWith('/')) {
      clearChatMode(chatId);
      const r = await handleWatchlistAdd(chatId, text);
      if (r.kind === 'choices') {
        await ctx.reply(r.text, { reply_markup: r.kb, parse_mode: 'HTML' });
      } else {
        await ctx.reply(r.text, { parse_mode: 'HTML' });
      }
      return;
    }
    if (mode === 'awaiting_quote_symbol' && !text.startsWith('/')) {
      clearChatMode(chatId);
      const candidates = searchSymbolCandidates(text, 10);
      if (candidates.length === 0) {
        await ctx.reply(
          `❓ "${text}" 검색 결과 없음.\n오타가 아닌지 확인하거나 6자리 종목코드(예: <code>005930</code>)를 입력해 보세요.`,
          {
            parse_mode: 'HTML',
            reply_markup: new InlineKeyboard()
              .text('🔍 다시 입력', 'qm:search')
              .text('⬅️ 뒤로', 'qm:back'),
          },
        );
      } else if (candidates.length === 1) {
        // 단일 결과는 바로 시세 표시
        const r = await buildQuoteResult(candidates[0]!.code);
        await ctx.reply(r.text, { reply_markup: r.kb, parse_mode: 'HTML' });
      } else {
        const r = buildQuoteSearchResults(text, candidates);
        await ctx.reply(r.text, { reply_markup: r.kb, parse_mode: 'HTML' });
      }
      return;
    }
    if (mode === 'awaiting_chart_symbol' && !text.startsWith('/')) {
      clearChatMode(chatId);
      const candidates = searchSymbolCandidates(text, 10);
      if (candidates.length === 0) {
        await ctx.reply(
          `❓ "${text}" 검색 결과 없음.\n오타가 아닌지 확인하거나 6자리 종목코드(예: <code>005930</code>)를 입력해 보세요.`,
          {
            parse_mode: 'HTML',
            reply_markup: new InlineKeyboard()
              .text('🔍 다시 입력', 'chartmenu:search')
              .text('⬅️ 뒤로', 'chartmenu:back'),
          },
        );
      } else {
        const r = buildChartSearchResults(text, candidates);
        await ctx.reply(r.text, { reply_markup: r.kb, parse_mode: 'HTML' });
      }
      return;
    }
    if (mode === 'awaiting_trade_buy_search' && !text.startsWith('/')) {
      clearChatMode(chatId);
      const candidates = searchSymbolCandidates(text, 10);
      if (candidates.length === 0) {
        await ctx.reply(
          `❓ "${text}" 검색 결과 없음.\n오타가 아닌지 확인하거나 6자리 종목코드(예: <code>005930</code>)를 입력해 보세요.`,
          {
            parse_mode: 'HTML',
            reply_markup: new InlineKeyboard()
              .text('🔍 다시 입력', 'tr:bsearch')
              .text('⬅️ 뒤로', 'tr:buy'),
          },
        );
      } else {
        const r = buildBuySearchResults(text, candidates);
        await ctx.reply(r.text, { reply_markup: r.kb, parse_mode: 'HTML' });
      }
      return;
    }
    if (mode === 'awaiting_trade_buy_amount' && !text.startsWith('/')) {
      const meta = getChatMeta(chatId);
      clearChatMode(chatId);
      const code = meta?.buyCode;
      const strategy = meta?.buyStrategy ?? 'mo';
      if (!code) {
        await ctx.reply('❌ 매수 컨텍스트 분실 — [💼 거래] 다시 시작해주세요.');
        return;
      }
      const amount = parseBuyAmount(text);
      if (!amount) {
        await ctx.reply(
          `❌ 형식을 못 알아들었습니다: "${text}"\n예: 10주 · 150만원 · 1500000원 · 20%`,
        );
        return;
      }
      const r = await buildBuyConfirmAndRegister({ chatId, code, strategy, amount });
      if ('error' in r) {
        await ctx.reply(`❌ ${r.error}`);
      } else {
        const kb = new InlineKeyboard()
          .text('✅ 확정', `confirm:${r.reservationId}`)
          .text('❌ 취소', `cancel:${r.reservationId}`);
        await ctx.reply(r.text, { reply_markup: kb, parse_mode: 'HTML' });
      }
      return;
    }
    // TP/SL 직접 입력 — % 또는 "없음"
    function parseTpSlInput(t: string): string | null {
      const trimmed = t.trim();
      if (/^(없음|none|off|x)$/i.test(trimmed)) return 'off';
      const m = trimmed.match(/^(\d+(?:\.\d+)?)\s*%?$/);
      if (!m) return null;
      const n = Number(m[1]);
      if (n <= 0 || n > 100) return null;
      // 콜백 인코딩 호환: 정수면 정수, 소수면 그대로
      return Number.isInteger(n) ? String(n) : n.toFixed(1);
    }
    if (mode === 'awaiting_trade_buy_now_tp' && !text.startsWith('/')) {
      const meta = getChatMeta(chatId);
      clearChatMode(chatId);
      const code = meta?.buyCode;
      if (!code) {
        await ctx.reply('❌ 즉시매수 컨텍스트 분실 — [💼 거래] 다시 시작해주세요.');
        return;
      }
      const tp = parseTpSlInput(text);
      if (!tp) {
        await ctx.reply(
          `❌ 형식을 못 알아들었습니다: "${text}"\n예: <code>7.5</code> · <code>10</code> · <code>없음</code>`,
          { parse_mode: 'HTML' },
        );
        return;
      }
      const sym = await resolveSymbol(code);
      const menu = (await import('../fastpath/trade.js')).buildBuyNowSlMenu(
        code,
        sym?.name ?? code,
        tp,
      );
      await ctx.reply(menu.text, { reply_markup: menu.kb, parse_mode: 'HTML' });
      return;
    }
    if (mode === 'awaiting_trade_buy_now_sl' && !text.startsWith('/')) {
      const meta = getChatMeta(chatId);
      clearChatMode(chatId);
      const code = meta?.buyCode;
      const tp = meta?.buyNowTp ?? 'off';
      if (!code) {
        await ctx.reply('❌ 즉시매수 컨텍스트 분실 — [💼 거래] 다시 시작해주세요.');
        return;
      }
      const sl = parseTpSlInput(text);
      if (!sl) {
        await ctx.reply(
          `❌ 형식을 못 알아들었습니다: "${text}"\n예: <code>2.5</code> · <code>3</code> · <code>없음</code>`,
          { parse_mode: 'HTML' },
        );
        return;
      }
      const sym = await resolveSymbol(code);
      try {
        const menu = await buildBuyNowQtyMenu(code, sym?.name ?? code, tp, sl);
        await ctx.reply(menu.text, { reply_markup: menu.kb, parse_mode: 'HTML' });
      } catch (err) {
        await ctx.reply(`❌ 수량 메뉴 로드 실패: ${(err as Error).message}`);
      }
      return;
    }
    if (mode === 'awaiting_trade_buy_now_amount' && !text.startsWith('/')) {
      const meta = getChatMeta(chatId);
      clearChatMode(chatId);
      const code = meta?.buyCode;
      const tp = meta?.buyNowTp ?? 'off';
      const sl = meta?.buyNowSl ?? 'off';
      if (!code) {
        await ctx.reply('❌ 즉시매수 컨텍스트 분실 — [💼 거래] 다시 시작해주세요.');
        return;
      }
      const amount = parseBuyAmount(text);
      if (!amount) {
        await ctx.reply(
          `❌ 형식을 못 알아들었습니다: "${text}"\n예: 10주 · 150만원 · 1500000원 · 20%`,
        );
        return;
      }
      const r = await buildBuyNowConfirmAndRegister({ chatId, code, tp, sl, amount });
      if ('error' in r) {
        await ctx.reply(`❌ ${r.error}`);
      } else {
        const kb = new InlineKeyboard()
          .text('✅ 매수 발주', `confirm:${r.intentId}`)
          .text('❌ 취소', `cancel:${r.intentId}`);
        await ctx.reply(r.text, { reply_markup: kb, parse_mode: 'HTML' });
      }
      return;
    }
    if (mode === 'awaiting_trade_sell_qty' && !text.startsWith('/')) {
      const meta = getChatMeta(chatId);
      clearChatMode(chatId);
      const code = meta?.sellCode;
      if (!code) {
        await ctx.reply('❌ 매도 컨텍스트 분실 — [💼 거래] 다시 시작해주세요.');
        return;
      }
      const m = text.trim().match(/^(\d+)\s*주?$/);
      if (!m) {
        await ctx.reply('❌ 수량 형식: <code>10주</code> 또는 <code>10</code>', {
          parse_mode: 'HTML',
        });
        return;
      }
      const qty = Number(m[1]);
      const r = await buildSellConfirmAndRegister({ chatId, code, qtyMode: 'shares', qtyValue: qty });
      if (!r.ok) {
        await ctx.reply(r.text, { parse_mode: 'HTML' });
        return;
      }
      const kb = new InlineKeyboard()
        .text('✅ 매도 발주', `confirm:${r.intentId}`)
        .text('❌ 취소', `cancel:${r.intentId}`);
      await ctx.reply(r.text, { reply_markup: kb, parse_mode: 'HTML' });
      return;
    }

    // Reply Keyboard 버튼 텍스트 라우팅 (이모지 제거 — 한글만 추출)
    const cleaned = text.replace(/[^ㄱ-힝]/g, '').trim();
    if (cleaned === '관심종목') {
      const menu = buildWatchlistMenu(chatId);
      await ctx.reply(menu.text, { reply_markup: menu.kb, parse_mode: 'HTML' });
      return;
    }
    if (cleaned === '차트') {
      const menu = buildChartMainMenu(chatId);
      await ctx.reply(menu.text, { reply_markup: menu.kb, parse_mode: 'HTML' });
      return;
    }
    if (cleaned === '시세조회') {
      const menu = buildQuoteMainMenu(chatId);
      await ctx.reply(menu.text, { reply_markup: menu.kb, parse_mode: 'HTML' });
      return;
    }
    if (cleaned === '거래') {
      const menu = buildTradeMainMenu();
      await ctx.reply(menu.text, { reply_markup: menu.kb, parse_mode: 'HTML' });
      return;
    }
    if (cleaned === '전략') {
      const menu = buildStrategyMainMenu();
      await ctx.reply(menu.text, { reply_markup: menu.kb, parse_mode: 'HTML' });
      return;
    }
    if (cleaned === '예약' || cleaned === '대기') {
      try {
        const v = await buildOrdersView(chatId);
        await ctx.reply(v.text, { reply_markup: v.kb, parse_mode: 'HTML' });
      } catch (err) {
        await ctx.reply(`❌ 대기 조회 실패: ${(err as Error).message}`);
      }
      return;
    }
    if (cleaned === '포지션') {
      try {
        const v = await buildPositionsView(chatId);
        await ctx.reply(v.text, { reply_markup: v.kb, parse_mode: 'HTML' });
      } catch (err) {
        await ctx.reply(`❌ 포지션 조회 실패: ${(err as Error).message}`);
      }
      return;
    }
    if (cleaned === '잔고') {
      try {
        const v = await buildBalanceView();
        await ctx.reply(v.text, { reply_markup: v.kb, parse_mode: 'HTML' });
      } catch (err) {
        await ctx.reply(`❌ 잔고 조회 실패: ${(err as Error).message}`);
      }
      return;
    }
    if (cleaned === '도움말') {
      await ctx.reply(HELP, { reply_markup: MAIN_KEYBOARD });
      return;
    }

    // 차트 패턴 ("삼성전자 5분봉" / "삼성전자 차트")
    const chartMatch = tryMatchChart(text);
    if (chartMatch) {
      try {
        const r = await handleChart(chartMatch);
        if (typeof r === 'string') {
          await ctx.reply(r);
        } else {
          await ctx.replyWithPhoto(new InputFile(r.png, 'chart.png'), { caption: r.caption });
        }
      } catch (err) {
        await ctx.reply(`❌ 차트 생성 실패: ${(err as Error).message}`);
      }
      return;
    }
    // 시가매매 예약 패턴 우선 (fast-path 매수와 키워드 충돌 회피)
    const moMatch = tryMatchMarketOpen(text);
    if (moMatch) {
      try {
        const r = await handleMarketOpenReserve(ctx.chat!.id, moMatch);
        if (r.kind === 'proposal') {
          const kb = new InlineKeyboard()
            .text('✅ 예약', `confirm:${r.intentId}`)
            .text('❌ 취소', `cancel:${r.intentId}`);
          await ctx.reply(r.summary, { reply_markup: kb, parse_mode: 'HTML' });
        } else {
          await ctx.reply(r.text, { parse_mode: 'HTML' });
        }
      } catch (err) {
        await ctx.reply(`❌ 시가매매 예약 오류: ${(err as Error).message}`);
      }
      return;
    }
    // Fast-path
    try {
      const fast = await tryFastPath(ctx.chat!.id, text);
      if (fast) {
        console.log('[bot] fastpath hit:', fast.kind);
        if (fast.kind === 'proposal') {
          const kb =
            fast.kb ??
            new InlineKeyboard()
              .text('✅ 실행', `confirm:${fast.intentId}`)
              .text('❌ 취소', `cancel:${fast.intentId}`);
          await ctx.reply(fast.summary, { reply_markup: kb, parse_mode: 'HTML' });
        } else {
          await ctx.reply(fast.text, { parse_mode: 'HTML' });
        }
        return;
      }
    } catch (err) {
      console.error('[fastpath] error', err);
    }
    await ctx.reply(
      '❓ 이해하지 못했습니다. /help 로 사용 가능한 명령을 확인하세요.',
    );
  }

  // grammy의 bot.command는 한글 BotCommand entity를 매칭 못 함.
  // 그래서 한글 명령은 message:text에서 prefix 매칭으로 직접 라우팅.
  // 매칭 길이가 긴 명령(/관심종목추가)을 짧은 것(/관심종목)보다 먼저 검사해야 함.
  async function routeKoreanCommand(ctx: Context, text: string): Promise<boolean> {
    const tryPrefix = (cmd: string): string | null => {
      if (text === cmd) return '';
      if (text.startsWith(cmd + ' ') || text.startsWith(cmd + '\n')) {
        return text.slice(cmd.length).trim();
      }
      return null;
    };
    const chatId = ctx.chat!.id;

    let arg: string | null;

    if ((arg = tryPrefix('/도움말')) !== null || (arg = tryPrefix('/시작')) !== null) {
      await ctx.reply(HELP, { reply_markup: MAIN_KEYBOARD });
      return true;
    }
    if ((arg = tryPrefix('/상태')) !== null) {
      const cfg = getConfig();
      const list = listChatPositions(chatId);
      const open = list.filter((p) => p.state === 'open').length;
      const pending = list.filter((p) => p.state === 'pending').length;
      const closing = list.filter((p) => p.state === 'closing').length;
      const mode = getMode();
      await ctx.reply(
        `📊 상태\n` +
          `• 모드: <b>${mode === 'paper' ? '모의투자(paper)' : '실전(real)'}</b>\n` +
          `• KIS API: REST 직접 호출\n` +
          `• 포지션: open=${open}, pending=${pending}, closing=${closing}\n` +
          `• 한도: 거래 ${cfg.MAX_TRADE_KRW.toLocaleString()}원\n\n` +
          `전환: /모의투자  /실전`,
        { parse_mode: 'HTML' },
      );
      return true;
    }
    if ((arg = tryPrefix('/모의투자')) !== null) {
      setMode('paper');
      await ctx.reply('🧪 <b>모의투자 모드</b>로 전환됨', { parse_mode: 'HTML' });
      return true;
    }
    if ((arg = tryPrefix('/실전')) !== null || (arg = tryPrefix('/라이브계좌')) !== null) {
      setMode('real');
      await ctx.reply('⚠️ <b>실전 모드</b>로 전환됨\n실제 자금 거래입니다.', {
        parse_mode: 'HTML',
      });
      return true;
    }
    if ((arg = tryPrefix('/잔고')) !== null) {
      try {
        const v = await buildBalanceView();
        await ctx.reply(v.text, { reply_markup: v.kb, parse_mode: 'HTML' });
      } catch (err) {
        await ctx.reply(`❌ 잔고 조회 실패: ${(err as Error).message}`);
      }
      return true;
    }
    if ((arg = tryPrefix('/포지션')) !== null || (arg = tryPrefix('/보유')) !== null) {
      try {
        const v = await buildPositionsView(chatId);
        await ctx.reply(v.text, { reply_markup: v.kb, parse_mode: 'HTML' });
      } catch (err) {
        await ctx.reply(`❌ 포지션 조회 실패: ${(err as Error).message}`);
      }
      return true;
    }
    if (
      (arg = tryPrefix('/대기')) !== null ||
      (arg = tryPrefix('/예약목록')) !== null ||
      (arg = tryPrefix('/예약')) !== null
    ) {
      try {
        const v = await buildOrdersView(chatId);
        await ctx.reply(v.text, { reply_markup: v.kb, parse_mode: 'HTML' });
      } catch (err) {
        await ctx.reply(`❌ 대기 조회 실패: ${(err as Error).message}`);
      }
      return true;
    }
    if ((arg = tryPrefix('/시가매매')) !== null) {
      const reply = await handleMarketOpenCommand(chatId, arg);
      await ctx.reply(reply, { parse_mode: 'HTML' });
      return true;
    }
    if ((arg = tryPrefix('/관심종목추가')) !== null) {
      const r = await handleWatchlistAdd(chatId, arg);
      if (r.kind === 'choices') {
        await ctx.reply(r.text, { reply_markup: r.kb, parse_mode: 'HTML' });
      } else {
        await ctx.reply(r.text, { parse_mode: 'HTML' });
      }
      return true;
    }
    if ((arg = tryPrefix('/관심종목제거')) !== null) {
      await ctx.reply(handleWatchlistRemove(chatId, arg), { parse_mode: 'HTML' });
      return true;
    }
    if ((arg = tryPrefix('/관심종목')) !== null) {
      await ctx.reply(renderWatchlist(chatId), { parse_mode: 'HTML' });
      return true;
    }
    if ((arg = tryPrefix('/확정')) !== null) {
      if (!arg) {
        await ctx.reply('사용: /확정 <id>');
        return true;
      }
      await ctx.reply(await runConfirm(chatId, arg));
      return true;
    }
    if ((arg = tryPrefix('/취소')) !== null) {
      if (!arg) {
        await ctx.reply('사용: /취소 <id>');
        return true;
      }
      await ctx.reply(runCancel(chatId, arg));
      return true;
    }
    if ((arg = tryPrefix('/청산')) !== null) {
      if (!arg) {
        await ctx.reply('사용: /청산 <position_id>');
        return true;
      }
      await ctx.reply('⏳ 청산 중…');
      try {
        await closePosition({ positionId: arg, reason: 'manual' });
      } catch (err) {
        await ctx.reply(`❌ 청산 실패: ${(err as Error).message}`);
      }
      return true;
    }

    return false;
  }

  // 인라인 자동완성 — 채팅창에서 "@owlimstock_bot 삼" 입력 시 종목 후보 표시
  // (BotFather에서 inline mode 활성 필요: /mybots → 봇 → Bot Settings → Inline Mode → Turn on)
  bot.on('inline_query', async (ctx) => {
    const q = ctx.inlineQuery.query.trim();
    const candidates = q ? searchSymbolCandidates(q, 12) : [];
    if (q) {
      const exact = await resolveSymbol(q).catch(() => null);
      if (exact && !candidates.find((c) => c.code === exact.code)) {
        candidates.unshift(exact);
      }
    }
    const results = candidates.slice(0, 12).map((c) => ({
      type: 'article' as const,
      id: c.code,
      title: c.name,
      description: `${c.code} — 누르면 관심종목에 추가`,
      input_message_content: {
        message_text: `/관심종목추가 ${c.code}`,
      },
    }));
    await ctx.answerInlineQuery(results, { cache_time: 0 });
  });

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) {
      // 한글 명령 직접 라우팅 → 매칭 안 되면 영어 명령은 grammy bot.command가 처리
      try {
        if (await routeKoreanCommand(ctx, text)) return;
      } catch (err) {
        await ctx.reply(`❌ 명령 처리 실패: ${(err as Error).message}`);
      }
      return;
    }
    console.log(`[bot] msg from ${ctx.chat?.id}: "${text}"`);
    await handleText(ctx, text);
  });
}
