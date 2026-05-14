// 차트 fast-path.
// 입력: "삼성전자 5분봉" / "005930 1분봉" / "삼성전자 차트" (= 5분봉 기본) / "삼성전자 일봉"
// 시세는 NAVER 비공식 API 사용 (당일 1분봉 ~381봉 + 일봉 100봉).
// 분봉 합성으로 5/15/60/240분 단위 만들고, 일봉은 NAVER day API 직접.

import { InlineKeyboard } from 'grammy';
import { resolveSymbol, type ResolvedSymbol } from './symbol.js';
import { renderCandlePng, type Candle } from '../charts/candle.js';
import { fetchNaverDaily, fetchNaverMinuteBars } from '../charts/naver.js';
import { listWatchlist } from '../db/repo.js';

export type ChartInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export const CHART_INTERVALS: Array<{ key: ChartInterval; label: string; minutes: number | 'day' }> = [
  { key: '1m', label: '1분봉', minutes: 1 },
  { key: '5m', label: '5분봉', minutes: 5 },
  { key: '15m', label: '15분봉', minutes: 15 },
  { key: '1h', label: '1시간봉', minutes: 60 },
  { key: '4h', label: '4시간봉', minutes: 240 },
  { key: '1d', label: '일봉', minutes: 'day' },
];

const VALID_KEYS = new Set(CHART_INTERVALS.map((c) => c.key));

type ChartIntent = {
  sym: string;
  interval: ChartInterval;
};

const TEXT_PATTERN =
  /^(?<sym>[A-Za-z가-힣0-9]+)\s+(?:(?<unit>1분봉|3분봉|5분봉|10분봉|15분봉|30분봉|1시간봉|4시간봉|일봉|주봉|월봉)|차트)\s*\??$/;

export function tryMatchChart(text: string): ChartIntent | null {
  const m = text.trim().match(TEXT_PATTERN);
  if (!m) return null;
  const sym = m.groups!.sym!;
  const unit = m.groups!.unit;
  if (!unit) return { sym, interval: '5m' };
  const map: Record<string, ChartInterval> = {
    '1분봉': '1m',
    '3분봉': '5m', // 3분봉은 5분으로 그래픽 보강
    '5분봉': '5m',
    '10분봉': '15m',
    '15분봉': '15m',
    '30분봉': '1h',
    '1시간봉': '1h',
    '4시간봉': '4h',
    '일봉': '1d',
    '주봉': '1d',
    '월봉': '1d',
  };
  const interval = map[unit];
  if (!interval) return null;
  return { sym, interval };
}

// 1시간봉 N개 → 4시간봉 합성 (4개씩 묶음).
function aggregateHourlyTo4h(hourly: Candle[]): Candle[] {
  if (hourly.length === 0) return [];
  const out: Candle[] = [];
  for (let i = 0; i < hourly.length; i += 4) {
    const group = hourly.slice(i, i + 4);
    if (group.length === 0) continue;
    out.push({
      time: group[0]!.time,
      open: group[0]!.open,
      close: group[group.length - 1]!.close,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      volume: group.reduce((s, c) => s + (c.volume ?? 0), 0),
    });
  }
  return out;
}

export type ChartResult = {
  png: Buffer;
  caption: string;
};

