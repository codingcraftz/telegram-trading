// 전량 매도 / 일부 매도 정형 패턴 fast-path.
// 지원:
//   "삼성전자 전량 매도"
//   "삼성전자 다 팔아"
//   "삼성전자 5주 매도"
//   "삼성전자 5주 팔아"

import {
  insertPendingIntent,
  logTrade,
  type OrderSpec,
} from '../db/repo.js';
import { getConfig } from '../config.js';
import { callKisApi } from '../mcp/kis.js';
import { num, outputList, parseMcpResult } from './extract.js';
import { resolveSymbol } from './symbol.js';

type SellIntent = { sym: string; all: boolean; qtyShares?: number };

const PATTERNS: Array<{ re: RegExp; build: (m: RegExpMatchArray) => SellIntent | null }> = [
  // "<종목> 전량 매도|다 팔아"
  {
    re: /^(?<sym>[A-Za-z가-힣0-9]+)\s+(?:전량|전부|모두|다)\s*(?:매도|팔아|팔|매도해)\s*\??$/,
    build: (m) => ({ sym: m.groups!.sym!, all: true }),
  },
  // "<종목> N주 매도|팔아"
  {
    re: /^(?<sym>[A-Za-z가-힣0-9]+)\s+(?<qty>\d+)\s*주\s*(?:매도|팔아|팔|매도해)\s*\??$/,
    build: (m) => ({
      sym: m.groups!.sym!,
      all: false,
      qtyShares: Number(m.groups!.qty),
    }),
  },
];

export function tryMatchSell(text: string): SellIntent | null {
  const t = text.trim();
  for (const p of PATTERNS) {
    const m = t.match(p.re);
    if (m) return p.build(m);
  }
  return null;
}

export async function handleSell(
  chatId: number,
  intent: SellIntent,
): Promise<
  | { kind: 'reply'; text: string }
  | { kind: 'proposal'; summary: string; intentId: string }
> {
  const cfg = getConfig();
  const sym = await resolveSymbol(intent.sym);
  if (!sym) return { kind: 'reply', text: `❓ 종목을 찾지 못했습니다: ${intent.sym}` };

  // 보유 수량 조회
  const balRes = await callKisApi('domestic_stock', 'inquire_balance', {});
  const balParsed = parseMcpResult(balRes);
  if (!balParsed.success)
    return { kind: 'reply', text: `❌ 잔고 조회 실패: ${balParsed.error}` };
  const holdings = outputList(balParsed, 'output1');
  const h = holdings.find((x) => String(x.pdno ?? '') === sym.code);
  if (!h) return { kind: 'reply', text: `❌ 보유 중이 아닙니다: ${sym.name}` };
  const holdQty = num(h.hldg_qty) ?? 0;
  const ordPsbl = num(h.ord_psbl_qty) ?? holdQty;
  const avgBuy = num(h.pchs_avg_pric) ?? 0;
  const curPrice = num(h.prpr) ?? 0;

  const targetQty = intent.all ? ordPsbl : (intent.qtyShares ?? 0);
  if (targetQty <= 0)
    return { kind: 'reply', text: `❌ 매도 수량 0주.` };
  if (targetQty > ordPsbl)
    return {
      kind: 'reply',
      text: `❌ 매도 가능 수량 부족 (가능 ${ordPsbl}주, 요청 ${targetQty}주)`,
    };

  const spec: OrderSpec = {
    action: 'sell',
    market: 'KRX',
    symbol_code: sym.code,
    symbol_name: sym.name,
    order_type: 'market',
    quantity: targetQty,
    tp_pct: null,
    sl_pct: null,
  };

  const expectedPnl =
    curPrice > 0 && avgBuy > 0 ? (curPrice - avgBuy) * targetQty : 0;
  const pnlSign = expectedPnl >= 0 ? '+' : '';
  const summary =
    `🔻 ${sym.name} (KRX/${sym.code}) ${targetQty}주 시장가 매도\n` +
    `매입평균 ${avgBuy.toLocaleString()}원 → 현재가 ${curPrice.toLocaleString()}원\n` +
    `예상손익 ${pnlSign}${Math.round(expectedPnl).toLocaleString()}원\n` +
    `/confirm <id>  또는  /cancel <id>`;

  const intentId = insertPendingIntent({
    chatId,
    llmProposal: summary,
    orderSpec: spec,
    ttlMin: cfg.INTENT_TTL_MIN,
  });
  logTrade({ chatId, kind: 'proposed', payload: { intentId, spec, via: 'fastpath' } });

  return { kind: 'proposal', summary: summary.replaceAll('<id>', intentId), intentId };
}
