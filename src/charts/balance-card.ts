// 잔고 카드 — 보유 종목 상세를 SVG 카드로 그려 PNG 첨부.
// 한국식 색상: 수익 = 빨강, 손실 = 파랑.

import sharp from 'sharp';

export type BalanceHolding = {
  name: string;
  code: string;
  qty: number;
  avg: number;
  cur: number;
  pflsAmt: number;
  pflsRt: number;
};

export type BalanceCardArgs = {
  totalEvlu: number; // 총평가
  cash: number; // 예수금
  totalPfls: number; // 평가손익 합
  totalPflsRt: number; // 자산증감수익률
  holdings: BalanceHolding[];
};

const COLOR_UP = '#e23744';
const COLOR_DOWN = '#1e88e5';
const COLOR_FLAT = '#666666';
const COLOR_BG = '#ffffff';
const COLOR_TEXT = '#1a1a1a';
const COLOR_SUB = '#666666';
const COLOR_LINE = '#eeeeee';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtKrw(n: number): string {
  return Math.round(n).toLocaleString() + '원';
}

function signed(n: number): string {
  return (n >= 0 ? '+' : '') + Math.round(n).toLocaleString();
}

function pflsColor(v: number): string {
  return v > 0 ? COLOR_UP : v < 0 ? COLOR_DOWN : COLOR_FLAT;
}

function buildSvg(args: BalanceCardArgs): string {
  const W = 800;
  const padX = 32;
  const headerH = 130;
  const rowH = 92;
  const footerH = 24;
  const H = headerH + Math.max(1, args.holdings.length) * rowH + footerH;
  const FONT = 'NanumGothic, Nanum Gothic, sans-serif';

  const totalColor = pflsColor(args.totalPfls);

  let body = '';

  // 헤더 카드 (총자산 / 예수금 / 평가손익)
  body += `
  <rect x="0" y="0" width="${W}" height="${H}" fill="${COLOR_BG}"/>
  <text x="${padX}" y="42" font-family="${FONT}" font-size="20" font-weight="700" fill="${COLOR_TEXT}">💰 내 계좌</text>
  <text x="${padX}" y="74" font-family="${FONT}" font-size="14" fill="${COLOR_SUB}">총 평가</text>
  <text x="${padX}" y="100" font-family="${FONT}" font-size="28" font-weight="700" fill="${COLOR_TEXT}">${esc(fmtKrw(args.totalEvlu))}</text>
  <text x="${W - padX}" y="74" text-anchor="end" font-family="${FONT}" font-size="14" fill="${COLOR_SUB}">예수금</text>
  <text x="${W - padX}" y="100" text-anchor="end" font-family="${FONT}" font-size="18" font-weight="600" fill="${COLOR_TEXT}">${esc(fmtKrw(args.cash))}</text>
  <text x="${padX}" y="124" font-family="${FONT}" font-size="14" font-weight="600" fill="${totalColor}">평가손익 ${signed(args.totalPfls)}원 (${args.totalPflsRt >= 0 ? '+' : ''}${args.totalPflsRt.toFixed(2)}%)</text>
  <line x1="${padX}" y1="${headerH - 5}" x2="${W - padX}" y2="${headerH - 5}" stroke="${COLOR_LINE}" stroke-width="1"/>
  `;

  if (args.holdings.length === 0) {
    body += `<text x="${W / 2}" y="${headerH + 50}" text-anchor="middle" font-family="${FONT}" font-size="16" fill="${COLOR_SUB}">보유 종목 없음</text>`;
  } else {
    args.holdings.forEach((h, i) => {
      const y = headerH + i * rowH;
      const c = pflsColor(h.pflsAmt);
      const arrow = h.pflsAmt > 0 ? '▲' : h.pflsAmt < 0 ? '▼' : '–';

      body += `
  <text x="${padX}" y="${y + 26}" font-family="${FONT}" font-size="17" font-weight="700" fill="${COLOR_TEXT}">${esc(h.name)}</text>
  <text x="${padX + 8 + h.name.length * 17}" y="${y + 26}" font-family="${FONT}" font-size="13" fill="${COLOR_SUB}">${esc(h.code)} · ${h.qty}주</text>
  <text x="${W - padX}" y="${y + 26}" text-anchor="end" font-family="${FONT}" font-size="17" font-weight="700" fill="${c}">${arrow} ${h.pflsRt >= 0 ? '+' : ''}${h.pflsRt.toFixed(2)}%</text>
  <text x="${padX}" y="${y + 52}" font-family="${FONT}" font-size="13" fill="${COLOR_SUB}">매입 ${esc(fmtKrw(h.avg))} → 현재 ${esc(fmtKrw(h.cur))}</text>
  <text x="${W - padX}" y="${y + 52}" text-anchor="end" font-family="${FONT}" font-size="14" font-weight="600" fill="${c}">${signed(h.pflsAmt)}원</text>
  `;
      if (i < args.holdings.length - 1) {
        body += `<line x1="${padX}" y1="${y + rowH - 6}" x2="${W - padX}" y2="${y + rowH - 6}" stroke="${COLOR_LINE}" stroke-width="1"/>`;
      }
    });
  }

  // 푸터 — 생성 시각
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const stamp = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')} ${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')} KST`;
  body += `<text x="${W - padX}" y="${H - 8}" text-anchor="end" font-family="${FONT}" font-size="11" fill="${COLOR_SUB}">${stamp}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`;
}

export async function renderBalanceCardPng(args: BalanceCardArgs): Promise<Buffer> {
  const svg = buildSvg(args);
  return await sharp(Buffer.from(svg)).png().toBuffer();
}
