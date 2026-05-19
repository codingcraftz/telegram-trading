// GET /api/indices — 주요 시장 지수 (코스피/코스닥/나스닥/다우).
// Yahoo Finance v8 unofficial chart endpoint 사용.
// 30초 캐시 — warmup worker가 주기 갱신해서 사용자 호출 시점 0ms.

import type { Context } from 'hono';
import { cached } from '../fastpath/cache.js';

type IndexItem = {
  key: string;
  label: string;
  price: number;
  change: number;
  changePct: number;
  prevClose: number;
  series: number[]; // 일봉 종가 (오래된 → 최근)
};

const INDICES: { key: string; label: string; symbol: string }[] = [
  { key: 'kospi', label: '코스피', symbol: '^KS11' },
  { key: 'kosdaq', label: '코스닥', symbol: '^KQ11' },
  { key: 'nasdaq', label: '나스닥', symbol: '^IXIC' },
  { key: 'dow', label: '다우', symbol: '^DJI' },
];

type YahooChartResp = {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
      };
      indicators?: {
        quote?: Array<{ close?: Array<number | null> }>;
      };
    }>;
  };
};

async function fetchIndex(symbol: string): Promise<{ price: number; prevClose: number; series: number[] } | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/605.1.15',
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as YahooChartResp;
  const result = data.chart?.result?.[0];
  const meta = result?.meta;
  const price = meta?.regularMarketPrice;
  const prevClose = meta?.chartPreviousClose ?? meta?.previousClose;
  if (price === undefined || prevClose === undefined) return null;
  const closes = (result?.indicators?.quote?.[0]?.close ?? []).filter((v): v is number => typeof v === 'number');
  return { price, prevClose, series: closes };
}

// 4개 지수 동시 fetch — 모두 묶어 한 캐시 키. 30s TTL.
export async function fetchIndicesItems(): Promise<IndexItem[]> {
  return cached('indices:all', 30_000, async () => {
    const results = await Promise.all(
      INDICES.map(async (it): Promise<IndexItem | null> => {
        try {
          const r = await fetchIndex(it.symbol);
          if (!r) return null;
          const change = r.price - r.prevClose;
          const changePct = r.prevClose !== 0 ? (change / r.prevClose) * 100 : 0;
          return {
            key: it.key,
            label: it.label,
            price: r.price,
            change,
            changePct,
            prevClose: r.prevClose,
            series: r.series,
          };
        } catch {
          return null;
        }
      }),
    );
    return results.filter((x): x is IndexItem => x !== null);
  });
}

export async function handleIndices(c: Context) {
  const items = await fetchIndicesItems();
  return c.json({ items });
}
