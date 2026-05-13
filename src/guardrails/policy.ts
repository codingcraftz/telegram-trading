import { getConfig } from '../config.js';
import {
  countOpenLikePositions,
  inCooldown,
  isBlacklisted,
  todaysRealizedPnl,
  type OrderSpec,
} from '../db/repo.js';

export type GuardResult = { ok: true } | { ok: false; reason: string };

export function checkSpec(spec: OrderSpec): GuardResult {
  const cfg = getConfig();

  if (spec.action === 'buy') {
    const approxKrw =
      (spec.price ?? 0) * spec.quantity ||
      // market 주문의 경우 price가 없을 수 있음 — 보수적으로 통과시키되 다른 가드 적용
      0;
    if (approxKrw > 0 && approxKrw > cfg.MAX_TRADE_KRW) {
      return {
        ok: false,
        reason: `단일 거래 한도 초과: ${approxKrw.toLocaleString()}원 > ${cfg.MAX_TRADE_KRW.toLocaleString()}원`,
      };
    }
    if (isBlacklisted(spec.symbol_code)) {
      return { ok: false, reason: `블랙리스트 종목입니다 (${spec.symbol_code})` };
    }
    if (inCooldown(spec.symbol_code)) {
      return { ok: false, reason: `쿨다운 중인 종목입니다 (${spec.symbol_code})` };
    }
    if (countOpenLikePositions() >= cfg.MAX_OPEN_POSITIONS) {
      return {
        ok: false,
        reason: `동시 보유 종목 한도 초과 (현재 ≥ ${cfg.MAX_OPEN_POSITIONS})`,
      };
    }
    const todays = todaysRealizedPnl();
    if (todays <= -cfg.DAILY_LOSS_KRW) {
      return {
        ok: false,
        reason: `일일 손실 한도 도달 (${todays.toLocaleString()}원). 신규 매수 차단.`,
      };
    }
  }
  return { ok: true };
}
