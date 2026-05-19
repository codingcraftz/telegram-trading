// 전략 평가 실행 이력(executions) repo.

import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDb } from '../client.js';
import { strategyExecutions, type StrategyExecution } from '../schema.js';

function newId(): string { return nanoid(12); }

export function listExecutionsByStrategy(
  strategyId: string,
  chatId: number,
  limit = 20,
): StrategyExecution[] {
  return getDb()
    .select()
    .from(strategyExecutions)
    .where(
      and(
        eq(strategyExecutions.strategyId, strategyId),
        eq(strategyExecutions.chatId, chatId),
      ),
    )
    .orderBy(desc(strategyExecutions.triggeredAt))
    .limit(limit)
    .all();
}

export function createExecution(args: {
  strategyId: string;
  applicationId: string;
  chatId: number;
  stockCode: string;
  action: StrategyExecution['action'];
  result: StrategyExecution['result'];
  payload?: unknown;
  errorMessage?: string;
}): StrategyExecution {
  const id = newId();
  getDb()
    .insert(strategyExecutions)
    .values({
      id,
      strategyId: args.strategyId,
      applicationId: args.applicationId,
      chatId: args.chatId,
      stockCode: args.stockCode,
      triggeredAt: Date.now(),
      action: args.action,
      result: args.result,
      payload: args.payload ? JSON.stringify(args.payload) : null,
      errorMessage: args.errorMessage ?? null,
    })
    .run();
  return getDb()
    .select()
    .from(strategyExecutions)
    .where(eq(strategyExecutions.id, id))
    .get()!;
}
