// Fast-path dispatcher.
// 텔레그램 텍스트 메시지 받으면 LLM 호출 전에 먼저 이걸 시도.
// 매칭되면 LLM 안 거치고 응답 반환 (Gemini 쿼터 절약 + 정형 응답).
// 매칭 안 되면 null 반환 → 호출자가 LLM으로 fallback.

import { handleAskingQuery, tryMatchAsking } from './asking.js';
import { handleBalance, tryMatchBalance } from './balance.js';
import { handleBuy, tryMatchBuy } from './buy.js';
import { handlePending, tryMatchPending } from './pending.js';
import { handlePriceQuery, tryMatchPrice } from './price.js';
import { handlePsbl, tryMatchPsbl } from './psbl.js';
import { handleRanking, tryMatchRanking } from './ranking.js';
import { handleSell, tryMatchSell } from './sell.js';

export type FastResult =
  | { kind: 'text'; text: string }
  | { kind: 'proposal'; summary: string; intentId: string }
  | null;

export async function tryFastPath(chatId: number, text: string): Promise<FastResult> {
  const t = text.trim();

  // 매수 정형 (먼저 — "X N주 매수" 같은 정확 매칭)
  const buyM = tryMatchBuy(t);
  if (buyM) {
    try {
      const r = await handleBuy(chatId, buyM);
      return r.kind === 'reply' ? { kind: 'text', text: r.text } : r;
    } catch (err) {
      return { kind: 'text', text: `❌ 매수 처리 오류: ${(err as Error).message}` };
    }
  }

  // 매도 정형
  const sellM = tryMatchSell(t);
  if (sellM) {
    try {
      const r = await handleSell(chatId, sellM);
      return r.kind === 'reply' ? { kind: 'text', text: r.text } : r;
    } catch (err) {
      return { kind: 'text', text: `❌ 매도 처리 오류: ${(err as Error).message}` };
    }
  }

  // 잔고
  if (tryMatchBalance(t)) {
    try {
      return { kind: 'text', text: await handleBalance() };
    } catch (err) {
      return { kind: 'text', text: `❌ 잔고 조회 오류: ${(err as Error).message}` };
    }
  }

  // 매수가능 / 예수금
  if (tryMatchPsbl(t)) {
    try {
      return { kind: 'text', text: await handlePsbl() };
    } catch (err) {
      return { kind: 'text', text: `❌ 예수금 조회 오류: ${(err as Error).message}` };
    }
  }

  // 미체결
  if (tryMatchPending(t)) {
    try {
      return { kind: 'text', text: await handlePending() };
    } catch (err) {
      return { kind: 'text', text: `❌ 미체결 조회 오류: ${(err as Error).message}` };
    }
  }

  // 랭킹
  const rankKind = tryMatchRanking(t);
  if (rankKind) {
    try {
      return { kind: 'text', text: await handleRanking(rankKind) };
    } catch (err) {
      return { kind: 'text', text: `❌ 랭킹 조회 오류: ${(err as Error).message}` };
    }
  }

  // 호가
  const askM = tryMatchAsking(t);
  if (askM) {
    try {
      return { kind: 'text', text: await handleAskingQuery(askM.sym) };
    } catch (err) {
      return { kind: 'text', text: `❌ 호가 조회 오류: ${(err as Error).message}` };
    }
  }

  // 현재가
  const priceM = tryMatchPrice(t);
  if (priceM) {
    try {
      return { kind: 'text', text: await handlePriceQuery(priceM.sym) };
    } catch (err) {
      return { kind: 'text', text: `❌ 시세 조회 오류: ${(err as Error).message}` };
    }
  }

  return null;
}
