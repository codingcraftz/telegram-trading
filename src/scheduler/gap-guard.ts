// 갭가드: 전일 종가 대비 시초가(또는 현재가) 변동률이 임계치 초과면 발주 취소.
// thresholdPct === null이면 비활성 (= 무조건 통과).

export type GapCheck =
  | { ok: true; pct: number }
  | { ok: false; pct: number; threshold: number; reason: string };

export function evaluateGap(args: {
  prevClose: number;
  openPrice: number;
  thresholdPct: number | null;
}): GapCheck {
  const { prevClose, openPrice, thresholdPct } = args;
  if (prevClose <= 0 || openPrice <= 0) {
    return { ok: false, pct: 0, threshold: thresholdPct ?? 0, reason: '가격 정보 부족' };
  }
  const pct = ((openPrice - prevClose) / prevClose) * 100;
  if (thresholdPct === null) {
    return { ok: true, pct };
  }
  if (Math.abs(pct) > thresholdPct) {
    return {
      ok: false,
      pct,
      threshold: thresholdPct,
      reason: `시초가 ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% (갭가드 ±${thresholdPct}% 초과)`,
    };
  }
  return { ok: true, pct };
}
