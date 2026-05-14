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
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${COLOR_BG}"/><text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="${COLOR_TEXT}" font-size="20" font-family="sans-serif">데이터 없음</text></svg>`;
  }

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const minP = Math.min(...lows);
  const maxP = Math.max(...highs);
  const range = maxP - minP;
  const pad = range > 0 ? range * 0.05 : Math.max(1, maxP * 0.001);
  const yMin = minP - pad;
  const yMax = maxP + pad;
  const ySpan = yMax - yMin || 1;

  const xStep = plotW / candles.length;
  const candleW = Math.max(2, xStep * 0.7);

  const yToPx = (price: number): number =>
    padT + ((yMax - price) / ySpan) * plotH;
  const xToPx = (i: number): number => padL + xStep * (i + 0.5);

  // 가격 그리드 (5칸)
  const gridLines: string[] = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    const price = yMax - t * ySpan;
    const y = padT + t * plotH;
    gridLines.push(
      `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + plotW}" y2="${y.toFixed(1)}" stroke="${COLOR_GRID}" stroke-width="1" />`,
    );
    gridLines.push(
      `<text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" font-family="sans-serif" fill="${COLOR_AXIS}">${Math.round(price).toLocaleString()}</text>`,
    );
  }

  // x축 시간 라벨 (최대 6개)
  const xLabels: string[] = [];
  const labelEvery = Math.max(1, Math.ceil(candles.length / 6));
  for (let i = 0; i < candles.length; i += labelEvery) {
    const x = xToPx(i);
    xLabels.push(
      `<text x="${x.toFixed(1)}" y="${(padT + plotH + 18).toFixed(1)}" text-anchor="middle" font-size="11" font-family="sans-serif" fill="${COLOR_AXIS}">${escapeXml(candles[i]!.time)}</text>`,
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

  // 외곽 박스
  const frame = `<rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="none" stroke="${COLOR_AXIS}" stroke-width="1" />`;

  // 헤더
  const header = `
    <text x="${padL}" y="28" font-size="18" font-family="sans-serif" font-weight="600" fill="${COLOR_TEXT}">${escapeXml(args.title)}</text>
    ${args.subtitle ? `<text x="${padL}" y="48" font-size="12" font-family="sans-serif" fill="${COLOR_AXIS}">${escapeXml(args.subtitle)}</text>` : ''}
  `;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${COLOR_BG}"/>
  ${header}
  ${gridLines.join('\n  ')}
  ${frame}
  ${bodies.join('\n  ')}
  ${xLabels.join('\n  ')}
</svg>`;
}

export async function renderCandlePng(args: CandleChartArgs): Promise<Buffer> {
  const svg = buildCandleSvg(args);
  return await sharp(Buffer.from(svg)).png().toBuffer();
}
