// MCP 응답에서 실제 KIS API 데이터를 끄집어내는 공통 헬퍼.
// MCP 응답 구조:
//   { content: [{type:'text', text: '<JSON>'}], structuredContent: {ok, data: {...}} }
//   parseMcpResult가 data 객체 반환
//
// data 안에는 KIS 응답이 다양한 형태로 박혀있음:
//   - inquire_price: data.data = JSON string of [{...}] (단일 레코드)
//   - inquire_balance: data.output1 = [...], data.output2 = [...]
//   - 일부 API: data.result.output | data.response.output1
// 이걸 다 normalize해서 찾아주는 헬퍼.

export type ParsedMcp = {
  ok: boolean;
  success?: boolean;
  error?: string;
  raw: Record<string, unknown> | null;
};

export function parseMcpResult(result: unknown): ParsedMcp {
  if (!result || typeof result !== 'object') return { ok: false, raw: null };
  const r = result as Record<string, unknown>;

  let payload: unknown = null;

  if (r.structuredContent && typeof r.structuredContent === 'object') {
    const sc = r.structuredContent as Record<string, unknown>;
    payload = sc.data ?? sc;
  }
  if (!payload) {
    const content = r.content as Array<{ type?: string; text?: string }> | undefined;
    if (content && content[0]?.text) {
      try {
        const parsed = JSON.parse(content[0].text);
        payload = parsed.data ?? parsed;
      } catch {}
    }
  }
  if (!payload || typeof payload !== 'object') return { ok: false, raw: null };
  const d = payload as Record<string, unknown>;
  return {
    ok: true,
    success: d.success !== false,
    error: typeof d.error === 'string' ? d.error : undefined,
    raw: d,
  };
}

// 내부의 string JSON을 자동 unwrap
function unwrapMaybeJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const trimmed = v.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return v;
  try {
    return JSON.parse(trimmed);
  } catch {
    return v;
  }
}

// data 안에서 알려진 결과 키들을 탐색. 문자열 JSON이면 자동 파싱.
function digKey(d: Record<string, unknown>, key: string): unknown {
  if (key in d) return unwrapMaybeJson(d[key]);
  const result = d.result;
  if (result && typeof result === 'object' && key in (result as Record<string, unknown>)) {
    return unwrapMaybeJson((result as Record<string, unknown>)[key]);
  }
  const response = d.response;
  if (response && typeof response === 'object' && key in (response as Record<string, unknown>)) {
    return unwrapMaybeJson((response as Record<string, unknown>)[key]);
  }
  return null;
}

// 응답이 이중 wrap된 경우 (data 안에 JSON 문자열로 output1 등이 들어있는 경우) 자동 해체.
function deepFind(d: Record<string, unknown>, key: string): unknown {
  const direct = digKey(d, key);
  if (direct !== null && direct !== undefined) return direct;
  // data가 string JSON이면 파싱해서 다시 시도
  const inner = digKey(d, 'data');
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    const r = digKey(inner as Record<string, unknown>, key);
    if (r !== null && r !== undefined) return r;
  }
  return null;
}

export function findOutput(
  parsed: ParsedMcp,
  key: 'output1' | 'output2' | 'output' | 'data',
): unknown {
  if (!parsed.raw) return null;
  return deepFind(parsed.raw, key);
}

// 단일 종목 정보 (KIS의 첫 레코드). 우선순위:
// output → output1[0] → data(파싱) → data[0] → data 자체
export function firstOutput(parsed: ParsedMcp): Record<string, unknown> | null {
  if (!parsed.raw) return null;
  const candidates: unknown[] = [
    deepFind(parsed.raw, 'output'),
    deepFind(parsed.raw, 'output1'),
    digKey(parsed.raw, 'data'),
  ];
  for (const c of candidates) {
    if (!c) continue;
    if (Array.isArray(c) && c.length > 0 && typeof c[0] === 'object') {
      return c[0] as Record<string, unknown>;
    }
    if (typeof c === 'object' && !Array.isArray(c)) {
      const o = c as Record<string, unknown>;
      // KIS-looking 필드 있으면 그대로 사용
      if (
        'stck_prpr' in o ||
        'pdno' in o ||
        'prdt_name' in o ||
        'last' in o ||
        'output' in o
      ) {
        if ('output' in o && o.output) {
          const nested = unwrapMaybeJson(o.output);
          if (Array.isArray(nested) && nested.length > 0) {
            return nested[0] as Record<string, unknown>;
          }
          if (typeof nested === 'object' && nested) return nested as Record<string, unknown>;
        }
        return o;
      }
    }
  }
  return null;
}

// 리스트 결과 (output1) 추출
export function outputList(parsed: ParsedMcp, key: 'output1' | 'output' = 'output1'): Record<string, unknown>[] {
  const v = findOutput(parsed, key);
  if (Array.isArray(v)) return v as Record<string, unknown>[];
  return [];
}

// output2 (요약 dict 보통)
export function outputDict(parsed: ParsedMcp, key: 'output2' | 'output' = 'output2'): Record<string, unknown> | null {
  const v = findOutput(parsed, key);
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
    return v[0] as Record<string, unknown>;
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

export function num(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v);
  return null;
}

export function fmtKrw(v: unknown): string {
  const n = num(v);
  return n === null ? '-' : `${Math.round(n).toLocaleString()}원`;
}

export function fmtNum(v: unknown): string {
  const n = num(v);
  return n === null ? '-' : Math.round(n).toLocaleString();
}

export function fmtPct(v: unknown, decimals = 2): string {
  const n = num(v);
  return n === null ? '-' : `${n.toFixed(decimals)}%`;
}

// KIS 응답이 정상(rt_cd='0')인지 + msg1(에러 메시지) 추출.
// MCP wrapping은 항상 ok:true로 감싸므로, 실제 KIS 실패는 raw.rt_cd로만 식별됨.
export function checkKisOk(parsed: ParsedMcp): { ok: boolean; message?: string } {
  if (!parsed.ok || !parsed.raw) return { ok: false, message: 'MCP 응답 파싱 실패' };
  const raw = parsed.raw;
  // raw 자체에 rt_cd가 있는 경우 (대부분)
  let rtCd: unknown = raw.rt_cd;
  let msg: unknown = raw.msg1 ?? raw.msg;
  // data 안에 한 번 더 wrap된 경우
  if (rtCd === undefined && typeof raw.data === 'object' && raw.data) {
    const d = raw.data as Record<string, unknown>;
    rtCd = d.rt_cd;
    msg = d.msg1 ?? d.msg;
  }
  if (rtCd === undefined) return { ok: true }; // rt_cd 자체가 없는 응답 (시세 등) → OK 가정
  return { ok: String(rtCd) === '0', message: typeof msg === 'string' ? msg : undefined };
}

// "12분", "45초", "1시간 5분", "만료됨" 같은 잔여시간 표시.
export function fmtTtl(expiresAt: number, now: number = Date.now()): string {
  const ms = expiresAt - now;
  if (ms <= 0) return '만료됨';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${s}초`;
  return `${s}초`;
}
