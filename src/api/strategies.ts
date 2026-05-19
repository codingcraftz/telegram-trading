// 전략 CRUD + apply/toggle/clone/executions REST API.
// chatId scoping 필수. zod 검증 실패 → 400 + issues.

import type { Context } from 'hono';
import { ZodError } from 'zod';
import {
  ApplyStrategyInputSchema,
  CreateStrategyInputSchema,
  StrategyDefinitionSchema,
  ToggleStrategyInputSchema,
  UpdateStrategyInputSchema,
} from '../strategy/schema.js';
import {
  cloneStrategy,
  countApplicationsByStrategy,
  createStrategy,
  deleteStrategyCascade,
  getStrategyById,
  listStrategiesByChatId,
  toggleStrategyActive,
  updateStrategyWithVersionCheck,
} from '../db/repo/strategies.js';
import {
  createApplication,
  deleteApplication,
  getApplicationById,
  listApplicationsByStrategy,
} from '../db/repo/strategy_applications.js';
import { listExecutionsByStrategy } from '../db/repo/strategy_executions.js';
import type { Strategy } from '../db/schema.js';
import { getDefaultChatId } from './_auth.js';

// ---------- 헬퍼 ----------
function getChatId(_c: Context): number {
  // 멀티유저 도입 시 c.get('chatId') 또는 미들웨어로 교체. 현재는 단일.
  return getDefaultChatId();
}
function reqParam(c: Context, key: string): string {
  return c.req.param(key) ?? '';
}

function presentStrategy(s: Strategy, applicationCount = 0) {
  return {
    id: s.id,
    name: s.name,
    version: s.version,
    active: s.active === 1,
    definition: JSON.parse(s.definition),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    applicationCount,
  };
}

function zodError(err: ZodError) {
  return { error: 'validation_failed', issues: err.issues };
}

// ---------- 핸들러 ----------
export async function handleStrategiesList(c: Context) {
  const chatId = getChatId(c);
  const items = listStrategiesByChatId(chatId);
  return c.json({
    items: items.map((s) => presentStrategy(s, countApplicationsByStrategy(s.id, chatId))),
  });
}

export async function handleStrategyCreate(c: Context) {
  const chatId = getChatId(c);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid json' }, 400); }
  const parsed = CreateStrategyInputSchema.safeParse(body);
  if (!parsed.success) return c.json(zodError(parsed.error), 400);

  const created = createStrategy({
    chatId,
    name: parsed.data.name,
    active: parsed.data.active,
    definition: JSON.stringify(parsed.data.definition),
  });
  return c.json(presentStrategy(created, 0), 201);
}

export async function handleStrategyGet(c: Context) {
  const chatId = getChatId(c);
  const id = reqParam(c, 'id');
  const s = getStrategyById(id, chatId);
  if (!s) return c.json({ error: 'not_found' }, 404);
  const applications = listApplicationsByStrategy(id, chatId);
  return c.json({
    strategy: presentStrategy(s, applications.length),
    applications,
  });
}

export async function handleStrategyUpdate(c: Context) {
  const chatId = getChatId(c);
  const id = reqParam(c, 'id');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid json' }, 400); }
  const parsed = UpdateStrategyInputSchema.safeParse(body);
  if (!parsed.success) return c.json(zodError(parsed.error), 400);

  const existing = getStrategyById(id, chatId);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  // definition만 별도 검증 (위 schema에서도 검증되지만 명시적)
  if (parsed.data.definition) {
    const defCheck = StrategyDefinitionSchema.safeParse(parsed.data.definition);
    if (!defCheck.success) return c.json(zodError(defCheck.error), 400);
  }

  const updated = updateStrategyWithVersionCheck({
    id,
    chatId,
    expectedVersion: parsed.data.version,
    patch: {
      name: parsed.data.name,
      active: parsed.data.active,
      definition: parsed.data.definition ? JSON.stringify(parsed.data.definition) : undefined,
    },
  });
  if (!updated) {
    return c.json(
      {
        error: 'version_conflict',
        currentVersion: existing.version,
        attemptedVersion: parsed.data.version,
      },
      409,
    );
  }
  return c.json(presentStrategy(updated, countApplicationsByStrategy(id, chatId)));
}

export async function handleStrategyDelete(c: Context) {
  const chatId = getChatId(c);
  const id = reqParam(c, 'id');
  const ok = deleteStrategyCascade(id, chatId);
  if (!ok) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
}

export async function handleStrategyClone(c: Context) {
  const chatId = getChatId(c);
  const id = reqParam(c, 'id');
  const cloned = cloneStrategy(id, chatId);
  if (!cloned) return c.json({ error: 'not_found' }, 404);
  return c.json(presentStrategy(cloned, 0), 201);
}

export async function handleStrategyApply(c: Context) {
  const chatId = getChatId(c);
  const id = reqParam(c, 'id');
  if (!getStrategyById(id, chatId)) return c.json({ error: 'not_found' }, 404);

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid json' }, 400); }
  const parsed = ApplyStrategyInputSchema.safeParse(body);
  if (!parsed.success) return c.json(zodError(parsed.error), 400);

  try {
    const app = createApplication({
      strategyId: id,
      chatId,
      stockCode: parsed.data.stockCode,
    });
    return c.json(app, 201);
  } catch (err) {
    // UNIQUE 위반 (better-sqlite3 SqliteError)
    const msg = (err as Error).message;
    if (/UNIQUE/i.test(msg)) {
      return c.json({ error: 'already_applied', message: '이미 적용된 종목이에요' }, 409);
    }
    return c.json({ error: 'db_error', message: msg }, 500);
  }
}

export async function handleStrategyApplicationDelete(c: Context) {
  const chatId = getChatId(c);
  const id = reqParam(c, 'id');
  const appId = reqParam(c, 'appId');
  if (!getStrategyById(id, chatId)) return c.json({ error: 'not_found' }, 404);
  const app = getApplicationById(appId, chatId);
  if (!app || app.strategyId !== id) return c.json({ error: 'not_found' }, 404);
  const ok = deleteApplication(appId, chatId);
  return c.json({ ok });
}

export async function handleStrategyToggle(c: Context) {
  const chatId = getChatId(c);
  const id = reqParam(c, 'id');
  if (!getStrategyById(id, chatId)) return c.json({ error: 'not_found' }, 404);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid json' }, 400); }
  const parsed = ToggleStrategyInputSchema.safeParse(body);
  if (!parsed.success) return c.json(zodError(parsed.error), 400);
  const updated = toggleStrategyActive(id, chatId, parsed.data.active);
  if (!updated) return c.json({ error: 'not_found' }, 404);
  return c.json(presentStrategy(updated, countApplicationsByStrategy(id, chatId)));
}

export async function handleStrategyExecutions(c: Context) {
  const chatId = getChatId(c);
  const id = reqParam(c, 'id');
  if (!getStrategyById(id, chatId)) return c.json({ error: 'not_found' }, 404);
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? '20')));
  const items = listExecutionsByStrategy(id, chatId, limit);
  return c.json({
    items: items.map((e) => ({
      ...e,
      payload: e.payload ? JSON.parse(e.payload) : null,
    })),
  });
}
