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
    const approxKrw = (spec.price ?? 0) * spec.quantity || 0;
    // 0 또는 미설정이면 비활성
    if (cfg.MAX_TRADE_KRW > 0 && approxKrw > 0 && approxKrw > cfg.MAX_TRADE_KRW) {
      return {
        ok: false,
        reason: `단일 거래 한도 초과: ${approxKrw.toLocaleString()}원 > ${cfg.MAX_TRADE_KRW.toLocaleString()}원`,
      };
    }
    if (isBlacklisted(spec.symbol_code)) {
      return { ok: false, reason: `블랙리스트 종목입니다 (${spec.symbol_code})` };
    }
    if (cfg.COOLDOWN_SEC > 0 && inCooldown(spec.symbol_code)) {
      return { ok: false, reason: `쿨다운 중인 종목입니다 (${spec.symbol_code})` };
    }
    if (cfg.MAX_OPEN_POSITIONS > 0 && countOpenLikePositions() >= cfg.MAX_OPEN_POSITIONS) {
      return {
        ok: false,
        reason: `동시 보유 종목 한도 초과 (현재 ≥ ${cfg.MAX_OPEN_POSITIONS})`,
      };
    }
    if (cfg.DAILY_LOSS_KRW > 0) {
      const todays = todaysRealizedPnl();
      if (todays <= -cfg.DAILY_LOSS_KRW) {
        return {
          ok: false,
          reason: `일일 손실 한도 도달 (${todays.toLocaleString()}원). 신규 매수 차단.`,
        };
      }
    }
  }
  return { ok: true };
}
