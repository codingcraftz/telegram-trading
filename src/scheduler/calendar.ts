// 다음 한국 정규장 개장 시각 계산 (KST 09:00:05).
// 1차 구현: 평일만 본다. 공휴일/임시휴장은 발주 시 KIS가 거부 → 알림으로 처리.
// 추후 KIS holiday API 또는 정적 캘린더 추가.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const FIRE_HOUR_KST = 9;
const FIRE_MINUTE_KST = 0;
const FIRE_SECOND_KST = 5;

// now 기준 가장 가까운 다음 평일 09:00:05 KST. 오늘이 평일이고 현재가 09:00:05 이전이면 오늘.
export function nextMarketOpen(now: Date = new Date()): Date {
  // KST 시각으로 환산
  const kstNow = new Date(now.getTime() + KST_OFFSET_MS);
  // UTC getter를 쓰지만 실제로 KST를 의미하도록 시프트
  const kstYear = kstNow.getUTCFullYear();
  const kstMonth = kstNow.getUTCMonth();
  const kstDate = kstNow.getUTCDate();

  // 후보: 오늘 09:00:05 KST → UTC
  let candidateKstMs = Date.UTC(kstYear, kstMonth, kstDate, FIRE_HOUR_KST, FIRE_MINUTE_KST, FIRE_SECOND_KST);
  let candidate = new Date(candidateKstMs - KST_OFFSET_MS);

  // 후보가 이미 지났으면 +1일부터 시작
  if (candidate.getTime() <= now.getTime()) {
    candidateKstMs += 24 * 60 * 60 * 1000;
    candidate = new Date(candidateKstMs - KST_OFFSET_MS);
  }

  // 평일이 될 때까지 +1일 (KST 기준 요일)
  for (let i = 0; i < 10; i++) {
    const dayKst = new Date(candidate.getTime() + KST_OFFSET_MS).getUTCDay();
    // 0=일, 6=토
    if (dayKst !== 0 && dayKst !== 6) return candidate;
    candidateKstMs += 24 * 60 * 60 * 1000;
    candidate = new Date(candidateKstMs - KST_OFFSET_MS);
  }
  // 안전장치 (정상 흐름에선 도달 안 함)
  return candidate;
}

export function formatKst(d: Date): string {
  const kst = new Date(d.getTime() + KST_OFFSET_MS);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  const HH = String(kst.getUTCHours()).padStart(2, '0');
  const MM = String(kst.getUTCMinutes()).padStart(2, '0');
  const SS = String(kst.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${HH}:${MM}:${SS} KST`;
}
