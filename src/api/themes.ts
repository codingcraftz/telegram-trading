// GET /api/themes           — 네이버 finance 테마 랭킹 (전일대비 등락률 내림차순, 상위 N개)
// GET /api/themes/:no       — 특정 테마의 소속 종목 list
//
// 출처: https://finance.naver.com/sise/theme.naver (euc-kr 인코딩)
// 캐싱: 테마 랭킹 1시간 / 테마 상세 30분.

import type { Context } from 'hono';
import iconv from 'iconv-lite';
import { cached } from '../fastpath/cache.js';

const NAVER_THEME_LIST_URL = 'https://finance.naver.com/sise/theme.naver';
const NAVER_THEME_DETAIL_URL = 'https://finance.naver.com/sise/sise_group_detail.naver';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

export type ThemeItem = {
  no: number;
  name: string;
  /** 전일대비 등락률 (%) */
  changePct: number;
  /** 상승/보합/하락 종목 수 */
  upCount: number;
  flatCount: number;
  downCount: number;
  /** 주도주 2개 (이름만, 길어도 ".." 으로 잘림) */
  leadingStocks: string[];
};

export type ThemeStock = {
  code: string;
  name: string;
  price: number;
  /** 전일대비 (원, 부호 포함) */
  change: number;
  /** 등락률 (%) */
  changePct: number;
};