export async function handleChart(intent: ChartIntent): Promise<ChartResult | string> {
  const sym = await resolveSymbol(intent.sym);
  if (!sym) return `❓ 종목을 찾지 못했습니다: ${intent.sym}`;

  if (!VALID_KEYS.has(intent.interval)) return `❌ 지원하지 않는 분봉: ${intent.interval}`;

  let candles: Candle[];
  try {
    switch (intent.interval) {
      case '1m':
        candles = await fetchNaverMinuteBars(sym.code, 1, 180);
        break;
      case '5m':
        candles = await fetchNaverMinuteBars(sym.code, 5, 180);
        break;
      case '15m':
        candles = await fetchNaverMinuteBars(sym.code, 15, 180);
        break;
      case '1h':
        candles = await fetchNaverMinuteBars(sym.code, 60, 180);
        break;
      case '4h': {
        const hourly = await fetchNaverMinuteBars(sym.code, 60, 720); // 4시간봉 180개 ≈ 720 1시간봉
        candles = aggregateHourlyTo4h(hourly);
        break;
      }
      case '1d':
        candles = await fetchNaverDaily(sym.code, 200);
        break;
    }
  } catch (err) {
    return `❌ 시세 조회 실패 (${sym.name}): ${(err as Error).message}`;
  }

  if (candles.length === 0) return `❌ ${sym.name} ${intent.interval} 데이터 없음.`;

  // 가독성: 너무 많으면 최근 200봉으로 자름 (이전 120 → 200, 사용자 요청)
  const MAX_BARS = 200;
  if (candles.length > MAX_BARS) candles = candles.slice(-MAX_BARS);

  const last = candles[candles.length - 1]!;
  const first = candles[0]!;
  const change = last.close - first.open;
  const changePct = (change / first.open) * 100;
  const arrow = change >= 0 ? '▲' : '▼';
  const intervalLabel =
    CHART_INTERVALS.find((c) => c.key === intent.interval)?.label ?? intent.interval;

  const png = await renderCandlePng({
    title: `${sym.name} (${sym.code}) — ${intervalLabel}`,
    subtitle: `${first.time} ~ ${last.time}  ·  봉 ${candles.length}개  ·  ${last.close.toLocaleString()}원 ${arrow}${Math.abs(Math.round(change)).toLocaleString()}원 (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`,
    candles,
    width: 1000,
    height: 520,
  });

  return {
    png,
    caption:
      `📈 ${sym.name} ${intervalLabel}\n` +
      `${first.time} ~ ${last.time} · ${candles.length}봉\n` +
      `종가 ${last.close.toLocaleString()}원 (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`,
  };
}

// ===== 메뉴 빌더 =====

export function buildChartMainMenu(chatId: number): { text: string; kb: InlineKeyboard } {
  const wl = listWatchlist(chatId);
  const kb = new InlineKeyboard();
  for (const w of wl) {
    kb.text(w.symbolName, `chartpick:${w.symbolCode}`).row();
  }
  kb.text('🔍 검색하기', 'chartmenu:search');
  const text =
    wl.length === 0
      ? '📈 <b>차트</b>\n관심종목이 없습니다. [🔍 검색하기]로 종목을 찾아보세요.'
      : '📈 <b>차트</b>\n관심종목 중 선택하거나 [🔍 검색하기]를 누르세요.';
  return { text, kb };
}

export function buildChartSearchPrompt(): { text: string; kb: InlineKeyboard } {
  return {
    text:
      '🔍 <b>차트 — 종목 검색</b>\n' +
      '검색어를 입력해주세요.\n' +
      '예: <code>삼성전자</code> · <code>005930</code>',
    kb: new InlineKeyboard().text('⬅️ 뒤로', 'chartmenu:back'),
  };
}

export function buildChartSearchResults(
  q: string,
  candidates: ResolvedSymbol[],
): { text: string; kb: InlineKeyboard } {
  const kb = new InlineKeyboard();
  for (const c of candidates) {
    kb.text(`${c.name} (${c.code})`, `chartpick:${c.code}`).row();
  }
  kb.text('⬅️ 뒤로', 'chartmenu:back');
  return {
    text: `🔍 "${q}" 검색 결과 (${candidates.length}개)`,
    kb,
  };
}

export function buildChartIntervalMenu(
  code: string,
  name: string,
): { text: string; kb: InlineKeyboard } {
  const kb = new InlineKeyboard();
  CHART_INTERVALS.forEach((c, i) => {
    kb.text(c.label, `chartint:${code}:${c.key}`);
    if (i % 3 === 2) kb.row();
  });
  kb.row().text('⬅️ 뒤로', 'chartmenu:back');
  return {
    text: `📈 <b>${name}</b> (${code})\n분봉을 선택하세요.`,
    kb,
  };
}
