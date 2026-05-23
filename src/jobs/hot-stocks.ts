// 장마감 후 HOT 종목 수집 — 29%↑ + EMA 상승트렌드 + 테마.
// 1일 1회 실행, daily_hot_stocks 테이블에 저장.

import iconv from 'iconv-lite';
import { getDb } from '../db/client.js';
import { dailyHotStocks } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const NAVER_HEADERS = { 'User-Agent': UA, Referer: 'https://m.stock.naver.com/' };

function todayKst(): string {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  // 장마감(15:30) 후 수집 → 날짜는 당일 시장 영업일.
  // 자정 이후(00:00~08:59)에 실행되면 전일이 영업일이므로 하루 빼기.
  if (kst.getUTCHours() < 9) kst.setUTCDate(kst.getUTCDate() - 1);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`;
}

// ===== NAVER 시세 =====
type MarketStock = { code: string; name: string; price: number; changePct: number; volume: number };

async function fetchMarketStocks(market: 'KOSPI' | 'KOSDAQ'): Promise<MarketStock[]> {
  const items: MarketStock[] = [];
  for (let page = 1; page <= 40; page++) {
    const url = `https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${page}&pageSize=100`;
    const res = await fetch(url, { headers: NAVER_HEADERS, signal: AbortSignal.timeout(10_000) });
    const data = await res.json() as { stocks?: Array<Record<string, string>> };
    const stocks = data.stocks ?? [];
    if (stocks.length === 0) break;
    for (const s of stocks) {
      try {
        items.push({
          code: s.itemCode ?? '',
          name: s.stockName ?? '',
          price: Number((s.closePrice ?? '0').replace(/,/g, '')),
          changePct: Number(s.fluctuationsRatio ?? 0),
          volume: Number((s.accumulatedTradingVolume ?? '0').replace(/,/g, '')),
        });
      } catch { /* skip */ }
    }
  }
  return items;
}

// ===== EMA =====
async function fetchDailyCloses(code: string): Promise<number[]> {
  const end = new Date();
  const start = new Date(end.getTime() - 200 * 24 * 3600 * 1000);
  const fmt = (d: Date) => {
    const k = new Date(d.getTime() + 9 * 3600 * 1000);
    return `${k.getUTCFullYear()}${String(k.getUTCMonth() + 1).padStart(2, '0')}${String(k.getUTCDate()).padStart(2, '0')}0000`;
  };
  const url = `https://api.stock.naver.com/chart/domestic/item/${code}/day?startDateTime=${fmt(start)}&endDateTime=${fmt(end)}`;
  const res = await fetch(url, { headers: NAVER_HEADERS, signal: AbortSignal.timeout(10_000) });
  const data = await res.json() as Array<{ closePrice?: number }>;
  return data.map(d => d.closePrice ?? 0).filter(p => p > 0);
}

function ema(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let val = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) val = prices[i]! * k + val * (1 - k);
  return val;
}

// ===== 테마 =====
async function fetchKoreanHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8_000) });
  const buf = Buffer.from(await res.arrayBuffer());
  return iconv.decode(buf, 'euc-kr');
}

type ThemeInfo = { name: string; pct: number; hot: boolean };

