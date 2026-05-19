// 수량 계산 책임 분리. 순수 함수.

import type { QuantitySpec } from './schema.js';

export type PlanQtyResult = { ok: true; qty: number } | { ok: false; error: string };

export function planQuantity(
  quantity: QuantitySpec,
  currentPrice: number,
  availableCash: number,
): PlanQtyResult {
  if (currentPrice <= 0) return { ok: false, error: '현재가가 0이에요' };

  let qty = 0;
  switch (quantity.mode) {
    case 'fixed_shares':
      qty = Math.floor(quantity.value);
      break;
    case 'fixed_amount':
      qty = Math.floor(quantity.value / currentPrice);
      break;
    case 'cash_ratio':
      qty = Math.floor((availableCash * quantity.value) / currentPrice);
      break;
  }

  if (qty < 1) return { ok: false, error: '계산된 수량이 0주예요' };
  if (qty * currentPrice > availableCash) {
    return { ok: false, error: '잔액 부족' };
  }
  return { ok: true, qty };
}
