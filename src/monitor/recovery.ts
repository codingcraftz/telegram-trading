import {
  listAllUnclosedPositions,
  markPositionOpen,
  markPositionClosed,
} from '../db/repo.js';
import { checkFill, type Market } from '../mcp/kis.js';

function extract(obj: unknown, ...keys: string[]): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim() !== '') return v;
    if (typeof v === 'number') return String(v);
  }
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v && typeof v === 'object') {
      const r = extract(v, ...keys);
      if (r) return r;
    }
  }
  return undefined;
}

export async function reconcileOnBoot() {
  const positions = listAllUnclosedPositions();
  if (positions.length === 0) return;
  console.log('[recovery] reconciling', positions.length, 'positions');

  for (const p of positions) {
    const market = (p.market || 'KRX') as Market;
    try {
      if (p.state === 'pending') {
        const res = await checkFill(market, p.entryOrderId);
        const filled = Number(extract(res, 'tot_ccld_qty', 'filled_qty', 'ccld_qty') ?? 0);
        const avgStr = extract(res, 'avg_prvs', 'avg_price', 'ccld_unpr');
        if (filled >= p.quantity && avgStr) {
          markPositionOpen(p.id, Number(avgStr));
          console.log('[recovery]', p.id, 'pending → open');
        }
      } else if (p.state === 'closing' && p.exitOrderId) {
        const res = await checkFill(market, p.exitOrderId);
        const filled = Number(extract(res, 'tot_ccld_qty', 'filled_qty', 'ccld_qty') ?? 0);
        const avgStr = extract(res, 'avg_prvs', 'avg_price', 'ccld_unpr');
        if (filled >= p.quantity && avgStr && p.avgPrice) {
          const pnl = (Number(avgStr) - p.avgPrice) * p.quantity;
          markPositionClosed(p.id, pnl);
          console.log('[recovery]', p.id, 'closing → closed, pnl', pnl);
        }
      }
    } catch (err) {
      console.warn('[recovery] error for', p.id, (err as Error).message);
    }
  }
}