async function fetchStockThemes(
  targetCodes: Set<string>,
): Promise<Map<string, ThemeInfo[]>> {
  const result = new Map<string, ThemeInfo[]>();
  for (const c of targetCodes) result.set(c, []);

  // 테마 목록
  const html = await fetchKoreanHtml('https://finance.naver.com/sise/theme.naver');
  const chunks = html.split('<td class="col_type1">').slice(1);
  const themes: Array<{ no: number; name: string; pct: number }> = [];
  for (const c of chunks) {
    const m = c.match(/no=(\d+)">([^<]+)/);
    if (!m) continue;
    const pctM = c.match(/(red01|nv01)[^>]*>\s*([+-]?[\d.]+)%/);
    themes.push({ no: Number(m[1]), name: m[2]!.trim(), pct: pctM ? Number(pctM[2]) : 0 });
  }
  themes.sort((a, b) => b.pct - a.pct);
  const hotNames = new Set(themes.slice(0, 20).map(t => t.name));

  // 각 테마 종목 확인
  for (const t of themes) {
    try {
      const dhtml = await fetchKoreanHtml(
        `https://finance.naver.com/sise/sise_group_detail.naver?type=theme&no=${t.no}`,
      );
      const codes = (dhtml.match(/code=\d{6}/g) ?? []).map(m => m.replace('code=', ''));
      for (const c of new Set(codes)) {
        if (targetCodes.has(c)) {
          result.get(c)!.push({ name: t.name, pct: t.pct, hot: hotNames.has(t.name) });
        }
      }
      await sleep(80);
    } catch { /* skip */ }
  }

  return result;
}

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

// ===== 기업개요 =====
async function fetchCompanyDesc(code: string): Promise<string> {
  try {
    const res = await fetch(`https://finance.naver.com/item/main.naver?code=${code}`, {
      headers: { 'User-Agent': UA, 'Accept-Encoding': 'identity' },
      signal: AbortSignal.timeout(8_000),
    });
    const html = await res.text();
    const m = html.match(/summary_info[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/);
    if (m) return m[1]!.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
  } catch { /* skip */ }
  return '';
}

// ===== 메인 =====
export type HotStock = {
  code: string;
  name: string;
  price: number;
  changePct: number;
  volume: number;
  themes: ThemeInfo[];
  emaUptrend: boolean;
  description: string;
};

export async function collectHotStocks(): Promise<HotStock[]> {
  console.log('[hot-stocks] collecting...');

  // 1) 전종목 시세
  const [kospi, kosdaq] = await Promise.all([
    fetchMarketStocks('KOSPI'),
    fetchMarketStocks('KOSDAQ'),
  ]);
  const all = [...kospi, ...kosdaq];

  // 2) 29%+ 필터
  const candidates = all.filter(s => s.changePct >= 29);
  console.log(`[hot-stocks] 29%+ candidates: ${candidates.length}`);
  if (candidates.length === 0) return [];

  // 3) EMA 체크
  const withEma: MarketStock[] = [];
  for (const s of candidates) {
    try {
      const closes = await fetchDailyCloses(s.code);
      const e20 = ema(closes, 20);
      const e60 = ema(closes, 60);
      if (e20 && e60 && e20 > e60) withEma.push(s);
      await sleep(100);
    } catch { /* skip */ }
  }
  console.log(`[hot-stocks] EMA uptrend: ${withEma.length}`);

  // 4) 테마 조회
  const codeSet = new Set(withEma.map(s => s.code));
  // EMA 탈락 종목도 포함 (테마는 보여줄 가치 있음)
  for (const s of candidates) codeSet.add(s.code);
  const themeMap = await fetchStockThemes(codeSet);

  // 5) 기업개요 fetch
  const descMap = new Map<string, string>();
  for (const s of candidates) {
    const desc = await fetchCompanyDesc(s.code);
    descMap.set(s.code, desc);
    await sleep(100);
  }

  // 6) 결과 조합 — 거래량 순
  const results: HotStock[] = candidates
    .sort((a, b) => b.volume - a.volume)
    .map(s => ({
      code: s.code,
      name: s.name,
      price: s.price,
      changePct: s.changePct,
      volume: s.volume,
      themes: (themeMap.get(s.code) ?? []).sort((a, b) => b.pct - a.pct).slice(0, 4),
      emaUptrend: withEma.some(e => e.code === s.code),
      description: descMap.get(s.code) ?? '',
    }));

  console.log(`[hot-stocks] final: ${results.length} stocks`);
  return results;
}

export async function runAndSave(): Promise<void> {
  const date = todayKst();
  // 이미 수집됐으면 skip
  const existing = getDb().select().from(dailyHotStocks).where(eq(dailyHotStocks.date, date)).get();
  if (existing) {
    console.log(`[hot-stocks] already collected for ${date}`);
    return;
  }

  try {
    const stocks = await collectHotStocks();
    getDb().insert(dailyHotStocks).values({
      date,
      dataJson: JSON.stringify(stocks),
      createdAt: Date.now(),
    }).run();
    console.log(`[hot-stocks] saved ${stocks.length} stocks for ${date}`);
  } catch (err) {
    console.error('[hot-stocks] collect failed:', (err as Error).message);
  }
}
