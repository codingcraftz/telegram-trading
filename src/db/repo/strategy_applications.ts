// 전략 적용(application) repo.

import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDb } from '../client.js';
import { strategyApplications, type StrategyApplication } from '../schema.js';

function newId(): string { return nanoid(12); }

export function listApplicationsByStrategy(
  strategyId: string,
  chatId: number,
): StrategyApplication[] {
  return getDb()
    .select()
    .from(strategyApplications)
    .where(
      and(
        eq(strategyApplications.strategyId, strategyId),
        eq(strategyApplications.chatId, chatId),
      ),
    )
    .orderBy(desc(strategyApplications.appliedAt))
    .all();
}

/** 모든 chat의 active applications. 스케줄러 평가 루프용. */
export function listAllActiveApplications(): StrategyApplication[] {
  return getDb()
    .select()
    .from(strategyApplications)
    .where(eq(strategyApplications.status, 'active'))
    .orderBy(desc(strategyApplications.appliedAt))
    .all();
}

export function getApplicationById(
  id: string,
  chatId: number,
): StrategyApplication | null {
  return (
    getDb()
      .select()
      .from(strategyApplications)
      .where(and(eq(strategyApplications.id, id), eq(strategyApplications.chatId, chatId)))
      .get() ?? null
  );
}

/** UNIQUE 위반 시 throw (better-sqlite3 SqliteError) — 호출 측에서 캐치해 409 처리. */
export function createApplication(args: {
  strategyId: string;
  chatId: number;
  stockCode: string;
  budgetAmount?: number | null;
}): StrategyApplication {
  const id = newId();
  const now = Date.now();
  getDb()
    .insert(strategyApplications)
    .values({
      id,
      strategyId: args.strategyId,
      chatId: args.chatId,
      stockCode: args.stockCode,
      status: 'active',
      appliedAt: now,
      lastEvaluatedAt: null,
      budgetAmount: args.budgetAmount ?? null,
    })
    .run();
  return getApplicationById(id, args.chatId)!;
}

export function updateApplicationStatus(
  id: string,
  chatId: number,
  status: StrategyApplication['status'],
): boolean {
  const r = getDb()
    .update(strategyApplications)
    .set({ status })
    .where(and(eq(strategyApplications.id, id), eq(strategyApplications.chatId, chatId)))
    .run();
  return r.changes > 0;
}

export function touchLastEvaluated(id: string, chatId: number, ts: number): void {
  getDb()
    .update(strategyApplications)
    .set({ lastEvaluatedAt: ts })
    .where(and(eq(strategyApplications.id, id), eq(strategyApplications.chatId, chatId)))
    .run();
}

/** runtime_json 갱신 (morning_staged 등 multi-step 전략 상태). */
export function setApplicationRuntime(
  id: string,
  chatId: number,
  runtime: unknown,
): void {
  getDb()
    .update(strategyApplications)
    .set({ runtimeJson: runtime === null ? null : JSON.stringify(runtime) })
    .where(and(eq(strategyApplications.id, id), eq(strategyApplications.chatId, chatId)))
    .run();
}

export function deleteApplication(id: string, chatId: number): boolean {
  const r = getDb()
    .delete(strategyApplications)
    .where(and(eq(strategyApplications.id, id), eq(strategyApplications.chatId, chatId)))
    .run();
  return r.changes > 0;
}
