// 대기 매수 금액 합계 — 진짜 사용 가능한 현금을 계산하기 위해 KIS dnca/cash 에서
// 빼야 하는 모든 매수 관련 lock 금액을 집계.
//
// 차감 대상:
//   1) KIS 미체결 매수 주문 (price × remaining)
//   2) pendingIntents (사용자 확인 대기 매수)
//   3) morning_staged active application
//      - phase='pending'          → budgetAmount 전체 (아직 1차 미발사)
//      - phase='stage1_filled' && stages[1] 존재
//                                  → budgetAmount × stages[1].entryPct / 100
//                                    (1차는 체결돼 holdings/raw cash 에 반영, 2차 예약 금액만 잔여)
//
// 양쪽 모두 KIS 가 즉시 raw cash 에 반영 안 하는 케이스라 봇 측에서 차감.

import { fetchPendingOrders } from './pending.js';
import { listChatPendingIntents } from '../db/repo.js';
import { getDb } from '../db/client.js';
import { strategyApplications, strategies as strategiesTable } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';

/**
 * KIS가 모르는 내부 예약 매수 금액만 합산.
 * - pendingIntents (아직 KIS에 안 보낸 확인 대기 주문)
 * - morning_staged application 예약 budget
 *
 * inquire_psbl_order 결과에서 추가 차감할 때 사용 — KIS pending은 이미 반영되므로 제외.
 */
export function fetchInternalPendingBuyAmount(chatId: number): number {
  let total = 0;

  try {
    for (const i of listChatPendingIntents(chatId)) {
      try {
        const spec = JSON.parse(i.orderSpecJson) as { action?: string; price?: number; quantity?: number };
        if (spec.action === 'buy') total += (spec.price ?? 0) * (spec.quantity ?? 0);
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  try {
    const rows = getDb()
      .select({
        runtimeJson: strategyApplications.runtimeJson,
        budgetAmount: strategyApplications.budgetAmount,
        definition: strategiesTable.definition,
      })
      .from(strategyApplications)
      .leftJoin(strategiesTable, eq(strategyApplications.strategyId, strategiesTable.id))
      .where(and(eq(strategyApplications.chatId, chatId), eq(strategyApplications.status, 'active')))
      .all();

    for (const r of rows) {
      const budget = r.budgetAmount;
      if (!budget || budget <= 0) continue;

      let phase = 'pending';
      try {
        phase = JSON.parse(r.runtimeJson ?? '{}').phase ?? 'pending';
      } catch { /* keep pending */ }

      if (phase === 'pending') {
        total += budget;
        continue;
      }

      if (phase === 'stage1_filled') {
        try {
          const def = JSON.parse(r.definition ?? '{}') as {
            entry?: { type?: string; stages?: Array<{ entryPct?: number }> };
          };
          const s2pct = def.entry?.type === 'morning_staged'
            ? def.entry.stages?.[1]?.entryPct
            : undefined;
          if (s2pct && s2pct > 0) {
            total += Math.floor((budget * s2pct) / 100);
          }
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }

  return total;
}

export async function fetchPendingBuyAmount(chatId: number): Promise<number> {
  let total = 0;

  try {
    const k = await fetchPendingOrders();
    if (k.ok) {
      for (const it of k.items) {
        const isBuy = String(it.side).includes('매수') || String(it.side) === '02';
        if (isBuy) total += it.price * it.remaining;
      }
    }
  } catch { /* ignore */ }

  try {
    for (const i of listChatPendingIntents(chatId)) {
      try {
        const spec = JSON.parse(i.orderSpecJson) as { action?: string; price?: number; quantity?: number };
        if (spec.action === 'buy') total += (spec.price ?? 0) * (spec.quantity ?? 0);
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  try {
    const rows = getDb()
      .select({
        runtimeJson: strategyApplications.runtimeJson,
        budgetAmount: strategyApplications.budgetAmount,
        definition: strategiesTable.definition,
      })
      .from(strategyApplications)
      .leftJoin(strategiesTable, eq(strategyApplications.strategyId, strategiesTable.id))
      .where(and(eq(strategyApplications.chatId, chatId), eq(strategyApplications.status, 'active')))
      .all();

    for (const r of rows) {
      const budget = r.budgetAmount;
      if (!budget || budget <= 0) continue;

      let phase = 'pending';
      try {
        phase = JSON.parse(r.runtimeJson ?? '{}').phase ?? 'pending';
      } catch { /* keep pending */ }

      if (phase === 'pending') {
        // 아직 1차 안 들어감. budget 전체가 향후 매수에 사용될 예정.
        total += budget;
        continue;
      }

      if (phase === 'stage1_filled') {
        // 1차 체결됐고 2차 트리거(가격 N% 하락) 대기 중. 2차 예약 금액 차감.
        try {
          const def = JSON.parse(r.definition ?? '{}') as {
            entry?: { type?: string; stages?: Array<{ entryPct?: number }> };
          };
          const s2pct = def.entry?.type === 'morning_staged'
            ? def.entry.stages?.[1]?.entryPct
            : undefined;
          if (s2pct && s2pct > 0) {
            total += Math.floor((budget * s2pct) / 100);
          }
        } catch { /* ignore */ }
      }
      // stage2_filled / tp1_done / completed → 더 들어갈 매수 없음. 차감 0.
    }
  } catch { /* ignore */ }

  return total;
}
