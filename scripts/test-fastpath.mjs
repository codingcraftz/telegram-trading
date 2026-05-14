// Fast-path 매칭 패턴 검증 (실제 MCP/네트워크 호출은 안 함)

const tests = [
  // 잔고
  { msg: '잔고', expect: 'balance' },
  { msg: '내 잔고', expect: 'balance' },
  { msg: '내 잔고?', expect: 'balance' }, // 물음표 — fail 가능
  { msg: '보유 종목', expect: 'balance' },
  { msg: '내 보유 종목', expect: 'balance' },
  { msg: '내가 가진 거', expect: 'balance' },
  { msg: '가지고 있는 거', expect: 'balance' },

  // 예수금
  { msg: '예수금', expect: 'psbl' },
  { msg: '매수 가능', expect: 'psbl' },
  { msg: '시드', expect: 'psbl' },
  { msg: '내 시드', expect: 'psbl' },

  // 미체결
  { msg: '미체결', expect: 'pending' },
  { msg: '걸어둔 주문', expect: 'pending' },
  { msg: '대기 주문', expect: 'pending' },

  // 랭킹
  { msg: '거래량', expect: 'ranking.volume' },
  { msg: '거래량 순위', expect: 'ranking.volume' },
  { msg: '거래량 순위.', expect: 'ranking.volume' }, // 마침표
  { msg: '거래량 조회', expect: 'ranking.volume' },
  { msg: '거래 량 조회', expect: 'ranking.volume' }, // STT 공백
  { msg: '거래대금 top', expect: 'ranking.volume' },
  { msg: '상승률', expect: 'ranking.up' },
  { msg: '상승률 제일 높은거 알려줘', expect: 'ranking.up' },
  { msg: '제일 많이 오른 종목', expect: 'ranking.up' },
  { msg: '급등', expect: 'ranking.up' },
  { msg: '하락률', expect: 'ranking.down' },
  { msg: '많이 떨어진 거', expect: 'ranking.down' },
  { msg: '폭락한 종목', expect: 'ranking.down' },
  { msg: '시총', expect: 'ranking.cap' },
  { msg: '시가총액 순위', expect: 'ranking.cap' },

  // 현재가
  { msg: '삼성전자 현재가', expect: 'price' },
  { msg: '삼성전자 시세', expect: 'price' },
  { msg: '삼성전자 주가', expect: 'price' },
  { msg: '삼전 가격', expect: 'price' },
  { msg: '005930 현재가', expect: 'price' },

  // 호가
  { msg: '삼성전자 호가', expect: 'asking' },

  // 매수 정형
  { msg: '삼성전자 5주 매수', expect: 'buy' },
  { msg: '삼성전자 10만원어치 매수', expect: 'buy' },
  { msg: '삼전 1주 사줘', expect: 'buy' },
  { msg: '005930 100만원어치 사줘', expect: 'buy' },

  // 매도 정형
  { msg: '삼성전자 전량 매도', expect: 'sell' },
  { msg: '삼성 다 팔아', expect: 'sell' },
  { msg: '삼성전자 5주 매도', expect: 'sell' },
  { msg: '삼전 전부 매도', expect: 'sell' },

  // LLM 필요 (fast-path 못 잡아야)
  { msg: '삼성전자 지금호가 3개 아래로 시드 10% 매수, TP 5% SL 3%', expect: 'LLM' },
  { msg: '내 보유 중에서 제일 많이 떨어진 거 매도해줘', expect: 'LLM' },
];

const root = '/Users/zoonyoung/projects/telegram-trading/dist/fastpath';
const { tryMatchBalance } = await import(`${root}/balance.js`);
const { tryMatchPsbl } = await import(`${root}/psbl.js`);
const { tryMatchPending } = await import(`${root}/pending.js`);
const { tryMatchRanking } = await import(`${root}/ranking.js`);
const { tryMatchPrice } = await import(`${root}/price.js`);
const { tryMatchAsking } = await import(`${root}/asking.js`);
const { tryMatchBuy } = await import(`${root}/buy.js`);
const { tryMatchSell } = await import(`${root}/sell.js`);

function classify(msg) {
  if (tryMatchBuy(msg)) return 'buy';
  if (tryMatchSell(msg)) return 'sell';
  if (tryMatchBalance(msg)) return 'balance';
  if (tryMatchPsbl(msg)) return 'psbl';
  if (tryMatchPending(msg)) return 'pending';
  const r = tryMatchRanking(msg);
  if (r === 'volume') return 'ranking.volume';
  if (r === 'fluctuation_up') return 'ranking.up';
  if (r === 'fluctuation_down') return 'ranking.down';
  if (r === 'market_cap') return 'ranking.cap';
  if (tryMatchAsking(msg)) return 'asking';
  if (tryMatchPrice(msg)) return 'price';
  return 'LLM';
}

let pass = 0, fail = 0;
const fails = [];
for (const t of tests) {
  const got = classify(t.msg);
  const ok = got === t.expect;
  if (ok) pass++; else { fail++; fails.push({ ...t, got }); }
  console.log(ok ? '✓' : '✗', `"${t.msg}"`, '→', got, ok ? '' : `(expected ${t.expect})`);
}
console.log(`\n${pass}/${pass+fail} pass, ${fail} fail`);
if (fails.length) {
  console.log('\nFAILS:');
  for (const f of fails) console.log(` - "${f.msg}" → ${f.got}, expected ${f.expect}`);
}
process.exit(fail > 0 ? 1 : 0);
