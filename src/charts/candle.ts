// 캔들차트 SVG 생성 + sharp로 PNG 변환.
// 외부 차트 라이브러리 없이 직접 그림 (sharp만 의존, prebuilt 바이너리).
//
// 한국식 색상: 양봉=빨강(#e23744), 음봉=파랑(#1e88e5).

import sharp from 'sharp';

export type Candle = {
  time: string; // HH:MM
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type CandleChartArgs = {
  title: string;
  subtitle?: string;
  candles: Candle[];
  width?: number;
  height?: number;
};

const COLOR_UP = '#e23744';
const COLOR_DOWN = '#1e88e5';
const COLOR_FLAT = '#888888';
const COLOR_AXIS = '#444444';
const COLOR_GRID = '#e5e5e5';
const COLOR_BG = '#ffffff';
const COLOR_TEXT = '#222222';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildCandleSvg(args: CandleChartArgs): string {
  const W = args.width ?? 1000;
  const H = args.height ?? 520;
  const padL = 80;
  const padR = 30;
  const padT = 60;
  const padB = 50;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const candles = args.candles;
  if (candles.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${COLOR_BG}"/><text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="${COLOR_TEXT}" font-size="20" font-family="NanumGothic, Nanum Gothic, sans-serif">데이터 없음</text></svg>`;
  }

  // 0/NaN/음수 가격 row는 noise — 통계에서 제외하되 캔들은 그대로 그림 (사용자가 봉 누락 인지)
  const validLows = candles.map((c) => c.low).filter((v) => Number.isFinite(v) && v > 0);
  const validHighs = candles.map((c) => c.high).filter((v) => Number.isFinite(v) && v > 0);
  const minP = validLows.length > 0 ? Math.min(...validLows) : 0;
  const maxP = validHighs.length > 0 ? Math.max(...validHighs) : 1;
  const range = maxP - minP;
  const pad = range > 0 ? range * 0.05 : Math.max(1, maxP * 0.001);

  // y축을 "nice numbers"로 정렬 — 사람이 읽기 좋은 라운드 숫자.
  // 예: 70512~73188 → 70000/70500/71000/.../73500/74000 (step=500)
  const niceStep = (rough: number): number => {
    if (rough <= 0) return 1;
    const exp = Math.floor(Math.log10(rough));
    const f = rough / Math.pow(10, exp);
    // 1, 2, 5, 10 시리즈에 align
    const nice = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    return nice * Math.pow(10, exp);
  };
  const targetTicks = 6;
  const step = niceStep((range + pad * 2) / targetTicks);
  const yMin = Math.floor((minP - pad) / step) * step;
  const yMax = Math.ceil((maxP + pad) / step) * step;
  const ySpan = yMax - yMin || 1;

  const xStep = plotW / candles.length;
  const candleW = Math.max(2, xStep * 0.7);

  const yToPx = (price: number): number =>
    padT + ((yMax - price) / ySpan) * plotH;
  const xToPx = (i: number): number => padL + xStep * (i + 0.5);

  // 가격 그리드 — step 단위로 라운드 라벨 (yMin~yMax 안에서)
  const gridLines: string[] = [];
  for (let p = yMin; p <= yMax + 1e-6; p += step) {
    const y = yToPx(p);
    gridLines.push(
      `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + plotW}" y2="${y.toFixed(1)}" stroke="${COLOR_GRID}" stroke-width="1" />`,
    );
    gridLines.push(
      `<text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" font-family="NanumGothic, Nanum Gothic, sans-serif" fill="${COLOR_AXIS}">${Math.round(p).toLocaleString()}</text>`,
    );
  }

  // x축 시간 라벨 (최대 6개)
  const xLabels: string[] = [];
  const labelEvery = Math.max(1, Math.ceil(candles.length / 6));
  for (let i = 0; i < candles.length; i += labelEvery) {
    const x = xToPx(i);
    xLabels.push(
      `<text x="${x.toFixed(1)}" y="${(padT + plotH + 18).toFixed(1)}" text-anchor="middle" font-size="11" font-family="NanumGothic, Nanum Gothic, sans-serif" fill="${COLOR_AXIS}">${escapeXml(candles[i]!.time)}</text>`,
    );
  }

  // 캔들 본체
  const bodies: string[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const x = xToPx(i);
    const yHigh = yToPx(c.high);
    const yLow = yToPx(c.low);
    const yOpen = yToPx(c.open);
    const yClose = yToPx(c.close);
    const isUp = c.close > c.open;
    const isDown = c.close < c.open;
    const color = isUp ? COLOR_UP : isDown ? COLOR_DOWN : COLOR_FLAT;
    // wick
    bodies.push(
      `<line x1="${x.toFixed(1)}" y1="${yHigh.toFixed(1)}" x2="${x.toFixed(1)}" y2="${yLow.toFixed(1)}" stroke="${color}" stroke-width="1" />`,
    );
    // body (양봉=속채움, 음봉=속채움 — 둘 다 채움이 한국 차트 관습)
    const bodyTop = Math.min(yOpen, yClose);
    const bodyH = Math.max(1, Math.abs(yClose - yOpen));
    bodies.push(
      `<rect x="${(x - candleW / 2).toFixed(1)}" y="${bodyTop.toFixed(1)}" width="${candleW.toFixed(1)}" height="${bodyH.toFixed(1)}" fill="${color}" stroke="${color}" />`,
    );
  }

  // 마지막 봉 종가 기준선 (사용자가 현재가 위치 즉시 인지)
  const lastClose = candles[candles.length - 1]?.close;
  let lastLine = '';
  if (Number.isFinite(lastClose) && lastClose! > 0 && lastClose! >= yMin && lastClose! <= yMax) {
    const ly = yToPx(lastClose!);
    const isUp = (candles[candles.length - 1]!.close ?? 0) >= (candles[candles.length - 1]!.open ?? 0);
    const lineColor = isUp ? COLOR_UP : COLOR_DOWN;
    lastLine =
      `<line x1="${padL}" y1="${ly.toFixed(1)}" x2="${padL + plotW}" y2="${ly.toFixed(1)}" stroke="${lineColor}" stroke-width="1" stroke-dasharray="4 3" opacity="0.6" />` +
      `<rect x="${padL + plotW + 1}" y="${(ly - 9).toFixed(1)}" width="${padR - 2}" height="18" fill="${lineColor}" />` +
      `<text x="${padL + plotW + padR / 2}" y="${(ly + 4).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="600" font-family="NanumGothic, Nanum Gothic, sans-serif" fill="#fff">${Math.round(lastClose!).toLocaleString()}</text>`;
  }

  // 외곽 박스
  const frame = `<rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="none" stroke="${COLOR_AXIS}" stroke-width="1" />`;

  // 헤더
  const header = `
    <text x="${padL}" y="28" font-size="18" font-family="NanumGothic, Nanum Gothic, sans-serif" font-weight="600" fill="${COLOR_TEXT}">${escapeXml(args.title)}</text>
    ${args.subtitle ? `<text x="${padL}" y="48" font-size="12" font-family="NanumGothic, Nanum Gothic, sans-serif" fill="${COLOR_AXIS}">${escapeXml(args.subtitle)}</text>` : ''}
  `;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${COLOR_BG}"/>
  ${header}
  ${gridLines.join('\n  ')}
  ${frame}
  ${bodies.join('\n  ')}
  ${lastLine}
  ${xLabels.join('\n  ')}
</svg>`;
}

export async function renderCandlePng(args: CandleChartArgs): Promise<Buffer> {
  const svg = buildCandleSvg(args);
  return await sharp(Buffer.from(svg)).png().toBuffer();
}
