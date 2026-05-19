// 전략 CRUD repo. 모든 함수 chatId scoping 필수.

import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDb } from '../client.js';
import {
  strategies,
  strategyApplications,
  strategyExecutions,
  type Strategy,
} from '../schema.js';

function newId(): string {
  return nanoid(12);
}

export function listStrategiesByChatId(chatId: number): Strategy[] {
  return getDb()
    .select()
    .from(strategies)
    .where(eq(strategies.chatId, chatId))
    .all();
}

export function getStrategyById(id: string, chatId: number): Strategy | null {
  const row = getDb()
    .select()
    .from(strategies)
    .where(and(eq(strategies.id, id), eq(strategies.chatId, chatId)))
    .get();
  return row ?? null;
}

export function createStrategy(args: {
  chatId: number;
  name: string;
  active: boolean;
  definition: string; // serialized JSON
}): Strategy {
  const id = newId();
  const now = Date.now();
  getDb()
    .insert(strategies)
    .values({
      id,
      chatId: args.chatId,
      name: args.name,
      version: 1,
      active: args.active ? 1 : 0,
      definition: args.definition,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return getStrategyById(id, args.chatId)!;
}

/** version 일치 시 update + version+1. 불일치(409 후보) 시 null 반환. */
export function updateStrategyWithVersionCheck(args: {
  id: string;
  chatId: number;
  expectedVersion: number;
  patch: Partial<{ name: string; active: boolean; definition: string }>;
}): Strategy | null {
  const now = Date.now();
  const existing = getStrategyById(args.id, args.chatId);
  if (!existing) return null;
  if (existing.version !== args.expectedVersion) return null;

  const next = {
    name: args.patch.name ?? existing.name,
    active: args.patch.active !== undefined ? (args.patch.active ? 1 : 0) : existing.active,
    definition: args.patch.definition ?? existing.definition,
    version: existing.version + 1,
    updatedAt: now,
  };

  const result = getDb()
    .update(strategies)
    .set(next)
    .where(
      and(
        eq(strategies.id, args.id),
        eq(strategies.chatId, args.chatId),
        eq(strategies.version, args.expectedVersion),
      ),
    )
    .run();

  if (result.changes === 0) return null;
  return getStrategyById(args.id, args.chatId);
}

/** cascade: applications/executions도 삭제. trx 사용. */
export function deleteStrategyCascade(id: string, chatId: number): boolean {
  const existing = getStrategyById(id, chatId);
  if (!existing) return false;
  const db = getDb();
  db.delete(strategyExecutions)
    .where(and(eq(strategyExecutions.strategyId, id), eq(strategyExecutions.chatId, chatId)))
    .run();
  db.delete(strategyApplications)
    .where(and(eq(strategyApplications.strategyId, id), eq(strategyApplications.chatId, chatId)))
    .run();
  const r = db
    .delete(strategies)
    .where(and(eq(strategies.id, id), eq(strategies.chatId, chatId)))
    .run();
  return r.changes > 0;
}

export function toggleStrategyActive(
  id: string,
  chatId: number,
  active: boolean,
): Strategy | null {
  getDb()
    .update(strategies)
    .set({ active: active ? 1 : 0, updatedAt: Date.now() })
    .where(and(eq(strategies.id, id), eq(strategies.chatId, chatId)))
    .run();
  return getStrategyById(id, chatId);
}

export function cloneStrategy(id: string, chatId: number): Strategy | null {
  const src = getStrategyById(id, chatId);
  if (!src) return null;
  return createStrategy({
    chatId,
    name: `${src.name} (복사본)`,
    active: false, // 복제본은 기본 비활성
    definition: src.definition,
  });
}

export function countApplicationsByStrategy(strategyId: string, chatId: number): number {
  const row = getDb()
    .select({ c: sql<number>`count(*)` })
    .from(strategyApplications)
    .where(
      and(
        eq(strategyApplications.strategyId, strategyId),
        eq(strategyApplications.chatId, chatId),
      ),
    )
    .get();
  return row?.c ?? 0;
}
