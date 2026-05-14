// 한국 주식시장 캘린더/세션 헬퍼.
// 휴장일은 src/scheduler/holidays.ts의 isHoliday()로 위임 (없으면 토/일만 본다).

import { isHoliday } from './holidays.js';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const FIRE_HOUR_KST = 9;
const FIRE_MINUTE_KST = 0;
const FIRE_SECOND_KST = 5;

// KST 시각(시·분·초)을 0~86400 사이 초 단위로
function kstSecondsOfDay(now: Date): number {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  return kst.getUTCHours() * 3600 + kst.getUTCMinutes() * 60 + kst.getUTCSeconds();
}

// KST 기준 평일/주말/휴장 판정
function isBusinessDay(now: Date): boolean {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const day = kst.getUTCDay();
  if (day === 0 || day === 6) return false;
  if (isHoliday(now)) return false;
  return true;
}

// 한국 주식시장 세션 매핑
//   pre_extended : 08:30~08:40 장전 시간외 종가 (전일 종가, ord_dvsn=05)
//   pre_auction  : 08:40~09:00 장전 동시호가 (시초가 결정, ord_dvsn=00 예약 접수)
//   regular      : 09:00~15:20 정규장
//   close_auction: 15:20~15:30 장후 동시호가 (종가 결정)
//   post_extended: 15:40~16:00 장후 시간외 종가 (당일 종가, ord_dvsn=06)
//   after_single : 16:00~18:00 시간외 단일가 (±10%, ord_dvsn=07)
//   closed       : 그 외 시간
//   holiday      : 휴장일/주말
export type MarketSession =
  | 'pre_extended'
  | 'pre_auction'
  | 'regular'
  | 'close_auction'
  | 'post_extended'
  | 'after_single'
  | 'closed'
  | 'holiday';

const T_0830 = 8 * 3600 + 30 * 60;
const T_0840 = 8 * 3600 + 40 * 60;
const T_0900 = 9 * 3600;
const T_1520 = 15 * 3600 + 20 * 60;
const T_1530 = 15 * 3600 + 30 * 60;
const T_1540 = 15 * 3600 + 40 * 60;
const T_1600 = 16 * 3600;
const T_1800 = 18 * 3600;

export function getMarketSession(now: Date = new Date()): MarketSession {
  if (!isBusinessDay(now)) return 'holiday';
  const s = kstSecondsOfDay(now);
  if (s >= T_0830 && s < T_0840) return 'pre_extended';
  if (s >= T_0840 && s < T_0900) return 'pre_auction';
  if (s >= T_0900 && s < T_1520) return 'regular';
  if (s >= T_1520 && s < T_1530) return 'close_auction';
  if (s >= T_1540 && s < T_1600) return 'post_extended';
  if (s >= T_1600 && s < T_1800) return 'after_single';
  return 'closed';
}

// UX 표시용 — 세션을 (이모지, 라벨) 한 쌍으로 압축
export function sessionLabel(s: MarketSession): { icon: string; label: string } {
  switch (s) {
    case 'regular': return { icon: '🟢', label: '정규장' };
    case 'pre_extended': return { icon: '🟡', label: '장전 시간외 종가' };
    case 'pre_auction': return { icon: '🟡', label: '장전 동시호가' };
    case 'close_auction': return { icon: '🟡', label: '장후 동시호가' };
    case 'post_extended': return { icon: '🟡', label: '장후 시간외 종가' };
    case 'after_single': return { icon: '🟡', label: '시간외 단일가' };
    case 'holiday': return { icon: '🔴', label: '휴장일' };
    case 'closed':
    default: return { icon: '🔴', label: '장 종료' };
  }
}

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

  // 평일이면서 휴장일이 아닌 첫 날까지 +1일
  for (let i = 0; i < 30; i++) {
    const dayKst = new Date(candidate.getTime() + KST_OFFSET_MS).getUTCDay();
    if (dayKst !== 0 && dayKst !== 6 && !isHoliday(candidate)) return candidate;
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
