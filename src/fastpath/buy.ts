// 단순 매수 정형 패턴 fast-path. LLM 거치지 않고 직접 제안 생성.
// 지원:
//   "삼성전자 5주 매수"
//   "삼성전자 5주 시장가 매수"
//   "삼성전자 10만원어치 매수"
//   "005930 100만원어치 사줘"

import { callKisApi } from '../mcp/kis.js';
import {
  insertPendingIntent,
  logTrade,
  type OrderSpec,
} from '../db/repo.js';
import { getConfig } from '../config.js';
import { checkSpec } from '../guardrails/policy.js';
import { firstOutput, num, parseMcpResult } from './extract.js';
import { resolveSymbol } from './symbol.js';

type BuyIntent = {
  sym: string;
  qtyShares?: number;
  qtyKrw?: number;
  market: boolean;
};

const PATTERNS: Array<{ re: RegExp; build: (m: RegExpMatchArray) => BuyIntent | null }> = [
  // "<종목> N주 (시장가|지정가)? 매수|사줘"
  {
    re: /^(?<sym>[A-Za-z가-힣0-9]+)\s+(?<qty>\d+)\s*주\s*(?<type>시장가|지정가)?\s*(매수|사줘|사|사다오)\s*\??$/,
    build: (m) => ({
      sym: m.groups!.sym!,
      qtyShares: Number(m.groups!.qty),
      market: (m.groups!.type ?? '시장가') === '시장가',
    }),
  },
  // "<종목> N만원어치 매수"
  {
    re: /^(?<sym>[A-Za-z가-힣0-9]+)\s+(?<amt>\d+(?:[\.,]\d+)?)\s*만\s*원?\s*어치\s*(매수|사줘|사)\s*\??$/,
    build: (m) => ({
      sym: m.groups!.sym!,
      qtyKrw: Math.round(Number((m.groups!.amt ?? '0').replace(',', '')) * 10_000),
      market: true,
    }),
  },
  // "<종목> N원어치 매수"
  {
    re: /^(?<sym>[A-Za-z가-힣0-9]+)\s+(?<amt>\d{4,})\s*원\s*어치\s*(매수|사줘|사)\s*\??$/,
    build: (m) => ({
      sym: m.groups!.sym!,
      qtyKrw: Number(m.groups!.amt),
      market: true,
    }),
  },
];

export function tryMatchBuy(text: string): BuyIntent | null {
  const t = text.trim();
  for (const p of PATTERNS) {
    const m = t.match(p.re);
    if (m) return p.build(m);
  }
  return null;
}

export async function handleBuy(chatId: number, intent: BuyIntent): Promise<
  | { kind: 'reply'; text: string }
  | { kind: 'proposal'; summary: string; intentId: string }
> {
  const cfg = getConfig();
  const sym = await resolveSymbol(intent.sym);
  if (!sym) return { kind: 'reply', text: `❓ 종목을 찾지 못했습니다: ${intent.sym}` };

  // 현재가 조회 (시장가 산정 + 금액→수량 변환)
  const priceRes = await callKisApi('domestic_stock', 'inquire_price', {
    fid_cond_mrkt_div_code: 'J',
    fid_input_iscd: sym.code,
  });
  const priceParsed = parseMcpResult(priceRes);
  if (!priceParsed.success)
    return { kind: 'reply', text: `❌ 현재가 조회 실패: ${priceParsed.error}` };
  const priceData = firstOutput(priceParsed);
  const curPrice = num(priceData?.stck_prpr);
  if (curPrice === null || curPrice <= 0)
    return { kind: 'reply', text: `❌ 현재가를 못 읽었습니다.` };

  let qty = intent.qtyShares;
  if (qty === undefined && intent.qtyKrw !== undefined) {
    qty = Math.floor(intent.qtyKrw / curPrice);
  }
  if (!qty || qty <= 0) {
    return {
      kind: 'reply',
      text: `❌ 매수 수량이 0주로 계산됨 (현재가 ${curPrice.toLocaleString()}원).`,
    };
  }

  const spec: OrderSpec = {
    action: 'buy',
    market: 'KRX',
    symbol_code: sym.code,
    symbol_name: sym.name,
    order_type: intent.market ? 'market' : 'limit',
    price: intent.market ? undefined : curPrice,
    quantity: qty,
    tp_pct: null,
    sl_pct: null,
  };

  // 가드레일
  const guard = checkSpec(spec);
  if (!guard.ok) {
    return { kind: 'reply', text: `❌ 거절: ${guard.reason}` };
  }

  const approxKrw = curPrice * qty;
  const summary =
    `${sym.name} (KRX/${sym.code}) ${intent.market ? '시장가' : `${curPrice.toLocaleString()}원`} × ${qty}주 매수 ` +
    `(≈${approxKrw.toLocaleString()}원).\n/confirm <id>  또는  /cancel <id>`;

  const intentId = insertPendingIntent({
    chatId,
    llmProposal: summary,
    orderSpec: spec,
    ttlMin: cfg.INTENT_TTL_MIN,
  });
  logTrade({ chatId, kind: 'proposed', payload: { intentId, spec, via: 'fastpath' } });

  return {
    kind: 'proposal',
    summary: summary.replaceAll('<id>', intentId),
    intentId,
  };
}
