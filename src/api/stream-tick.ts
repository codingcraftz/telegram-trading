// GET /api/stream/tick?code=005930 — KIS 체결가 실시간 SSE 푸시.

import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getKisWsClient, type TickSnapshot } from '../kis/ws.js';
import { getMarketSession } from '../scheduler/calendar.js';

export async function handleStreamTick(c: Context) {
  const code = c.req.query('code')?.trim() ?? '';
  if (!code || !/^\d{6}$/.test(code)) {
    return c.text('invalid code', 400);
  }
  // 장외 시간 — WS 연결 없이 즉시 closed 이벤트 전송, 프론트가 polling fallback.
  const session = getMarketSession();
  if (session === 'closed' || session === 'holiday') {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: 'closed', data: JSON.stringify({ session }) });
    });
  }
  return streamSSE(c, async (stream) => {
    const ws = getKisWsClient();
    let unsub: (() => void) | null = null;
    try {
      unsub = await ws.subscribeTick(code, (snap: TickSnapshot) => {
        stream.writeSSE({ event: 'tick', data: JSON.stringify(snap) }).catch(() => {});
      });
      await stream.writeSSE({ event: 'ready', data: '{}' });
      await new Promise<void>((resolve) => stream.onAbort(() => resolve()));
    } catch (err) {
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: (err as Error).message }) });
    } finally {
      try { unsub?.(); } catch {}
    }
  });
}
