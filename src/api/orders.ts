// GET /api/orders — 3 소스 통합 (pendingIntents + reservations + KIS 미체결)

import type { Context } from 'hono';
import {
  listChatPendingIntents,
  listChatReservations,
  type OrderSpec,
} from '../db/repo.js';
import { fetchPendingOrders } from '../fastpath/pending.js';
import { getDefaultChatId } from './_auth.js';

function parseSpec(json: string): OrderSpec | null {
  try {
    return JSON.parse(json) as OrderSpec;
  } catch {
    return null;
  }
}

export async function handleOrders(c: Context) {
  const chatId = getDefaultChatId();
  const now = Date.now();
  const intents = listChatPendingIntents(chatId);
  const reservations = listChatReservations(chatId, ['awaiting_confirm', 'pending']);

  let kis: Awaited<ReturnType<typeof fetchPendingOrders>> = { ok: false, items: [] };
  try {
    kis = await fetchPendingOrders();
  } catch (err) {
    kis = { ok: false, error: (err as Error).message, items: [] };
  }

  return c.json({
    intents: intents.map((i) => {
      const spec = parseSpec(i.orderSpecJson);
      return {
        id: i.id,
        action: spec?.action ?? '?',
        code: spec?.symbol_code ?? '',
        name: spec?.symbol_name ?? '?',
        quantity: spec?.quantity ?? 0,
        orderType: spec?.order_type ?? 'market',
        price: spec?.price ?? null,
        tpPct: spec?.tp_pct ?? null,
        slPct: spec?.sl_pct ?? null,
        createdAt: i.createdAt,
        expiresAt: i.expiresAt,
        remainingMs: Math.max(0, i.expiresAt - now),
      };
    }),
    reservations: reservations.map((r) => ({
      id: r.id,
      code: r.symbolCode,
      name: r.symbolName,
      qtyMode: r.qtyMode,
      qtyValue: r.qtyValue,
      gapGuardPct: r.gapGuardPct,
      tpPct: r.tpPct,
      slPct: r.slPct,
      scheduledFor: r.scheduledFor,
      state: r.state,
      expiresAt: r.expiresAt,
      remainingMs: r.state === 'awaiting_confirm' ? Math.max(0, r.expiresAt - now) : null,
    })),
    kis: kis.ok
      ? {
          ok: true,
          items: kis.items.map((it) => ({
            code: it.code,
            name: it.name,
            side: it.side,
            qty: it.qty,
            price: it.price,
            filled: it.filled,
            remaining: it.remaining,
            time: it.time,
            orgno: it.orgno,
            odno: it.odno,
            ordDvsn: it.ordDvsn,
          })),
        }
      : { ok: false, error: kis.error, items: [] },
  });
}
