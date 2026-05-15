// 관심종목 CRUD API

import type { Context } from 'hono';
import {
  addWatchlist,
  listWatchlist,
  removeWatchlistByIds,
} from '../db/repo.js';
import { resolveSymbol } from '../fastpath/symbol.js';
import { getDefaultChatId } from './_auth.js';

export function handleWatchlistList(c: Context) {
  const chatId = getDefaultChatId();
  const rows = listWatchlist(chatId);
  return c.json({
    items: rows.map((r) => ({
      id: r.id,
      code: r.symbolCode,
      name: r.symbolName,
      market: r.market,
      addedAt: r.addedAt,
    })),
  });
}

export async function handleWatchlistAdd(c: Context) {
  const chatId = getDefaultChatId();
  let body: { code?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }
  const code = (body.code ?? '').trim();
  if (!code) return c.json({ error: 'code required' }, 400);

  const sym = await resolveSymbol(code);
  if (!sym) return c.json({ error: `종목을 찾지 못했습니다: ${code}` }, 404);

  const r = addWatchlist({
    chatId,
    market: 'KRX',
    symbolCode: sym.code,
    symbolName: sym.name,
  });
  return c.json({ ok: true, added: r.added, existed: r.existed, code: sym.code, name: sym.name });
}

export function handleWatchlistRemove(c: Context) {
  const chatId = getDefaultChatId();
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'invalid id' }, 400);
  const removed = removeWatchlistByIds(chatId, [id]);
  return c.json({ ok: removed > 0, removed });
}
