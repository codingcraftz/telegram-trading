import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'node:fs';
import { z } from 'zod';

// 1) .env (개발용) → 2) /app/data/runtime.env (대시보드가 쓴 키, 우선)
dotenvConfig();
const RUNTIME_ENV = process.env.RUNTIME_ENV ?? '/app/data/runtime.env';
if (existsSync(RUNTIME_ENV)) {
  dotenvConfig({ path: RUNTIME_ENV, override: true });
}

const csvIds = z
  .string()
  .default('')
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean).map(Number))
  .pipe(z.array(z.number().int().positive()));

const Env = z.object({
  // 알림 전용 (체결 알림). 비어 있으면 봇 비활성 — 매매는 대시보드에서만.
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  // 알림 받을 chat_id. 비어 있으면 알림 송신 안 함.
  ALLOWED_CHAT_IDS: csvIds,

  // 모의(paper)/실전(real). KIS REST 호출 시 env_dv로 사용.
  MODE: z.enum(['paper', 'real']).default('paper'),

  // 모두 0이면 해당 가드 비활성.
  MAX_TRADE_KRW: z.coerce.number().int().nonnegative().default(1_000_000),
  MAX_OPEN_POSITIONS: z.coerce.number().int().nonnegative().default(0),
  COOLDOWN_SEC: z.coerce.number().int().nonnegative().default(0),
  DAILY_LOSS_KRW: z.coerce.number().int().nonnegative().default(0),
  INTENT_TTL_MIN: z.coerce.number().int().positive().default(5),

  DATABASE_FILE: z.string().default('./data/tt.db'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type AppConfig = z.infer<typeof Env>;

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    const errors = JSON.stringify(parsed.error.flatten().fieldErrors);
    throw new Error(`Invalid environment: ${errors}`);
  }
  cached = parsed.data;
  return cached;
}
