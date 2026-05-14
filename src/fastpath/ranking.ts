// 거래량/등락률/시가총액 랭킹 fast-path.

import { callKisApi } from '../mcp/kis.js';
import { findOutput, fmtKrw, num, parseMcpResult } from './extract.js';

type Kind = 'volume' | 'fluctuation_up' | 'fluctuation_down' | 'market_cap';

// ⚠️ KIS 모의계좌에선 ranking API가 401/거절. v1에선 fast-path 비활성.
// 사용자가 ranking 키워드 보내면 LLM도 못 풀 가능성 크니 안내 메시지로 fallback.
export function tryMatchRanking(_text: string): Kind | null {
  return null;
}

export async function handleRanking(kind: Kind): Promise<string> {
  const apiType =
    kind === 'volume' ? 'volume_rank' : kind === 'market_cap' ? 'market_cap' : 'fluctuation';

  // 기본 파라미터는 defaults.ts에 정의. 방향만 오버라이드.
  const params: Record<string, unknown> = {};
  if (kind === 'fluctuation_up') params.fid_rank_sort_cls_code = '0';
  if (kind === 'fluctuation_down') params.fid_rank_sort_cls_code = '1';

  const res = await callKisApi('domestic_stock', apiType, params);
  const parsed = parseMcpResult(res);
  if (!parsed.success) return `❌ 랭킹 조회 실패: ${parsed.error ?? '알 수 없는 오류'}`;

  const list = findOutput(parsed, 'output');
  const items = Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
  if (items.length === 0) return '결과 없음';

  const title =
    kind === 'volume'
      ? '📊 거래량 상위'
      : kind === 'fluctuation_up'
        ? '🚀 상승률 상위'
        : kind === 'fluctuation_down'
          ? '🔻 하락률 상위'
          : '💰 시가총액 상위';

  const lines = [`<b>${title} TOP 10</b>`];
  for (let i = 0; i < Math.min(10, items.length); i++) {
    const it = items[i] ?? {};
    const name = it.hts_kor_isnm ?? it.prdt_name ?? '?';
    const code = it.mksc_shrn_iscd ?? it.stck_shrn_iscd ?? it.pdno ?? '';
    const price = num(it.stck_prpr);
    const rate = num(it.prdy_ctrt);
    const vol = num(it.acml_vol);
    const sign = rate !== null && rate >= 0 ? '+' : '';
    lines.push(
      `${(i + 1).toString().padStart(2, ' ')}. ${name} (${code}) ` +
        `${fmtKrw(price)} ${rate !== null ? `${sign}${rate.toFixed(2)}%` : ''}` +
        `${vol !== null ? ` · 거래량 ${(vol / 1_000_000).toFixed(0)}M` : ''}`,
    );
  }
  return lines.join('\n');
}
