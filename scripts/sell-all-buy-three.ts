// 1) 보유 종목 전부 시장가 매도
// 2) 잔고 재조회
// 3) 3종목 (코스모로보틱스/피델릭스/한화갤러리아) 각 시드 20% 시장가 매수

import { connectMcp, closeMcp } from '../src/mcp/client.js';
import { callKisApi, placeOrder } from '../src/mcp/kis.js';
import { fetchNaverMinuteBars } from '../src/charts/naver.js';
import { num, outputDict, outputList, parseMcpResult } from '../src/fastpath/extract.js';

const TARGETS = [
  { code: '439960', name: '코스모로보틱스' },
  { code: '032580', name: '피델릭스' },
  { code: '452260', name: '한화갤러리아' },
];
const SEED_PCT = 20;

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function getBalance() {
  const bal = await callKisApi('domestic_stock', 'inquire_balance', {});
  const parsed = parseMcpResult(bal);
  const summary = outputDict(parsed, 'output2');
  const holdings = outputList(parsed, 'output1').filter((h) => num(h.hldg_qty)! > 0);
  const cash = num(summary?.dnca_tot_amt) ?? 0;
  return { cash, holdings };
}

async function main() {
  console.log('▶ MCP 연결');
  await connectMcp();

  // 1) 보유 종목 매도
  let { cash, holdings } = await getBalance();
  console.log(`\n초기 예수금: ${cash.toLocaleString()}원, 보유 ${holdings.length}종`);
  for (const h of holdings) {
    const code = String(h.pdno);
    const name = String(h.prdt_name ?? code);
    const qty = num(h.hldg_qty) ?? 0;
    if (qty <= 0) continue;
    console.log(`\n▶ 매도: ${name} (${code}) ${qty}주`);
    try {
      const r = await placeOrder({
        market: 'KRX',
        side: 'sell',
        code,
        quantity: qty,
        orderType: 'market',
      });
      console.log(`  결과: ${JSON.stringify(r).slice(0, 300)}`);
    } catch (err) {
      console.error(`  ❌ 매도 실패: ${(err as Error).message}`);
    }
  }

  // 2) 잠시 대기 후 잔고 재조회 (모의는 보통 즉시 반영)
  console.log('\n⏳ 5초 대기 (정산 반영 대기)…');
  await sleep(5000);
  const after = await getBalance();
  console.log(`\n매도 후 예수금: ${after.cash.toLocaleString()}원`);
  if (after.cash <= 0) {
    console.error('❌ 예수금 여전히 음수/0. 매도가 정산되지 않았거나 미수가 큼. 매수 중단.');
    await closeMcp();
    return;
  }
  const budgetEach = (after.cash * SEED_PCT) / 100;
  console.log(`  종목당 예산 (${SEED_PCT}%): ${Math.round(budgetEach).toLocaleString()}원`);

  // 3) 3종목 매수
  for (const t of TARGETS) {
    try {
      console.log(`\n▶ 매수: ${t.name} (${t.code})`);
      const candles = await fetchNaverMinuteBars(t.code, 1, 5);
      if (candles.length === 0) {
        console.error('  ❌ NAVER 시세 없음');
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
      const r = await placeOrder({
        market: 'KRX',
        side: 'buy',
        code: t.code,
        quantity: qty,
        orderType: 'market',
      });
      console.log(`  ✅ 결과: ${JSON.stringify(r).slice(0, 300)}`);
    } catch (err) {
      console.error(`  ❌ 매수 실패: ${(err as Error).message}`);
    }
  }

  await closeMcp();
  console.log('\n완료');
}

main().catch((err) => {
  console.error('✗ fatal:', err);
  process.exit(1);
});
