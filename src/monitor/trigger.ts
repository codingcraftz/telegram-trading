import type { Position } from '../db/schema.js';
import { tryClaimTrigger } from '../db/repo.js';
import { closePosition } from '../execution/close.js';

export type TriggerReason = 'tp' | 'sl';

export function evaluate(pos: Position, price: number): TriggerReason | null {
  if (pos.state !== 'open') return null;
  if (pos.triggeredAt) return null;
  if (pos.tpPrice && price >= pos.tpPrice) return 'tp';
  if (pos.slPrice && price <= pos.slPrice) return 'sl';
  return null;
}

export async function maybeFire(pos: Position, price: number): Promise<boolean> {
  const reason = evaluate(pos, price);
  if (!reason) return false;
  // 단일 발사 클레임 — 이 한 번만 청산 실행
  if (!tryClaimTrigger(pos.id)) return false;
  await closePosition({ positionId: pos.id, reason });
  return true;
}
