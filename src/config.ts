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
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean).map(Number))
  .pipe(z.array(z.number().int().positive()).min(1));

const Env = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(10),
  ALLOWED_CHAT_IDS: csvIds,

  KIS_MCP_URL: z.string().url(),

  // 모의(paper)/실전(real). KIS Trading MCP의 env_dv 파라미터로 전달됨.
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
