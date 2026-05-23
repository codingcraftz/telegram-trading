// GET /api/stock-info?code=069540 — 기업개요 (네이버 finance 스크래핑)

import type { Context } from 'hono';
import { cached } from '../fastpath/cache.js';

export async function handleStockInfo(c: Context) {
  const code = c.req.query('code')?.trim() ?? '';
  if (!code || !/^\d{6}$/.test(code)) return c.json({ error: 'invalid code' }, 400);

  try {
    const desc = await cached(`stock-info:${code}`, 24 * 60 * 60 * 1000, async () => {
      const res = await fetch(`https://finance.naver.com/item/main.naver?code=${code}`, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'identity' },
        signal: AbortSignal.timeout(8_000),
      });
      const html = await res.text();
      // 기업개요 첫 번째 <p>
      const m = html.match(/summary_info[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/);
      if (!m) return '';
      return m[1]!.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    });
    return c.json({ code, description: desc });
  } catch {
    return c.json({ code, description: '' });
  }
}
