// 포지션 뷰 — 봇이 만든 거래의 라이프사이클을 KIS 잔고 현재가와 join해서 표시.
//   listChatPositions(chatId) + inquire_balance.output1 → pdno로 join
//
//   open    : 체결 완료. 현재가/평가손익/수익률 + [📤 매도] [📈 차트] [🛑 청산]
//   pending : 매수 주문 접수, 체결 대기. [📈 차트] [❌ 주문취소(미체결)]
//   closing : 매도 주문 접수, 청산 대기. [📈 차트]
//
// 잔고에 없는데 봇 state=open이면 ⚠️ 표시 (HTS에서 수동 매도된 경우 등).

import { InlineKeyboard } from 'grammy';
import { listChatPositions } from '../db/repo.js';
import { callKisApi } from '../mcp/kis.js';
import { checkKisOk, num, outputList, parseMcpResult } from './extract.js';
import { cached } from './cache.js';

type HoldingRow = {
  qty: number;
  avg: number;
  cur: number;
  pfls: number;
  pflsRt: number;
};

async function fetchHoldingsMap(): Promise<{ map: Map<string, HoldingRow>; error?: string }> {
  // 잔고/포지션 화면이 같은 raw 응답을 본다. 20초 캐싱.
  const res = await cached('balance:raw', 20_000, () =>
    callKisApi('domestic_stock', 'inquire_balance', {}),
  );
  const parsed = parseMcpResult(res);
  const map = new Map<string, HoldingRow>();
  if (!parsed.success) return { map, error: parsed.error ?? 'MCP 파싱 실패' };
  const kisOk = checkKisOk(parsed);
  if (!kisOk.ok) return { map, error: kisOk.message ?? 'KIS 오류' };
  const list = outputList(parsed, 'output1');
  for (const h of list) {
    const code = String(h.pdno ?? '').trim();
    if (!code) continue;
    map.set(code, {
      qty: num(h.hldg_qty) ?? 0,
      avg: num(h.pchs_avg_pric) ?? 0,
      cur: num(h.prpr) ?? 0,
      pfls: num(h.evlu_pfls_amt) ?? 0,
      pflsRt: num(h.evlu_pfls_rt) ?? 0,
    });
  }
  return { map };
}

export async function buildPositionsView(
  chatId: number,
): Promise<{ text: string; kb: InlineKeyboard }> {
  const positions = listChatPositions(chatId);
  if (positions.length === 0) {
    const kb = new InlineKeyboard()
      .text('💵 잔고', 'nav:balance')
      .text('📋 대기', 'nav:orders');
    return { text: '📊 <b>포지션</b>\n보유/대기 포지션 없음', kb };
  }

  let holdings: Map<string, HoldingRow>;
  let holdingsError: string | undefined;
  try {
    const r = await fetchHoldingsMap();
    holdings = r.map;
    holdingsError = r.error;
  } catch (err) {
    return {
      text: `❌ 잔고 조회 실패: ${(err as Error).message}`,
      kb: new InlineKeyboard().text('💵 잔고', 'nav:balance'),
    };
  }

  const open = positions.filter((p) => p.state === 'open').length;
  const pending = positions.filter((p) => p.state === 'pending').length;
  const closing = positions.filter((p) => p.state === 'closing').length;

  const lines = [
    `📊 <b>포지션</b> · open ${open} · pending ${pending}${
      closing > 0 ? ` · closing ${closing}` : ''
    }`,
    `<i>이 봇이 만든 자동 거래만 (TP/SL 모니터링 대상)</i>`,
  ];
  if (holdingsError) {
    lines.push(`⚠️ KIS 잔고 조회 오류 — 현재가/손익 일부 누락: ${holdingsError}`);
  }
  const kb = new InlineKeyboard();

  for (const p of positions) {
    const h = holdings.get(p.symbolCode);
    const head =
      p.state === 'open'
        ? `💎 <b>${p.symbolName}</b> (${p.symbolCode}) ${p.quantity}주 · open`
        : p.state === 'pending'
          ? `⏳ <b>${p.symbolName}</b> (${p.symbolCode}) ${p.quantity}주 · pending`
          : `🔄 <b>${p.symbolName}</b> (${p.symbolCode}) ${p.quantity}주 · closing`;
    lines.push('');
    lines.push(head);

    if (p.state === 'open') {
      if (h && h.qty > 0) {
        const sign = h.pfls >= 0 ? '+' : '';
        lines.push(`   매입 ${Math.round(h.avg).toLocaleString()}원 → 현재 ${Math.round(h.cur).toLocaleString()}원`);
        lines.push(
          `   평가손익 <b>${sign}${Math.round(h.pfls).toLocaleString()}원 (${sign}${h.pflsRt.toFixed(2)}%)</b>`,
        );
      } else if (p.avgPrice) {
        lines.push(`   매입 ${Math.round(p.avgPrice).toLocaleString()}원 · ⚠️ 잔고에 미존재 (외부 매도?)`);
      }
      if (p.tpPrice || p.slPrice) {
        const parts: string[] = [];
        if (p.tpPrice) parts.push(`🎯 TP ${Math.round(p.tpPrice).toLocaleString()}`);
        if (p.slPrice) parts.push(`🛑 SL ${Math.round(p.slPrice).toLocaleString()}`);
        lines.push(`   ${parts.join('  ')}`);
      }
      kb.text(`📤 매도 ${p.symbolName}`, `pos:sell:${p.symbolCode}`).row();
    } else if (p.state === 'pending') {
      lines.push(
        `   주문 ${p.avgPrice ? Math.round(p.avgPrice).toLocaleString() + '원' : '시장가'} (체결대기)`,
      );
    } else if (p.state === 'closing') {
      lines.push(`   매도 주문 접수, 청산 대기 중`);
    }
  }

  kb.text('💵 잔고', 'nav:balance').text('📋 대기', 'nav:orders');

  return { text: lines.join('\n'), kb };
}
