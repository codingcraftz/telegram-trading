// GET /api/candles?code=005930&interval=1m|5m|15m|1h|4h|1d|1w|1M&count=180
// lightweight-charts JSON 캔들 배열 반환.

import type { Context } from 'hono';
import { fetchNaverDaily, fetchNaverMinuteBars } from '../charts/naver.js';

type Interval = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w' | '1M';
const VALID: ReadonlyArray<Interval> = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'];

// 1시간봉 → 4시간봉 합성
function aggregateHourlyTo4h<T extends { ts: number; open: number; high: number; low: number; close: number; volume: number }>(hourly: T[]): T[] {
  if (hourly.length === 0) return [];
  const out: T[] = [];
  for (let i = 0; i < hourly.length; i += 4) {
    const group = hourly.slice(i, i + 4);
    if (group.length === 0) continue;
    out.push({
      ts: group[0]!.ts,
      open: group[0]!.open,
      close: group[group.length - 1]!.close,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      volume: group.reduce((s, c) => s + (c.volume ?? 0), 0),
    } as T);
  }
  return out;
}

// 일봉을 주봉(월요일 시작 KST)으로 합성
function aggregateDailyToWeekly<T extends { ts: number; open: number; high: number; low: number; close: number; volume: number }>(daily: T[]): T[] {
  if (daily.length === 0) return [];
  const out: T[] = [];
  let bucket: T[] = [];
  let curWeekKey = '';
  function weekKey(ms: number) {
    // KST 기준 월요일을 찾아 주 식별자로 사용
    const kst = new Date(ms + 9 * 3600 * 1000);
    const day = kst.getUTCDay(); // 0=Sun
    const diffToMon = (day + 6) % 7;
    const monday = new Date(kst);
    monday.setUTCDate(kst.getUTCDate() - diffToMon);
    return `${monday.getUTCFullYear()}-${monday.getUTCMonth() + 1}-${monday.getUTCDate()}`;
  }
  function flush() {
    if (bucket.length === 0) return;
    out.push({
      ts: bucket[0]!.ts,
      open: bucket[0]!.open,
      close: bucket[bucket.length - 1]!.close,
      high: Math.max(...bucket.map((c) => c.high)),
      low: Math.min(...bucket.map((c) => c.low)),
      volume: bucket.reduce((s, c) => s + (c.volume ?? 0), 0),
    } as T);
  }
  for (const d of daily) {
    const k = weekKey(d.ts);
    if (k !== curWeekKey) {
      flush();
      bucket = [];
      curWeekKey = k;
    }
    bucket.push(d);
  }
  flush();
  return out;
}

// 일봉을 월봉으로 합성
function aggregateDailyToMonthly<T extends { ts: number; open: number; high: number; low: number; close: number; volume: number }>(daily: T[]): T[] {
  if (daily.length === 0) return [];
  const out: T[] = [];
  let bucket: T[] = [];
  let curKey = '';
  function monthKey(ms: number) {
    const kst = new Date(ms + 9 * 3600 * 1000);
    return `${kst.getUTCFullYear()}-${kst.getUTCMonth()}`;
  }
  function flush() {
    if (bucket.length === 0) return;
    out.push({
      ts: bucket[0]!.ts,
      open: bucket[0]!.open,
      close: bucket[bucket.length - 1]!.close,
      high: Math.max(...bucket.map((c) => c.high)),
      low: Math.min(...bucket.map((c) => c.low)),
      volume: bucket.reduce((s, c) => s + (c.volume ?? 0), 0),
    } as T);
  }
  for (const d of daily) {
    const k = monthKey(d.ts);
    if (k !== curKey) {
      flush();
      bucket = [];
      curKey = k;
    }
    bucket.push(d);
  }
  flush();
  return out;
}

// NAVER candle (time 문자열) → lightweight-charts ts (ms)
// 일봉: "MM/DD" — 연도는 현재년도 가정 (NAVER 응답이 같은 연도 위주)
// 분봉: "MM/DD HH:MM"
function timeToMs(time: string, isDaily: boolean): number {
  const now = new Date();
  const kstYear = new Date(now.getTime() + 9 * 3600 * 1000).getUTCFullYear();
  if (isDaily) {
    const [mm, dd] = time.split('/');
    if (!mm || !dd) return 0;
    // KST 자정 → UTC
    return Date.UTC(kstYear, Number(mm) - 1, Number(dd)) - 9 * 3600 * 1000;
  }
  const [date, hm] = time.split(' ');
  if (!date || !hm) return 0;
  const [mm, dd] = date.split('/');
  const [hh, mn] = hm.split(':');
  if (!mm || !dd || !hh || !mn) return 0;
  return (
    Date.UTC(kstYear, Number(mm) - 1, Number(dd), Number(hh), Number(mn)) - 9 * 3600 * 1000
  );
}

export async function handleCandles(c: Context) {
  const code = c.req.query('code')?.trim() ?? '';
  const interval = ((c.req.query('interval')?.trim() ?? '5m') as Interval);
  const count = Math.min(500, Math.max(30, Number(c.req.query('count') ?? '180')));
  if (!code || !/^\d{6}$/.test(code)) {
    return c.json({ error: 'invalid code' }, 400);
  }
  if (!VALID.includes(interval)) {
    return c.json({ error: 'invalid interval' }, 400);
  }

  try {
    let raw;
    const isDaily = interval === '1d' || interval === '1w' || interval === '1M';
    if (interval === '1d') {
      raw = await fetchNaverDaily(code, count);
    } else if (interval === '1w') {
      // 주봉 count 만큼 → 일봉 count*7 받아 합성
      raw = await fetchNaverDaily(code, Math.min(2000, count * 7));
    } else if (interval === '1M') {
      // 월봉 count 만큼 → 일봉 count*22 받아 합성
      raw = await fetchNaverDaily(code, Math.min(3000, count * 22));
    } else if (interval === '4h') {
      const hourly = await fetchNaverMinuteBars(code, 60, count * 4);
      raw = hourly;
    } else {
      const unit =
        interval === '1m'
          ? 1
          : interval === '5m'
            ? 5
            : interval === '15m'
              ? 15
              : interval === '30m'
                ? 30
                : 60;
      raw = await fetchNaverMinuteBars(code, unit as 1 | 3 | 5 | 10 | 15 | 30 | 60, count);
    }
    let candles = raw.map((r) => ({
      // tsMs(정확한 epoch) 우선, fallback은 time 문자열 파싱
      ts: r.tsMs ?? timeToMs(r.time, isDaily),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume ?? 0,
    })).filter((c) => c.ts > 0);

    if (interval === '4h') candles = aggregateHourlyTo4h(candles);
    else if (interval === '1w') candles = aggregateDailyToWeekly(candles).slice(-count);
    else if (interval === '1M') candles = aggregateDailyToMonthly(candles).slice(-count);

    return c.json({ candles, count: candles.length, interval, code });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502);
  }
}
