// GET /api/orders — 3 소스 통합 (pendingIntents + reservations + KIS 미체결)
// GET /api/orders/filled — KIS 체결 내역 (inquire_daily_ccld ccld_dvsn=01)

import type { Context } from 'hono';
import {
  listChatPendingIntents,
  listChatReservations,
  type OrderSpec,
} from '../db/repo.js';
import { fetchPendingOrders } from '../fastpath/pending.js';
import { callKisApi } from '../mcp/kis.js';
import { cached, invalidate } from '../fastpath/cache.js';
import { checkKisOk, findOutput, num, parseMcpResult } from '../fastpath/extract.js';
import { getDefaultChatId } from './_auth.js';
import { getDb } from '../db/client.js';
import { strategyApplications, strategies as strategiesTable } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { nameByCode } from '../fastpath/symbol.js';

function parseSpec(json: string): OrderSpec | null {
  try {
    return JSON.parse(json) as OrderSpec;
  } catch {
    return null;
  }
}

export async function handleOrders(c: Context) {
  const chatId = getDefaultChatId();
  const now = Date.now();
  const intents = listChatPendingIntents(chatId);
  const reservations = listChatReservations(chatId, ['awaiting_confirm', 'pending']);

  // 전략 감시 중 (active strategy_applications) — 시가매매 대기 + immediate 감시 모두.
  const apps = getDb()
    .select({
      id: strategyApplications.id,
      strategyId: strategyApplications.strategyId,
      strategyName: strategiesTable.name,
      stockCode: strategyApplications.stockCode,
      appliedAt: strategyApplications.appliedAt,
      runtimeJson: strategyApplications.runtimeJson,
      budgetAmount: strategyApplications.budgetAmount,
    })
    .from(strategyApplications)
    .leftJoin(strategiesTable, eq(strategyApplications.strategyId, strategiesTable.id))
    .where(
      and(
        eq(strategyApplications.chatId, chatId),
        eq(strategyApplications.status, 'active'),
      ),
    )
    .all();

  let kis: Awaited<ReturnType<typeof fetchPendingOrders>> = { ok: false, items: [] };
  try {
    kis = await fetchPendingOrders();
  } catch (err) {
    kis = { ok: false, error: (err as Error).message, items: [] };
  }

  return c.json({
    intents: intents.map((i) => {
      const spec = parseSpec(i.orderSpecJson);
      return {
        id: i.id,
        action: spec?.action ?? '?',
        code: spec?.symbol_code ?? '',
        name: spec?.symbol_name ?? '?',
        quantity: spec?.quantity ?? 0,
        orderType: spec?.order_type ?? 'market',
        price: spec?.price ?? null,
        tpPct: spec?.tp_pct ?? null,
        slPct: spec?.sl_pct ?? null,
        createdAt: i.createdAt,
        expiresAt: i.expiresAt,
        remainingMs: Math.max(0, i.expiresAt - now),
      };
    }),
    reservations: reservations.map((r) => ({
      id: r.id,
      code: r.symbolCode,
      name: r.symbolName,
      qtyMode: r.qtyMode,
      qtyValue: r.qtyValue,
      tpPct: r.tpPct,
      slPct: r.slPct,
      scheduledFor: r.scheduledFor,
      state: r.state,
      expiresAt: r.expiresAt,
      remainingMs: r.state === 'awaiting_confirm' ? Math.max(0, r.expiresAt - now) : null,
    })),
    kis: kis.ok
      ? {
          ok: true,
          items: kis.items.map((it) => ({
            code: it.code,
            name: it.name,
            side: it.side,
            qty: it.qty,
            price: it.price,
            filled: it.filled,
            remaining: it.remaining,
            time: it.time,
            orgno: it.orgno,
            odno: it.odno,
            ordDvsn: it.ordDvsn,
          })),
        }
      : { ok: false, error: kis.error, items: [] },
    strategies: apps.map((a) => {
      let phase = 'pending';
      let stage1Qty = 0;
      let stage1Avg = 0;
      let stage2Qty = 0;
      let stage2Avg = 0;
      let tp1SoldQty = 0;
      try {
        const rt = a.runtimeJson
          ? (JSON.parse(a.runtimeJson) as {
              phase?: string;
              stage1?: { qty?: number; avgPrice?: number };
              stage2?: { qty?: number; avgPrice?: number };
              tp1Sell?: { qty?: number };
            })
          : null;
        if (rt?.phase) phase = rt.phase;
        if (rt?.stage1) { stage1Qty = rt.stage1.qty ?? 0; stage1Avg = rt.stage1.avgPrice ?? 0; }
        if (rt?.stage2) { stage2Qty = rt.stage2.qty ?? 0; stage2Avg = rt.stage2.avgPrice ?? 0; }
        if (rt?.tp1Sell?.qty) tp1SoldQty = rt.tp1Sell.qty;
      } catch { /* ignore */ }
      const heldStage1Qty = Math.max(0, stage1Qty - tp1SoldQty);
      const heldQty = heldStage1Qty + stage2Qty;
      const costBasis = heldStage1Qty * stage1Avg + stage2Qty * stage2Avg;
      const avgPrice = heldQty > 0 ? Math.round(costBasis / heldQty) : 0;
      return {
        id: a.id,
        strategyId: a.strategyId,
        strategyName: a.strategyName ?? '전략',
        code: a.stockCode,
        name: nameByCode(a.stockCode),
        appliedAt: a.appliedAt,
        budgetAmount: a.budgetAmount,
        heldQty,
        avgPrice,
        phase,
      };
    }),
  });
}

