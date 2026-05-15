// PWA 아이콘 생성 — SVG → 192/512 PNG. web/public/에 저장.
//
// 사용: pnpm tsx scripts/make-icons.ts

import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="96" fill="url(#bg)"/>
  <text x="256" y="290" font-size="220" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-weight="800" text-anchor="middle" fill="#3b82f6">📈</text>
  <text x="256" y="430" font-size="56" font-family="-apple-system, sans-serif" font-weight="700" text-anchor="middle" fill="#e2e8f0">OWLIM</text>
</svg>
`;

async function main() {
  const outDir = './web/public';
  mkdirSync(outDir, { recursive: true });

  for (const size of [192, 512]) {
    const png = await sharp(Buffer.from(ICON_SVG)).resize(size, size).png().toBuffer();
    const path = `${outDir}/icon-${size}.png`;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, png);
    console.log(`wrote ${path} (${png.length} bytes)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
