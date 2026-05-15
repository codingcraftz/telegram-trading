// 통합 대기 뷰 — 3 출처를 한 화면에 합쳐 인라인 액션 제공.
//
//   1) 즉시 주문 대기 (pendingIntents)            : 사용자의 미확정 매수/매도 제안
//   2) 시가매매 예약 (marketOpenReservations)     : 다음 영업일 발주 대기
//   3) KIS 실제 미체결 (inquire_daily_ccld)        : 브로커가 잡고 있는 미체결 주문
//
// 콜백 data 64-byte 한계 회피: KIS 미체결 row의 orgno/odno/ordDvsn은 짧으므로 콜백에 인코딩
//   "kis:cx:<orgno>:<odno>:<ordDvsn>"  (모두 영숫자, 합 ~30 bytes)

import { InlineKeyboard } from 'grammy';
import { listChatPendingIntents, listChatReservations, type OrderSpec } from '../db/repo.js';
import { fetchPendingOrders } from './pending.js';
import { formatKst } from '../scheduler/calendar.js';
import { fmtTtl } from './extract.js';

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

export function tryMatchOrders(text: string): boolean {
  const raw = text.trim();
  if (raw.length > 20) return false;
  const t = normalize(raw);
  return t === '대기' || t === '대기주문' || t === '내대기' || t === '걸어둔것' || t === '걸어둔거';
}

function parseSpec(json: string): OrderSpec | null {
  try {
    return JSON.parse(json) as OrderSpec;
  } catch {
    return null;
  }
}

// 텔레그램 메시지 4096자 한계. 안전선 3800자에서 자르고 "외 N건" 표기.
const MSG_LIMIT = 3800;
const MAX_PER_GROUP = 15; // 각 섹션당 최대 표시 항목

export async function buildOrdersView(
  chatId: number,
): Promise<{ text: string; kb: InlineKeyboard }> {
  const now = Date.now();
  const intents = listChatPendingIntents(chatId);
  const reservations = listChatReservations(chatId, ['awaiting_confirm', 'pending']);

  let kisItems: Awaited<ReturnType<typeof fetchPendingOrders>> = { ok: false, items: [] };
  try {
    kisItems = await fetchPendingOrders();
  } catch (err) {
    kisItems = { ok: false, error: (err as Error).message, items: [] };
  }

  const total =
    intents.length + reservations.length + (kisItems.ok ? kisItems.items.length : 0);

  const lines: string[] = [
    `📋 <b>대기 주문</b> · 총 ${total}건`,
    `<i>아직 발주되지 않은 예약 + 발주됐지만 체결 안 된 미체결</i>`,
  ];
  const kb = new InlineKeyboard();

  // ===== 1. 즉시 주문 대기 =====
  lines.push('');
  if (intents.length === 0) {
    lines.push('⏳ <b>즉시 주문 대기</b> (없음)');
  } else {
    lines.push(`⏳ <b>즉시 주문 대기</b> (${intents.length})`);
    const shown = intents.slice(0, MAX_PER_GROUP);
    for (const i of shown) {
      const spec = parseSpec(i.orderSpecJson);
      const side = spec?.action === 'buy' ? '매수' : '매도';
      const sym = spec ? `${spec.symbol_name} (${spec.symbol_code})` : '?';
      const orderType = spec?.order_type === 'market' ? '시장가' : spec?.price?.toLocaleString() + '원';
      const qty = spec ? `${spec.quantity}주` : '?';
      lines.push(`  • ${sym} ${side} ${qty} (${orderType}) — ⌛ ${fmtTtl(i.expiresAt, now)}`);
      lines.push(`    <code>id: ${i.id}</code>`);
      kb.text(`✅ ${spec?.symbol_name ?? i.id}`, `confirm:${i.id}`)
        .text('❌', `cancel:${i.id}`)
        .row();
    }
    if (intents.length > MAX_PER_GROUP) {
      lines.push(`  ... 외 ${intents.length - MAX_PER_GROUP}건`);
    }
  }

  // ===== 2. 시가매매 예약 =====
  lines.push('');
  if (reservations.length === 0) {
    lines.push('📅 <b>시가매매 예약</b> (없음)');
  } else {
    lines.push(`📅 <b>시가매매 예약</b> (${reservations.length})`);
    const shown = reservations.slice(0, MAX_PER_GROUP);
    for (const r of shown) {
      const qty =
        r.qtyMode === 'shares'
          ? `${r.qtyValue}주`
          : r.qtyMode === 'amount'
            ? `${r.qtyValue.toLocaleString()}원`
            : `예수금 ${r.qtyValue}%`;
      const stateLabel = r.state === 'awaiting_confirm' ? '확인대기' : '예약중';
      lines.push(`  • ${r.symbolName} (${r.symbolCode}) ${qty} · ${stateLabel}`);
      lines.push(`    발주 ${formatKst(new Date(r.scheduledFor))}`);
      if (r.state === 'awaiting_confirm') {
        lines.push(`    ⌛ ${fmtTtl(r.expiresAt, now)}`);
        kb.text(`✅ 예약 ${r.symbolName}`, `confirm:${r.id}`)
          .text('❌', `cancel:${r.id}`)
          .row();
      } else {
        kb.text(`❌ 예약취소 ${r.symbolName}`, `cancel:${r.id}`).row();
      }
    }
    if (reservations.length > MAX_PER_GROUP) {
      lines.push(`  ... 외 ${reservations.length - MAX_PER_GROUP}건`);
    }
  }

  // ===== 3. KIS 미체결 =====
  lines.push('');
  if (!kisItems.ok) {
    lines.push(`🔵 <b>KIS 미체결</b> — ❌ 조회 실패: ${kisItems.error}`);
  } else if (kisItems.items.length === 0) {
    lines.push('🔵 <b>KIS 미체결</b> (없음)');
  } else {
    lines.push(`🔵 <b>KIS 미체결</b> (${kisItems.items.length})`);
    const shown = kisItems.items.slice(0, MAX_PER_GROUP);
    for (const it of shown) {
      const t = it.time.length === 6 ? `${it.time.slice(0, 2)}:${it.time.slice(2, 4)}:${it.time.slice(4, 6)}` : it.time;
      const priceLabel = it.price > 0 ? `${it.price.toLocaleString()}원` : '시장가';
      lines.push(
        `  • ${t} ${it.name} (${it.code}) ${it.side} ${priceLabel} × ${it.qty}주 (잔여 ${it.remaining})`,
      );
      if (it.odno && it.orgno) {
        kb.text(`❌ 취소 ${it.name}`, `kis:cx:${it.orgno}:${it.odno}:${it.ordDvsn}`).row();
      }
    }
    if (kisItems.items.length > MAX_PER_GROUP) {
      lines.push(`  ... 외 ${kisItems.items.length - MAX_PER_GROUP}건`);
    }
  }

  kb.text('🔄 새로고침', 'od:refresh').text('💵 잔고', 'nav:balance').text('📊 포지션', 'nav:positions');

  // 최후 안전선 — 누적 길이 초과 시 잘라내기
  let text = lines.join('\n');
  if (text.length > MSG_LIMIT) {
    text = text.slice(0, MSG_LIMIT) + '\n\n⚠️ 메시지가 너무 길어 일부 잘렸습니다. [🔄 새로고침]을 눌러 갱신.';
  }
  return { text, kb };
}
