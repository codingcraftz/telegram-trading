// 한국 거래소(KRX) 휴장일 — KIS chk_holiday API (1차) + 정적 JSON (fallback).
//
// 흐름:
//   1) 봇 시작 시 prefetchHolidays() 1회 → 향후 60일치 KIS 조회 → in-memory map
//   2) isHoliday(date) 호출 시: 동적 map 우선 → 없으면 정적 KRX 데이터
//   3) 매일 KST 03:00에 자동 prefetch (worker가 트리거)
//
// KIS chk_holiday 응답 output 배열에서:
//   - bass_dt: YYYYMMDD
//   - opnd_yn: 'Y'면 개장(정상 거래일), 'N'이면 휴장

import { callKisApi } from '../mcp/kis.js';
import { parseMcpResult, findOutput } from '../fastpath/extract.js';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 정적 fallback (KIS API 실패 시 사용)
const HOLIDAYS_STATIC: Record<string, string[]> = {
  '2026': [
    '2026-01-01',
    '2026-02-16',
    '2026-02-17',
    '2026-02-18',
    '2026-03-02',
    '2026-03-03',
    '2026-05-05',
    '2026-05-25',
    '2026-06-03',
    '2026-08-17',
    '2026-09-24',
    '2026-09-25',
    '2026-10-05',
    '2026-10-09',
    '2026-12-25',
    '2026-12-31',
  ],
  '2027': [
    '2027-01-01',
    '2027-02-08',
    '2027-02-09',
    '2027-03-01',
    '2027-03-03',
    '2027-05-05',
    '2027-05-13',
    '2027-06-03',
    '2027-06-07',
    '2027-08-16',
    '2027-09-14',
    '2027-09-15',
    '2027-09-16',
    '2027-10-04',
    '2027-10-11',
    '2027-12-31',
  ],
};

const STATIC_SET: Set<string> = new Set(Object.values(HOLIDAYS_STATIC).flat());

// 동적 캐시: KIS chk_holiday로 받은 결과. key = YYYY-MM-DD, value = true(휴장)/false(개장).
// undefined면 모름 → 정적 데이터로 fallback.
const DYNAMIC_MAP: Map<string, boolean> = new Map();

function toKstDateKey(date: Date): string {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toKisDateFmt(date: Date): string {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  return `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, '0')}${String(kst.getUTCDate()).padStart(2, '0')}`;
}

// 토/일은 isHoliday에 포함하지 않음 (calendar.ts가 별도 주말 체크)
export function isHoliday(date: Date): boolean {
  const key = toKstDateKey(date);
  const dyn = DYNAMIC_MAP.get(key);
  if (dyn !== undefined) return dyn;
  return STATIC_SET.has(key);
}

// 다음 영업일(평일 + 휴장 아님). 인자 date의 다음날부터 검사.
export function nextBusinessDay(after: Date): Date {
  const oneDay = 24 * 60 * 60 * 1000;
  let cursor = new Date(after.getTime() + oneDay);
  for (let i = 0; i < 60; i++) {
    const kst = new Date(cursor.getTime() + KST_OFFSET_MS);
    const day = kst.getUTCDay();
    if (day !== 0 && day !== 6 && !isHoliday(cursor)) return cursor;
    cursor = new Date(cursor.getTime() + oneDay);
  }
  return cursor;
}

// 이전 영업일(평일 + 휴장 아님). 인자 date의 전날부터 역순 검사.
export function prevBusinessDay(before: Date): Date {
  const oneDay = 24 * 60 * 60 * 1000;
  let cursor = new Date(before.getTime() - oneDay);
  for (let i = 0; i < 60; i++) {
    const kst = new Date(cursor.getTime() + KST_OFFSET_MS);
    const day = kst.getUTCDay();
    if (day !== 0 && day !== 6 && !isHoliday(cursor)) return cursor;
    cursor = new Date(cursor.getTime() - oneDay);
  }
  return cursor;
}

// KIS chk_holiday로 향후 N일치 미리 조회 → DYNAMIC_MAP 채움.
// KIS API는 1일 1행 응답. inqr_bass_dt가 시작일, output1 배열에 N행 반환 (보통 30~40행).
// 실패 시 무시 (정적 데이터로 fallback).
export async function prefetchHolidays(daysAhead: number = 60): Promise<{ filled: number; failed: boolean }> {
  let filled = 0;
  try {
    // KIS chk_holiday는 1회 호출 시 ~30일치 반환. 두 번 호출해서 60일 커버.
    const today = new Date();
    const calls = Math.ceil(daysAhead / 30);
    for (let i = 0; i < calls; i++) {
      const baseDate = new Date(today.getTime() + i * 30 * 24 * 3600 * 1000);
      const res = await callKisApi('domestic_stock', 'chk_holiday', {
        bass_dt: toKisDateFmt(baseDate),
        ctx_area_nk: '',
        ctx_area_fk: '',
      });
      const parsed = parseMcpResult(res);
      if (!parsed.success) continue;
      const list = findOutput(parsed, 'output');
      const rows = Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
      for (const row of rows) {
        const dt = String(row.bass_dt ?? '');
        const opnd = String(row.opnd_yn ?? '');
        if (dt.length === 8 && (opnd === 'Y' || opnd === 'N')) {
          const key = `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`;
          DYNAMIC_MAP.set(key, opnd === 'N');
          filled++;
        }
      }
    }
    console.log(`[holidays] prefetched ${filled} days (next ${daysAhead} days)`);
    return { filled, failed: filled === 0 };
  } catch (err) {
    console.warn('[holidays] prefetch failed, using static fallback:', (err as Error).message);
    return { filled, failed: true };
  }
}

// 디버그용 — 현재 동적 캐시 상태
export function getDynamicHolidayMap(): Map<string, boolean> {
  return new Map(DYNAMIC_MAP);
}
