// KIS Open Trading API에서 KOSPI/KOSDAQ 종목 마스터 (.mst.zip) 다운로드 → JSON 변환.
// 출처: 한국투자증권 공식 examples_user/kis_kor_stock_code.py 의 파싱 로직.
//
// 실행: pnpm tsx scripts/fetch-krx-symbols.ts
// 결과: data/krx-stocks.json
//
// 각 mst row 구조 (CP949 인코딩):
//   - 마지막 228자: 기타 고정폭 필드 (시장구분/종류 등)
//   - 앞부분: 단축코드(9자) + 표준코드(12자) + 한글명(가변)

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Buffer } from 'node:buffer';
import { unzipSync } from 'fflate';
import iconv from 'iconv-lite';

type Stock = { code: string; name: string; market: 'KOSPI' | 'KOSDAQ' };

const KOSPI_URL = 'https://new.real.download.dws.co.kr/common/master/kospi_code.mst.zip';
const KOSDAQ_URL = 'https://new.real.download.dws.co.kr/common/master/kosdaq_code.mst.zip';
const OUT_FILE = 'data/krx-stocks.json';

async function downloadMst(url: string): Promise<Buffer> {
  console.log('  다운로드:', url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`  받음: ${buf.length.toLocaleString()} bytes`);
  return buf;
}

function parseMst(zipBuf: Buffer, market: 'KOSPI' | 'KOSDAQ'): Stock[] {
  const files = unzipSync(new Uint8Array(zipBuf));
  const keys = Object.keys(files);
  const mstKey = keys.find((k) => k.endsWith('.mst'));
  if (!mstKey) throw new Error(`mst 파일 없음 (entries: ${keys.join(', ')})`);
  const mstBytes = Buffer.from(files[mstKey]!);
  const text = iconv.decode(mstBytes, 'cp949');
  const lines = text.split(/\r?\n/);
  const out: Stock[] = [];
  for (const row of lines) {
    if (row.length < 228) continue; // 최소 길이 필터
    const front = row.slice(0, row.length - 228);
    const code = front.slice(0, 9).trim();
    const name = front.slice(21).trim();
    if (!code || !name) continue;
    if (!/^\d{6}$/.test(code)) continue; // 6자리 숫자 코드만
    out.push({ code, name, market });
  }
  return out;
}

async function main() {
  console.log('▶ KOSPI');
  const kospiZip = await downloadMst(KOSPI_URL);
  const kospi = parseMst(kospiZip, 'KOSPI');
  console.log(`  파싱 완료: ${kospi.length.toLocaleString()}종`);

  console.log('▶ KOSDAQ');
  const kosdaqZip = await downloadMst(KOSDAQ_URL);
  const kosdaq = parseMst(kosdaqZip, 'KOSDAQ');
  console.log(`  파싱 완료: ${kosdaq.length.toLocaleString()}종`);

  const all = [...kospi, ...kosdaq];
  // 중복 코드 제거 (혹시)
  const seen = new Set<string>();
  const unique = all.filter((s) => {
    if (seen.has(s.code)) return false;
    seen.add(s.code);
    return true;
  });

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(
    OUT_FILE,
    JSON.stringify({ updatedAt: new Date().toISOString(), count: unique.length, stocks: unique }, null, 0),
    'utf-8',
  );
  console.log(`✓ ${OUT_FILE} 저장 — 총 ${unique.length.toLocaleString()}종`);

  // 샘플 출력
  console.log('\n샘플:');
  for (const q of ['005930', '005935', '000660', '035720']) {
    const found = unique.find((s) => s.code === q);
    console.log(`  ${q}: ${found ? `${found.name} (${found.market})` : '없음'}`);
  }
}

main().catch((err) => {
  console.error('✗ 실패:', err);
  process.exit(1);
});
