// NAVER 비공식 차트 API (m.stock.naver.com).
// 직접 지원: minute, minute3/5/10/15/30/60, day, week, month
// 4시간봉은 1시간봉(minute60) 합성으로 만듦 (한국 정규장 6.5시간이라 어색하지만 사용자 요청).
//
// 거래는 KIS 사용, 차트만 NAVER로 분리.

import type { Candle } from './candle.js';

type NaverMinute = {
  localDateTime: string; // YYYYMMDDHHMMSS
  currentPrice: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  accumulatedTradingVolume: number;
};

type NaverDay = {
  localDate: string;
  closePrice: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  accumulatedTradingVolume: number;
};

const HEADERS = { Referer: 'https://m.stock.naver.com/', 'User-Agent': 'Mozilla/5.0' };

function ymdHm(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}0000`;
}

// 분봉 fetcher. unit ∈ {1, 3, 5, 10, 15, 30, 60}.
// targetBars 만큼 받기 위해 충분한 과거 날짜로 startDateTime 설정.
export async function fetchNaverMinuteBars(
  code: string,
  unit: 1 | 3 | 5 | 10 | 15 | 30 | 60,
  targetBars = 120,
): Promise<Candle[]> {
  // 한국 정규장: 9:00~15:30 = 390분/일. unit별 봉 개수/일.
  const barsPerDay = Math.max(1, Math.floor(390 / unit));
  // 휴장일 고려해 1.6배 기간 + 여유
  const days = Math.max(2, Math.ceil((targetBars * 1.6) / barsPerDay));
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 3600 * 1000);
  const endpoint = unit === 1 ? 'minute' : `minute${unit}`;
  const url = `https://api.stock.naver.com/chart/domestic/item/${code}/${endpoint}?startDateTime=${ymdHm(start)}&endDateTime=${ymdHm(end)}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`NAVER ${endpoint} HTTP ${res.status}`);
  const data = (await res.json()) as NaverMinute[];
  return data.map((r) => ({
    // 다일치라 MM/DD HH:MM 형태로
    time:
      `${r.localDateTime.slice(4, 6)}/${r.localDateTime.slice(6, 8)} ${r.localDateTime.slice(8, 10)}:${r.localDateTime.slice(10, 12)}`,
    open: r.openPrice,
    high: r.highPrice,
    low: r.lowPrice,
    close: r.currentPrice,
    volume: r.accumulatedTradingVolume,
  }));
}

// 일봉 — count만큼.
export async function fetchNaverDaily(code: string, count = 100): Promise<Candle[]> {
  const end = new Date();
  const start = new Date(end.getTime() - Math.ceil(count * 1.6 * 24 * 3600 * 1000));
  const url = `https://api.stock.naver.com/chart/domestic/item/${code}/day?startDateTime=${ymdHm(start)}&endDateTime=${ymdHm(end)}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`NAVER day HTTP ${res.status}`);
  const data = (await res.json()) as NaverDay[];
  const trimmed = data.slice(-count);
  return trimmed.map((r) => ({
    time: `${r.localDate.slice(4, 6)}/${r.localDate.slice(6, 8)}`, // MM/DD
    open: r.openPrice,
    high: r.highPrice,
    low: r.lowPrice,
    close: r.closePrice,
    volume: r.accumulatedTradingVolume,
  }));
}
