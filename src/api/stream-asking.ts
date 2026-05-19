// GET /api/stream/asking?code=005930 — KIS 호가 실시간 SSE 푸시.
// PWA OrderBook이 EventSource로 연결. 끊으면 자동 unsubscribe.

import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getKisWsClient, type AskingSnapshot } from '../kis/ws.js';

export async function handleStreamAsking(c: Context) {
  const code = c.req.query('code')?.trim() ?? '';
  if (!code || !/^\d{6}$/.test(code)) {
    return c.text('invalid code', 400);
  }
  return streamSSE(c, async (stream) => {
    const ws = getKisWsClient();
    let unsub: (() => void) | null = null;
    try {
      unsub = await ws.subscribeAsking(code, (snap: AskingSnapshot) => {
        // SSE write는 비동기지만 catch는 streamSSE 내부에서 처리
        stream.writeSSE({ event: 'asking', data: JSON.stringify(snap) }).catch(() => {});
      });
      // 첫 keepalive
      await stream.writeSSE({ event: 'ready', data: '{}' });
      // 클라이언트 끊을 때까지 대기
      await new Promise<void>((resolve) => {
        stream.onAbort(() => resolve());
      });
    } catch (err) {
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: (err as Error).message }) });
    } finally {
      try { unsub?.(); } catch {}
    }
  });
}
