// KOSPI/KOSDAQ 종목 마스터 다운로드 (KIS .mst.zip → JSON).
// scripts/fetch-krx-symbols.ts와 동일 로직을 src/ 안으로 옮겨 컨테이너에서 호출 가능.
// 봇 부팅 시 ensureKrxSymbols()가 호출되어 없거나 24시간 이상 경과 시 자동 갱신.

import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Buffer } from 'node:buffer';
import { unzipSync } from 'fflate';
import iconv from 'iconv-lite';

type Stock = { code: string; name: string; market: 'KOSPI' | 'KOSDAQ' };

const KOSPI_URL = 'https://new.real.download.dws.co.kr/common/master/kospi_code.mst.zip';
const KOSDAQ_URL = 'https://new.real.download.dws.co.kr/common/master/kosdaq_code.mst.zip';
const OUT_FILE = 'data/krx-stocks.json';
const STALE_MS = 24 * 60 * 60 * 1000; // 24시간

async function downloadMst(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function parseMst(zipBuf: Buffer, market: 'KOSPI' | 'KOSDAQ'): Stock[] {
  const files = unzipSync(new Uint8Array(zipBuf));
  const keys = Object.keys(files);
  const mstKey = keys.find((k) => k.endsWith('.mst'));
  if (!mstKey) throw new Error('mst 파일 없음');
  const mstBytes = Buffer.from(files[mstKey]!);
  const text = iconv.decode(mstBytes, 'cp949');
  const lines = text.split(/\r?\n/);
  const out: Stock[] = [];
  for (const row of lines) {
    if (row.length < 228) continue;
    const front = row.slice(0, row.length - 228);
    const code = front.slice(0, 9).trim();
    const name = front.slice(21).trim();
    if (!code || !name || !/^\d{6}$/.test(code)) continue;
    out.push({ code, name, market });
  }
  return out;
}

export async function fetchAndSaveKrxSymbols(): Promise<number> {
  const kospiZip = await downloadMst(KOSPI_URL);
  const kospi = parseMst(kospiZip, 'KOSPI');
  const kosdaqZip = await downloadMst(KOSDAQ_URL);
  const kosdaq = parseMst(kosdaqZip, 'KOSDAQ');
  const seen = new Set<string>();
  const unique = [...kospi, ...kosdaq].filter((s) => {
    if (seen.has(s.code)) return false;
    seen.add(s.code);
    return true;
  });
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(
    OUT_FILE,
    JSON.stringify(
      { updatedAt: new Date().toISOString(), count: unique.length, stocks: unique },
      null,
      0,
    ),
    'utf-8',
  );
  return unique.length;
}

// 부팅 시 호출 — 파일 없거나 stale이면 갱신, 실패해도 봇 부팅은 진행.
export async function ensureKrxSymbols(): Promise<void> {
  try {
    if (existsSync(OUT_FILE)) {
      const age = Date.now() - statSync(OUT_FILE).mtimeMs;
      if (age < STALE_MS) {
        console.log('[krx] 마스터 파일 최신 — skip');
        return;
      }
      console.log('[krx] 마스터 파일 stale — 갱신');
    } else {
      console.log('[krx] 마스터 파일 없음 — 다운로드');
    }
    const count = await fetchAndSaveKrxSymbols();
    console.log(`[krx] 갱신 완료 — ${count.toLocaleString()}종`);
  } catch (err) {
    console.warn('[krx] 갱신 실패 (alias로 동작):', (err as Error).message);
  }
}
