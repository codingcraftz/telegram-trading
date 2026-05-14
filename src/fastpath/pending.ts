// 미체결 주문 조회 fast-path.

import { callKisApi } from '../mcp/kis.js';
import { findOutput, fmtKrw, num, parseMcpResult } from './extract.js';

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

export async function handlePending(): Promise<string> {
  const today = todayKst();
  const res = await callKisApi('domestic_stock', 'inquire_daily_ccld', {
    pd_dv: 'inner',
    inqr_strt_dt: today,
    inqr_end_dt: today,
    sll_buy_dvsn_cd: '00',
    ccld_dvsn: '02', // 02 = 미체결
    inqr_dvsn: '00',
    inqr_dvsn_3: '00',
  });
  const parsed = parseMcpResult(res);
  if (!parsed.success) return `❌ 미체결 조회 실패: ${parsed.error ?? '알 수 없는 오류'}`;

  const list = findOutput(parsed, 'output1');
  const items = Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
  if (items.length === 0) return '대기 중인 미체결 주문 없음';

  const lines = [`📋 <b>미체결 주문 ${items.length}개</b>`];
  for (const it of items) {
    const time = String(it.ord_tmd ?? '');
    const code = String(it.pdno ?? '');
    const name = String(it.prdt_name ?? code);
    const side = String(it.sll_buy_dvsn_cd_name ?? it.sll_buy_dvsn_cd ?? '');
    const qty = num(it.ord_qty) ?? 0;
    const price = num(it.ord_unpr) ?? 0;
    const filled = num(it.tot_ccld_qty) ?? 0;
    const rem = qty - filled;
    lines.push(
      `• ${time} ${name} (${code}) ${side} ${fmtKrw(price)} × ${qty}주 (잔여 ${rem})`,
    );
  }
  return lines.join('\n');
}