// ===== 네이버 페이지 fetch + euc-kr → utf-8 =====
async function fetchKoreanHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`naver ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return iconv.decode(buf, 'euc-kr');
}

// ===== 테마 랭킹 파싱 =====
// 각 행:
//   <td class="col_type1"><a href="/sise/sise_group_detail.naver?type=theme&no=590">테마명</a></td>
//   <td class="number col_type2"><span class="... red01 or nv01">+/-X.XX%</span></td>
//   <td class="number col_type3">최근3일 등락률</td>
//   <td class="number col_type4">상승종목수</td>
//   <td class="number col_type4">보합</td>
//   <td class="number col_type4">하락종목수</td>
//   <td class="ls col_type5">...<a href="/item/main.naver?code=...">주도주1</a></td>
//   <td class="ls col_type6">...<a href="/item/main.naver?code=...">주도주2</a></td>
function parseThemes(html: string): ThemeItem[] {
  // col_type1 위치 기준 chunk 분할. 각 chunk 가 한 테마 row.
  const chunks = html.split(/<td class="col_type1">/).slice(1);
  const out: ThemeItem[] = [];
  for (const chunk of chunks) {
    // 테마 no + 이름
    const head = chunk.match(/sise_group_detail\.naver\?type=theme&no=(\d+)">([^<]+)</);
    if (!head) continue;
    const no = Number(head[1]);
    const name = decodeEntities(head[2]!).trim();
    if (!no || !name) continue;

    // 전일대비 등락률 — 첫 번째 red01/nv01 span 의 +/-X.XX%
    const pctMatch = chunk.match(/(?:red01|nv01)[^>]*>\s*([+\-]?[\d.]+)%/);
    const changePct = pctMatch ? Number(pctMatch[1]) : 0;

    // col_type4 가 3개: 상승종목 / 보합 / 하락종목
    const col4 = [...chunk.matchAll(/col_type4">(\d+)</g)].map((m) => Number(m[1]));
    const upCount = col4[0] ?? 0;
    const flatCount = col4[1] ?? 0;
    const downCount = col4[2] ?? 0;

    // 주도주 — /item/main.naver?code=... 링크의 종목명. col_type5/6 안.
    const leadMatches = [...chunk.matchAll(/\/item\/main\.naver\?code=\d+">([^<]+)</g)];
    const leadingStocks = leadMatches.slice(0, 2).map((m) => decodeEntities(m[1]!).trim());

    out.push({ no, name, changePct, upCount, flatCount, downCount, leadingStocks });
  }
  out.sort((a, b) => b.changePct - a.changePct);
  return out;
}

// ===== 테마 상세 (소속 종목) 파싱 =====
// 각 종목 row:
//   <td class="name">...<a href="/item/main.naver?code=XXXXXX">종목명</a>...</td>
//   <td class="number">현재가</td>
//   <td class="number">...<span class="... red01/nv01/red02/nv02">대비</span></td>
//   <td class="number">...<span class="... red01/nv01">등락률%</span></td>
function parseThemeStocks(html: string): ThemeStock[] {
  // 종목 단위로 분리하기 위해 'class="name"' 위치 기준 chunk.
  const chunks = html.split(/<td class="name"/).slice(1);
  const out: ThemeStock[] = [];
  for (const chunk of chunks) {
    const codeMatch = chunk.match(/\/item\/main\.naver\?code=(\d{6})/);
    const nameMatch = chunk.match(/<a [^>]+>([^<]+)<\/a>/);
    if (!codeMatch || !nameMatch) continue;
    const code = codeMatch[1]!;
    const name = decodeEntities(nameMatch[1]!).trim();

    // 첫 번째 <td class="number"> 안의 숫자 = 현재가
    const priceMatch = chunk.match(/<td class="number"[^>]*>\s*([\d,]+)\s*<\/td>/);
    const price = priceMatch ? Number(priceMatch[1]!.replace(/,/g, '')) : 0;

    // 등락률 — 첫 번째 red01/nv01 span 의 숫자 (대비 또는 등락률, 둘 다 가능. red02/nv02 는 상한/하한)
    // 등락률 span 은 거의 +/-X.XX% 형식 — 그것만 추출
    const pctMatch = chunk.match(/(?:red01|nv01)[^>]*>\s*([+\-]?[\d.]+)%/);
    const changePct = pctMatch ? Number(pctMatch[1]) : 0;

    // 전일대비 — 등락률 직전의 가격 (red02/nv02/red01/nv01 어떤 거든)
    const changeMatch = chunk.match(/(?:red02|nv02|red01|nv01)[^>]*>\s*([\d,]+)/);
    let change = changeMatch ? Number(changeMatch[1]!.replace(/,/g, '')) : 0;
    // nv01/nv02 (하락) 면 음수로
    if (changeMatch && /nv0[12]/.test(changeMatch[0]!)) change = -change;

    if (!/^\d{6}$/.test(code) || !name) continue;
    out.push({ code, name, price, change, changePct });
  }
  return out;
}

// 가벼운 HTML entity decode (&amp; &lt; &gt; &nbsp; 등)
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// ===== Hono handlers =====
export async function handleThemes(c: Context) {
  try {
    const list = await cached('themes:list', 60 * 60 * 1000, async () => {
      const html = await fetchKoreanHtml(NAVER_THEME_LIST_URL);
      return parseThemes(html);
    });
    const limit = Math.min(50, Math.max(5, Number(c.req.query('limit') ?? '30') || 30));
    return c.json({ items: list.slice(0, limit) });
  } catch (err) {
    return c.json({ error: (err as Error).message, items: [] }, 502);
  }
}

// GET /api/themes/search?q=종목명 — 종목명/코드로 검색해 그 종목이 속한 테마들 반환.
// 첫 호출은 30개 테마 detail 을 모두 fetch (concurrent 10) — 1시간 캐시 활용해 이후 빠름.
export async function handleThemeSearch(c: Context) {
  const q = (c.req.query('q') ?? '').trim();
  if (!q) return c.json({ q, items: [] });

  try {
    const list = await cached('themes:list', 60 * 60 * 1000, async () => {
      const html = await fetchKoreanHtml(NAVER_THEME_LIST_URL);
      return parseThemes(html);
    });

    // 각 테마 detail fetch — 캐시 hit 면 즉시 반환, miss 면 네이버 호출.
    // concurrency 10 으로 batching: 30개 / 10 = 3 batch → 첫 호출 ~3초.
    const detailFor = async (no: number): Promise<ThemeStock[]> => {
      return cached(`themes:detail:${no}`, 30 * 60 * 1000, async () => {
        const html = await fetchKoreanHtml(`${NAVER_THEME_DETAIL_URL}?type=theme&no=${no}`);
        return parseThemeStocks(html);
      });
    };

    const themeStocks: { theme: ThemeItem; stocks: ThemeStock[] }[] = [];
    const concurrency = 10;
    for (let i = 0; i < list.length; i += concurrency) {
      const batch = list.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map(async (t) => {
          try { return { theme: t, stocks: await detailFor(t.no) }; }
          catch { return { theme: t, stocks: [] as ThemeStock[] }; }
        }),
      );
      themeStocks.push(...results);
    }

    const lowerQ = q.toLowerCase();
    // 종목명 부분일치 + 종목코드 일치 모두 허용. 매칭된 테마 list 반환.
    const matched = themeStocks
      .filter(({ stocks }) => stocks.some((s) => s.name.toLowerCase().includes(lowerQ) || s.code === q))
      .map(({ theme, stocks }) => ({
        ...theme,
        // 매칭된 종목 정보도 같이 (검색어가 어느 종목과 일치했는지)
        matchedStocks: stocks
          .filter((s) => s.name.toLowerCase().includes(lowerQ) || s.code === q)
          .slice(0, 3),
      }));

    return c.json({ q, items: matched });
  } catch (err) {
    return c.json({ error: (err as Error).message, items: [] }, 502);
  }
}

export async function handleThemeDetail(c: Context) {
  const no = Number(c.req.param('no'));
  if (!Number.isFinite(no) || no <= 0) {
    return c.json({ error: 'invalid theme no' }, 400);
  }
  try {
    // 테마 상세는 30분 캐싱 (가격이 자주 바뀜).
    const items = await cached(`themes:detail:${no}`, 30 * 60 * 1000, async () => {
      const url = `${NAVER_THEME_DETAIL_URL}?type=theme&no=${no}`;
      const html = await fetchKoreanHtml(url);
      return parseThemeStocks(html);
    });
    return c.json({ no, items });
  } catch (err) {
    return c.json({ error: (err as Error).message, items: [] }, 502);
  }
}
