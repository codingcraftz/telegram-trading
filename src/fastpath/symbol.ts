// 종목명/별칭 → 종목코드 해석.
// 1) data/krx-stocks.json (KOSPI/KOSDAQ 전체 3,500여 종) — 부팅 시 1회 로드
// 2) 자주 쓰는 alias 테이블 (별칭/단축어)

import { existsSync, readFileSync } from 'node:fs';

// KRX 마스터 로드 (3,500여 종). 없으면 빈 배열로 동작 (alias만 사용).
type KrxStock = { code: string; name: string; market: 'KOSPI' | 'KOSDAQ' };
let _master: KrxStock[] = [];
let _masterByCode = new Map<string, KrxStock>();

function loadMaster(): void {
  const path = 'data/krx-stocks.json';
  if (!existsSync(path)) {
    console.log('[symbol] krx-stocks.json 없음 — alias만 사용');
    return;
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as { stocks: KrxStock[]; count: number };
    _master = raw.stocks;
    _masterByCode = new Map(raw.stocks.map((s) => [s.code, s]));
    console.log(`[symbol] krx-stocks.json 로드 — ${_master.length.toLocaleString()}종`);
  } catch (err) {
    console.warn('[symbol] krx-stocks.json 로드 실패:', (err as Error).message);
  }
}
loadMaster();

// 마스터 파일 갱신 후 메모리 재로드 (boot 단계에서 호출)
export function reloadKrxMaster(): void {
  loadMaster();
}

const ALIASES: Record<string, { code: string; name: string }> = {
  // 시총 상위 + 자주 거래
  삼성전자: { code: '005930', name: '삼성전자' },
  삼전: { code: '005930', name: '삼성전자' },
  '삼성전자우': { code: '005935', name: '삼성전자우' },
  '삼성전자(우)': { code: '005935', name: '삼성전자우' },
  '삼전우': { code: '005935', name: '삼성전자우' },
  sk하이닉스: { code: '000660', name: 'SK하이닉스' },
  하이닉스: { code: '000660', name: 'SK하이닉스' },
  카카오: { code: '035720', name: '카카오' },
  카카오뱅크: { code: '323410', name: '카카오뱅크' },
  카뱅: { code: '323410', name: '카카오뱅크' },
  카카오페이: { code: '377300', name: '카카오페이' },
  네이버: { code: '035420', name: 'NAVER' },
  naver: { code: '035420', name: 'NAVER' },
  현대차: { code: '005380', name: '현대차' },
  현대자동차: { code: '005380', name: '현대차' },
  '현대차우': { code: '005385', name: '현대차우' },
  기아: { code: '000270', name: '기아' },
  lg에너지솔루션: { code: '373220', name: 'LG에너지솔루션' },
  엘지에너지솔루션: { code: '373220', name: 'LG에너지솔루션' },
  엘지엔솔: { code: '373220', name: 'LG에너지솔루션' },
  lg화학: { code: '051910', name: 'LG화학' },
  '엘지화학': { code: '051910', name: 'LG화학' },
  lg전자: { code: '066570', name: 'LG전자' },
  '엘지전자': { code: '066570', name: 'LG전자' },
  포스코: { code: '005490', name: 'POSCO홀딩스' },
  posco홀딩스: { code: '005490', name: 'POSCO홀딩스' },
  포스코홀딩스: { code: '005490', name: 'POSCO홀딩스' },
  포스코퓨처엠: { code: '003670', name: '포스코퓨처엠' },
  셀트리온: { code: '068270', name: '셀트리온' },
  삼성바이오로직스: { code: '207940', name: '삼성바이오로직스' },
  '삼바': { code: '207940', name: '삼성바이오로직스' },
  삼성sdi: { code: '006400', name: '삼성SDI' },
  '삼성sdi우': { code: '006405', name: '삼성SDI우' },
  삼성생명: { code: '032830', name: '삼성생명' },
  삼성화재: { code: '000810', name: '삼성화재' },
  삼성물산: { code: '028260', name: '삼성물산' },
  kb금융: { code: '105560', name: 'KB금융' },
  케이비금융: { code: '105560', name: 'KB금융' },
  신한지주: { code: '055550', name: '신한지주' },
  하나금융지주: { code: '086790', name: '하나금융지주' },
  우리금융지주: { code: '316140', name: '우리금융지주' },
  현대모비스: { code: '012330', name: '현대모비스' },
  sk이노베이션: { code: '096770', name: 'SK이노베이션' },
  sk텔레콤: { code: '017670', name: 'SK텔레콤' },
  skt: { code: '017670', name: 'SK텔레콤' },
  kt: { code: '030200', name: 'KT' },
  kt앤지: { code: '033780', name: 'KT&G' },
  ktng: { code: '033780', name: 'KT&G' },
  한화에어로스페이스: { code: '012450', name: '한화에어로스페이스' },
  한화: { code: '000880', name: '한화' },
  한화솔루션: { code: '009830', name: '한화솔루션' },
  두산에너빌리티: { code: '034020', name: '두산에너빌리티' },
  두산: { code: '000150', name: '두산' },
  대한항공: { code: '003490', name: '대한항공' },
  크래프톤: { code: '259960', name: '크래프톤' },
  엔씨소프트: { code: '036570', name: '엔씨소프트' },
  엔씨: { code: '036570', name: '엔씨소프트' },
  넷마블: { code: '251270', name: '넷마블' },
  카카오게임즈: { code: '293490', name: '카카오게임즈' },
  hmm: { code: '011200', name: 'HMM' },
  현대중공업: { code: '329180', name: 'HD현대중공업' },
  hd현대중공업: { code: '329180', name: 'HD현대중공업' },
  // ETF 주요
  kodex200: { code: '069500', name: 'KODEX 200' },
  코덱스200: { code: '069500', name: 'KODEX 200' },
  tiger200: { code: '102110', name: 'TIGER 200' },
  코덱스레버리지: { code: '122630', name: 'KODEX 레버리지' },
  코덱스인버스: { code: '114800', name: 'KODEX 인버스' },
  '코덱스200선물인버스2x': { code: '252670', name: 'KODEX 200선물인버스2X' },
};

