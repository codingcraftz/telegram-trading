// GET /api/ranking?category=volume|qty|change_up|change_down — 거래대금/거래량/상승/하락 순위.
// KIS volume_rank + fluctuation API를 어댑팅. 시세 카테고리라 항상 실전 키로 호출.

import type { Context } from 'hono';
import { callKisApi } from '../mcp/kis.js';
import { num, outputList, parseMcpResult } from '../fastpath/extract.js';
import { cached } from '../fastpath/cache.js';

type Category = 'volume' | 'qty' | 'change_up' | 'change_down';
const LIMIT = 20;

export type RankingItem = {
  rank: number;
  code: string;
  name: string;
  price: number;
  changePct: number;
  volume: number;
  tradeAmount: number;
};

async function fetchVolumeRank(): Promise<RankingItem[]> {
  const res = await cached('ranking:volume_rank', 30_000, () =>
    callKisApi('domestic_stock', 'volume_rank', {}),
  );
  const parsed = parseMcpResult(res);
  if (!parsed.success) return [];
  const list = outputList(parsed, 'output');
  return list.map((it, i) => ({
    rank: i + 1,
    code: String(it.mksc_shrn_iscd ?? it.stck_shrn_iscd ?? it.pdno ?? ''),
    name: String(it.hts_kor_isnm ?? it.prdt_name ?? ''),
    price: num(it.stck_prpr) ?? 0,
    changePct: num(it.prdy_ctrt) ?? 0,
    volume: num(it.acml_vol) ?? 0,
    tradeAmount: num(it.acml_tr_pbmn) ?? 0,
  }));
}

async function fetchFluctuation(direction: 'up' | 'down'): Promise<RankingItem[]> {
  const res = await cached(`ranking:fluctuation:${direction}`, 30_000, () =>
    callKisApi('domestic_stock', 'fluctuation', {
      fid_rank_sort_cls_code: direction === 'up' ? '0' : '1',
    }),
  );
  const parsed = parseMcpResult(res);
  if (!parsed.success) return [];
  const list = outputList(parsed, 'output');
  return list.map((it, i) => ({
    rank: i + 1,
    code: String(it.stck_shrn_iscd ?? it.mksc_shrn_iscd ?? it.pdno ?? ''),
    name: String(it.hts_kor_isnm ?? it.prdt_name ?? ''),
    price: num(it.stck_prpr) ?? 0,
    changePct: num(it.prdy_ctrt) ?? 0,
    volume: num(it.acml_vol) ?? 0,
    tradeAmount: num(it.acml_tr_pbmn) ?? 0,
  }));
}

export async function handleRanking(c: Context) {
  const cat = (c.req.query('category') as Category | undefined) ?? 'volume';
  try {
    let items: RankingItem[];
    if (cat === 'change_up') {
      items = await fetchFluctuation('up');
    } else if (cat === 'change_down') {
      items = await fetchFluctuation('down');
    } else {
      // volume (거래대금) / qty (거래량) 모두 volume_rank 응답 재정렬
      const base = await fetchVolumeRank();
      const sorted = [...base];
      if (cat === 'volume') sorted.sort((a, b) => b.tradeAmount - a.tradeAmount);
      else sorted.sort((a, b) => b.volume - a.volume);
      items = sorted.map((it, i) => ({ ...it, rank: i + 1 }));
    }
    return c.json({ category: cat, items: items.slice(0, LIMIT) });
  } catch (err) {
    return c.json({ error: (err as Error).message, items: [] }, 502);
  }
}

