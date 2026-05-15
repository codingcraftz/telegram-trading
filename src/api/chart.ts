// GET /api/chart?code=005930&interval=5m — 차트 PNG 직접 반환.

import type { Context } from 'hono';
import { handleChart, type ChartInterval } from '../fastpath/chart.js';

const VALID_INTERVALS: ReadonlyArray<ChartInterval> = ['1m', '5m', '15m', '1h', '4h', '1d'];

export async function handleChartApi(c: Context) {
  const code = c.req.query('code')?.trim() ?? '';
  const interval = (c.req.query('interval')?.trim() ?? '1d') as ChartInterval;
  if (!code || !/^\d{6}$/.test(code)) {
    return c.json({ error: 'invalid code' }, 400);
  }
  if (!VALID_INTERVALS.includes(interval)) {
    return c.json({ error: 'invalid interval' }, 400);
  }

  const r = await handleChart({ sym: code, interval });
  if (typeof r === 'string') {
    return c.json({ error: r }, 502);
  }
  // Buffer → Uint8Array view (Response가 받는 타입)
  const bytes = new Uint8Array(r.png.buffer, r.png.byteOffset, r.png.byteLength);
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=30',
      'x-caption': encodeURIComponent(r.caption),
    },
  });
}