// ====== /api/orders/filled — 체결 내역 ======
function ymdKst(d: Date): string {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCFullYear()}${String(k.getUTCMonth() + 1).padStart(2, '0')}${String(k.getUTCDate()).padStart(2, '0')}`;
}

type FilledOrder = {
  /** epoch ms (orderDt + ordTime KST → UTC) */
  ts: number;
  orderDate: string; // YYYYMMDD
  orderTime: string; // HHMMSS
  code: string;
  name: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;     // 체결단가
  amount: number;    // qty * price
  orgno: string;
  odno: string;
};

function parseTs(orderDate: string, orderTime: string): number {
  // KST naive parse: YYYYMMDD + HHMMSS → Date(ms)
  if (!/^\d{8}$/.test(orderDate) || !/^\d{6}$/.test(orderTime)) return 0;
  const y = Number(orderDate.slice(0, 4));
  const m = Number(orderDate.slice(4, 6)) - 1;
  const d = Number(orderDate.slice(6, 8));
  const hh = Number(orderTime.slice(0, 2));
  const mm = Number(orderTime.slice(2, 4));
  const ss = Number(orderTime.slice(4, 6));
  // KST = UTC+9 → KST 표현을 UTC ms로 환산
  return Date.UTC(y, m, d, hh, mm, ss) - 9 * 3600 * 1000;
}

export async function handleOrdersFilled(c: Context) {
  const days = Math.min(90, Math.max(1, Number(c.req.query('days') ?? '7')));
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 24 * 3600 * 1000);
  try {
    // days별로 캐시 분리. 60초 캐시 + warmup이 7일치 갱신.
    const res = await cached(`filled:days:${days}`, 60_000, () =>
      callKisApi('domestic_stock', 'inquire_daily_ccld', {
        pd_dv: 'inner',
        inqr_strt_dt: ymdKst(start),
        inqr_end_dt: ymdKst(end),
        sll_buy_dvsn_cd: '00',
        ccld_dvsn: '01', // 01 = 체결
        inqr_dvsn: '00',
        inqr_dvsn_3: '00',
      }),
    );
    const parsed = parseMcpResult(res);
    if (!parsed.success) {
      // 에러 응답을 캐시에 두지 않음 — 다음 호출에서 재시도
      invalidate(`filled:days:${days}`);
      return c.json({ error: parsed.error ?? 'parse', items: [] }, 502);
    }
    const kisOk = checkKisOk(parsed);
    if (!kisOk.ok) {
      invalidate(`filled:days:${days}`);
      return c.json({ error: kisOk.message ?? 'KIS', items: [] }, 502);
    }

    const list = findOutput(parsed, 'output1');
    const raw = Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
    const items: FilledOrder[] = raw
      .filter((it) => (num(it.tot_ccld_qty) ?? 0) > 0)
      .map((it) => {
        const orderDate = String(it.ord_dt ?? '');
        const orderTime = String(it.ord_tmd ?? '');
        const qty = num(it.tot_ccld_qty) ?? 0;
        const price = num(it.avg_prvs) ?? num(it.ccld_unpr) ?? num(it.ord_unpr) ?? 0;
        const sideCd = String(it.sll_buy_dvsn_cd ?? '');
        const side: 'buy' | 'sell' = sideCd === '02' ? 'buy' : 'sell';
        return {
          ts: parseTs(orderDate, orderTime),
          orderDate,
          orderTime,
          code: String(it.pdno ?? ''),
          name: String(it.prdt_name ?? it.pdno ?? ''),
          side,
          qty,
          price,
          amount: qty * price,
          orgno: String(it.ord_gno_brno ?? ''),
          odno: String(it.odno ?? ''),
        };
      })
      .sort((a, b) => b.ts - a.ts);

    return c.json({ days, items });
  } catch (err) {
    return c.json({ error: (err as Error).message, items: [] }, 500);
  }
}