export type ResolvedSymbol = { code: string; name: string };

// 부분 매칭 — alias + KRX 마스터 둘 다에서 검색.
// 우선순위: alias 시작 매칭 → 마스터 시작 매칭 → alias 포함 매칭 → 마스터 포함 매칭.
export function searchSymbolCandidates(input: string, limit = 10): ResolvedSymbol[] {
  const q = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!q) return [];
  const seen = new Set<string>();
  const out: ResolvedSymbol[] = [];
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

  // 1) alias 시작 매칭 (사용자가 자주 쓰는 단축어 우선)
  for (const [key, val] of Object.entries(ALIASES)) {
    if (out.length >= limit) break;
    if (seen.has(val.code)) continue;
    if (key.startsWith(q) || norm(val.name).startsWith(q)) {
      out.push(val);
      seen.add(val.code);
    }
  }
  // 2) 마스터 시작 매칭 (이름 또는 코드)
  for (const s of _master) {
    if (out.length >= limit) break;
    if (seen.has(s.code)) continue;
    if (norm(s.name).startsWith(q) || s.code.startsWith(q)) {
      out.push({ code: s.code, name: s.name });
      seen.add(s.code);
    }
  }
  // 3) alias 포함 매칭
  if (out.length < limit) {
    for (const [key, val] of Object.entries(ALIASES)) {
      if (out.length >= limit) break;
      if (seen.has(val.code)) continue;
      if (key.includes(q) || norm(val.name).includes(q)) {
        out.push(val);
        seen.add(val.code);
      }
    }
  }
  // 4) 마스터 포함 매칭
  if (out.length < limit) {
    for (const s of _master) {
      if (out.length >= limit) break;
      if (seen.has(s.code)) continue;
      if (norm(s.name).includes(q)) {
        out.push({ code: s.code, name: s.name });
        seen.add(s.code);
      }
    }
  }
  return out;
}

export async function resolveSymbol(input: string): Promise<ResolvedSymbol | null> {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 6자리 숫자면 마스터에서 이름 조회 (없으면 코드만)
  if (/^\d{6}$/.test(trimmed)) {
    const m = _masterByCode.get(trimmed);
    if (m) return { code: m.code, name: m.name };
    return { code: trimmed, name: trimmed };
  }

  // 로컬 alias
  const key = trimmed.toLowerCase().replace(/\s+/g, '');
  const aliased = ALIASES[key];
  if (aliased) return aliased;

  // 마스터 정확 이름 매칭
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  const exactInMaster = _master.find((s) => norm(s.name) === key);
  if (exactInMaster) return { code: exactInMaster.code, name: exactInMaster.name };

  return null;
}
