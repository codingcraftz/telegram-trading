// 1회용 긴급 매수 — 3종목 시드 20% 시장가.
// NAVER로 현재가 받아 수량 계산 → KIS 시장가 발주.

import { connectMcp, closeMcp } from '../src/mcp/client.js';
import { callKisApi, placeOrder } from '../src/mcp/kis.js';
import { fetchNaverMinuteBars } from '../src/charts/naver.js';
import { num, outputDict, parseMcpResult } from '../src/fastpath/extract.js';

const TARGETS = [
  { code: '439960', name: '코스모로보틱스' },
  { code: '032580', name: '피델릭스' },
  { code: '452260', name: '한화갤러리아' },
];
const SEED_PCT = 20;

async function main() {
  console.log('▶ MCP 연결');
  await connectMcp();

  console.log('▶ 잔고 조회');
  const bal = await callKisApi('domestic_stock', 'inquire_balance', {});
  const parsed = parseMcpResult(bal);
  if (!parsed.success) {
    console.error('❌ 잔고 조회 실패:', parsed.error);
    return;
  }
  const summary = outputDict(parsed, 'output2');
  const dnca = num(summary?.dnca_tot_amt) ?? 0;
  const d2 = num(summary?.prvs_rcdl_excc_amt) ?? 0;
  const totEvlu = num(summary?.tot_evlu_amt) ?? 0;
  console.log(`  예수금(D+0): ${dnca.toLocaleString()}원`);
  console.log(`  D+2 정산: ${d2.toLocaleString()}원`);
  console.log(`  총 평가: ${totEvlu.toLocaleString()}원`);
  // 시드 = D+2 정산 예정금 또는 총 평가 중 큰 값 (음수 예수금 보정)
  const seed = Math.max(d2, totEvlu);
  if (seed <= 0) {
    console.error('❌ 시드 산정 불가');
    return;
  }
  const budgetEach = (seed * SEED_PCT) / 100;
  console.log(`  → 시드 기준: ${seed.toLocaleString()}원`);
  console.log(`  종목당 예산 (${SEED_PCT}%): ${Math.round(budgetEach).toLocaleString()}원\n`);

  for (const t of TARGETS) {
    try {
      console.log(`▶ ${t.name} (${t.code})`);
      const candles = await fetchNaverMinuteBars(t.code, 1, 5);
      if (candles.length === 0) {
        console.error('  ❌ NAVER 시세 없음 — 스킵');
        continue;
      }
      const price = candles[candles.length - 1]!.close;
      const qty = Math.floor(budgetEach / price);
      if (qty <= 0) {
        console.error(`  ❌ 수량 0 (현재가 ${price.toLocaleString()}원)`);
        continue;
      }
      const total = price * qty;
      console.log(`  현재가 ${price.toLocaleString()}원 × ${qty}주 = ${total.toLocaleString()}원`);

      const result = await placeOrder({
        market: 'KRX',
        side: 'buy',
        code: t.code,
        quantity: qty,
        orderType: 'market',
      });
      const resStr = JSON.stringify(result);
      console.log(`  ✅ 발주 결과: ${resStr.slice(0, 400)}\n`);
    } catch (err) {
      console.error(`  ❌ 실패: ${(err as Error).message}\n`);
    }
  }

  await closeMcp();
  console.log('완료');
}

main().catch((err) => {
  console.error('✗ fatal:', err);
  process.exit(1);
});
