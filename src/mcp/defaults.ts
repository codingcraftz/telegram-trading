// KIS Trading MCP API의 기본 파라미터 자동 주입.
// 소스: open-trading-api/examples_llm/<category>/<api>/<api>.py 함수 시그니처.
// 케이스는 시그니처 그대로 (KIS 코드 lowercase + UPPERCASE 혼용).
// env_dv를 받는 API와 안 받는 API가 갈리므로 각 API별로 명시.

import { envDv } from '../runtime.js';

type Defaults = Record<string, unknown>;

// API별 기본값. env_dv가 함수 시그니처에 있으면 명시.
// envDv()는 호출 시점에 계산하기 위해 함수 형태로 보관.
function makeDefaults(toolName: string, apiType: string): Defaults {
  const dv = envDv();

  if (toolName === 'domestic_stock') {
    switch (apiType) {
      // --- 시세 (env_dv 필요) ---
      case 'inquire_price':
      case 'inquire_asking_price_exp_ccn':
        return { env_dv: dv, fid_cond_mrkt_div_code: 'J' };

      // --- 분봉/일봉 차트 ---
      case 'inquire_time_itemchartprice':
        return {
          env_dv: dv,
          fid_cond_mrkt_div_code: 'J',
          fid_input_hour_1: '', // 빈값 = 현재시각 기준
          fid_pw_data_incu_yn: 'N',
          fid_etc_cls_code: '',
        };

      case 'inquire_daily_itemchartprice':
        return {
          env_dv: dv,
          fid_cond_mrkt_div_code: 'J',
          fid_period_div_code: 'D', // D=일, W=주, M=월
          fid_org_adj_prc: '0', // 0=수정주가, 1=원주가
        };

      // --- 잔고 / 매수가능 (env_dv 필요) ---
      case 'inquire_balance':
        return {
          env_dv: dv,
          afhr_flpr_yn: 'N',
          inqr_dvsn: '02',
          unpr_dvsn: '01',
          fund_sttl_icld_yn: 'N',
          fncg_amt_auto_rdpt_yn: 'N',
          prcs_dvsn: '00',
          FK100: '',
          NK100: '',
          tr_cont: '',
        };

      case 'inquire_psbl_order':
        return {
          env_dv: dv,
          pdno: '',
          ord_unpr: '0',
          ord_dvsn: '01',
          cma_evlu_amt_icld_yn: 'N',
          ovrs_icld_yn: 'N',
        };

      case 'inquire_daily_ccld':
        return {
          env_dv: dv,
          pd_dv: 'inner',
          sll_buy_dvsn_cd: '00',
          ccld_dvsn: '00',
          inqr_dvsn: '00',
          inqr_dvsn_3: '00',
          pdno: '',
          ord_gno_brno: '',
          odno: '',
          inqr_dvsn_1: '',
          FK100: '',
          NK100: '',
          tr_cont: '',
          excg_id_dvsn_cd: 'KRX',
        };

      // --- 주문 (env_dv 필요) ---
      case 'order_cash':
      case 'order_rvsecncl':
        return { env_dv: dv, excg_id_dvsn_cd: 'KRX' };

      // --- 랭킹 (env_dv 없음) ---
      case 'volume_rank':
        return {
          fid_cond_mrkt_div_code: 'J',
          fid_cond_scr_div_code: '20171',
          fid_input_iscd: '0000',
          fid_div_cls_code: '0',
          fid_blng_cls_code: '0',
          fid_trgt_cls_code: '111111111',
          fid_trgt_exls_cls_code: '0000000000',
          fid_input_price_1: '',
          fid_input_price_2: '',
          fid_vol_cnt: '',
          fid_input_date_1: '',
        };

      case 'fluctuation':
        return {
          fid_cond_mrkt_div_code: 'J',
          fid_cond_scr_div_code: '20170',
          fid_input_iscd: '0000',
          fid_rank_sort_cls_code: '0', // 0=상승, 1=하락
          fid_input_cnt_1: '0',
          fid_prc_cls_code: '0',
          fid_input_price_1: '',
          fid_input_price_2: '',
          fid_vol_cnt: '',
          fid_trgt_cls_code: '0',
          fid_trgt_exls_cls_code: '0',
          fid_div_cls_code: '0',
          fid_rsfl_rate1: '',
          fid_rsfl_rate2: '',
        };

      case 'market_cap':
        return {
          fid_cond_mrkt_div_code: 'J',
          fid_cond_scr_div_code: '20174',
          fid_div_cls_code: '0',
          fid_input_iscd: '0000',
          fid_trgt_cls_code: '0',
          fid_trgt_exls_cls_code: '0',
          fid_input_price_1: '',
          fid_input_price_2: '',
          fid_vol_cnt: '',
        };

      // --- 종목 검색 ---
      case 'find_stock_code':
      case 'find_api_detail':
        return {};
    }
  }

  if (toolName === 'overseas_stock') {
    switch (apiType) {
      case 'price':
      case 'inquire_asking_price':
        return { env_dv: dv };
      case 'inquire_balance':
        return {
          env_dv: dv,
          ovrs_excg_cd: 'NASD',
          tr_crcy_cd: 'USD',
          ctx_area_fk200: '',
          ctx_area_nk200: '',
        };
      case 'order':
        return { env_dv: dv };
    }
  }

  return {};
}

export function applyDefaults(
  toolName: string,
  apiType: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = makeDefaults(toolName, apiType);
  // 사용자/LLM이 명시한 값으로 덮어쓰기. 케이스 그대로.
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) merged[k] = v;
  }
  return merged;
}
