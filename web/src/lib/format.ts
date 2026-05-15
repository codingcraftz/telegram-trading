// 한국 시장 표시 포맷 유틸.

export function fmtKrw(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '-';
  return Math.round(n).toLocaleString() + '원';
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '-';
  return Math.round(n).toLocaleString();
}

export function fmtPct(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '-';
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}%`;
}

export function fmtSigned(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '-';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${Math.round(n).toLocaleString()}`;
}

// 양수 = 빨강(up), 음수 = 파랑(down)
export function pflsColor(n: number | null | undefined): string {
  if (!n || n === 0) return 'text-muted-foreground';
  return n > 0 ? 'text-up' : 'text-down';
}

// 만료까지 남은 시간 mm:ss
export function fmtTtl(ms: number): string {
  if (ms <= 0) return '만료';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m > 0) return `${m}분 ${s}초`;
  return `${s}초`;
}

export function fmtTimeAgo(unixMs: number): string {
  const diff = Date.now() - unixMs;
  if (diff < 60_000) return '방금';
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  return `${h}시간 전`;
}

export function fmtKstTime(iso: string | number): string {
  const d = typeof iso === 'string' ? new Date(iso) : new Date(iso);
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  const HH = String(kst.getUTCHours()).padStart(2, '0');
  const MM = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${HH}:${MM}`;
}
