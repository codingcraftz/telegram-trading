// 모든 fast-path 핸들러를 실제 MCP로 호출해서 동작 검증.
// docker compose exec bot로 실행.

import { connectMcp } from '/app/dist/mcp/client.js';
import { handleBalance } from '/app/dist/fastpath/balance.js';
import { handlePsbl } from '/app/dist/fastpath/psbl.js';
import { handlePending } from '/app/dist/fastpath/pending.js';
import { handleRanking } from '/app/dist/fastpath/ranking.js';
import { handlePriceQuery } from '/app/dist/fastpath/price.js';
import { handleAskingQuery } from '/app/dist/fastpath/asking.js';
import { handleBuy } from '/app/dist/fastpath/buy.js';
import { handleSell } from '/app/dist/fastpath/sell.js';

const CHAT = 8429077172;

async function run(name, fn) {
  console.log(`\n━━━━━━━━ ${name} ━━━━━━━━`);
  try {
    const r = await fn();
    const s = typeof r === 'string' ? r : JSON.stringify(r, null, 2);
    console.log(s.slice(0, 800));
    console.log('::OK::');
  } catch (e) {
    console.error('::FAIL::', e.message);
  }
}

await connectMcp();

await run('잔고', () => handleBalance());
await run('예수금', () => handlePsbl());
await run('미체결', () => handlePending());
await run('거래량 랭킹', () => handleRanking('volume'));
await run('상승률 랭킹', () => handleRanking('fluctuation_up'));
await run('하락률 랭킹', () => handleRanking('fluctuation_down'));
await run('시총 랭킹', () => handleRanking('market_cap'));
await run('삼성전자 현재가', () => handlePriceQuery('삼성전자'));
await run('삼성전자 호가', () => handleAskingQuery('삼성전자'));
await run('삼성전자 1주 매수 (제안만)', () =>
  handleBuy(CHAT, { sym: '삼성전자', qtyShares: 1, market: true }),
);
await run('삼성전자 전량 매도 (제안만)', () =>
  handleSell(CHAT, { sym: '삼성전자', all: true }),
);

process.exit(0);
