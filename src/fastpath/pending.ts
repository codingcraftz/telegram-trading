// 미체결 주문 조회 fast-path + 데이터-only 헬퍼 (orders.ts에서 재사용).

import { callKisApi } from '../mcp/kis.js';
import { cached, invalidate } from './cache.js';
import { checkKisOk, findOutput, fmtKrw, num, parseMcpResult } from './extract.js';

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

export function tryMatchPending(text: string): boolean {
  const raw = text.trim();
  if (raw.length > 25) return false;
  const t = normalize(raw);
  return (
    t === '미체결' ||
    t === '미체결주문' ||
    t === '걸어둔주문' ||
    t === '대기주문' ||
    t === '내미체결'
  );
}

function todayKst(): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

export type PendingOrder = {
  time: string;        // HH:MM:SS
  code: string;        // pdno
  name: string;        // prdt_name
  side: string;        // 매수/매도 한글 라벨 또는 코드
  qty: number;         // ord_qty
  price: number;       // ord_unpr
  filled: number;      // tot_ccld_qty
  remaining: number;   // qty - filled
  orgno: string;       // ord_gno_brno (취소용)
  odno: string;        // odno (취소용)
  ordDvsn: string;     // ord_dvsn (취소용)
};

// 데이터-only — orders.ts 통합 뷰가 재사용.
// 30초 캐싱 + warmup worker가 주기 갱신 → 사용자 호출 시점에 항상 캐시 hit.
export async function fetchPendingOrders(): Promise<{ ok: boolean; error?: string; items: PendingOrder[] }> {
  const today = todayKst();
  const res = await cached('pending:raw', 30_000, () =>
    callKisApi('domestic_stock', 'inquire_daily_ccld', {
      pd_dv: 'inner',
      inqr_strt_dt: today,
      inqr_end_dt: today,
      sll_buy_dvsn_cd: '00',
      ccld_dvsn: '02', // 02 = 미체결
      inqr_dvsn: '00',
      inqr_dvsn_3: '00',
    }),
  );
  const parsed = parseMcpResult(res);
  if (!parsed.success) {
    invalidate('pending:raw');
    return { ok: false, error: parsed.error ?? '알 수 없는 오류', items: [] };
  }
  const kisOk = checkKisOk(parsed);
  if (!kisOk.ok) {
    invalidate('pending:raw');
    return { ok: false, error: kisOk.message ?? 'KIS 오류', items: [] };
  }

  const list = findOutput(parsed, 'output1');
  const raw = Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
  const items: PendingOrder[] = raw.map((it) => {
    const qty = num(it.ord_qty) ?? 0;
    const filled = num(it.tot_ccld_qty) ?? 0;
    return {
      time: String(it.ord_tmd ?? ''),
      code: String(it.pdno ?? ''),
      name: String(it.prdt_name ?? it.pdno ?? ''),
      side: String(it.sll_buy_dvsn_cd_name ?? it.sll_buy_dvsn_cd ?? ''),
      qty,
      price: num(it.ord_unpr) ?? 0,
      filled,
      remaining: qty - filled,
      orgno: String(it.ord_gno_brno ?? ''),
      odno: String(it.odno ?? ''),
      ordDvsn: String(it.ord_dvsn ?? '00'),
    };
  });
  return { ok: true, items };
}

export async function handlePending(): Promise<string> {
  const r = await fetchPendingOrders();
  if (!r.ok) return `❌ 미체결 조회 실패: ${r.error}`;
  if (r.items.length === 0) return '대기 중인 미체결 주문 없음';
  const lines = [`📋 <b>미체결 주문 ${r.items.length}개</b>`];
  for (const it of r.items) {
    lines.push(
      `• ${it.time} ${it.name} (${it.code}) ${it.side} ${fmtKrw(it.price)} × ${it.qty}주 (잔여 ${it.remaining})`,
    );
  }
  return lines.join('\n');
}
