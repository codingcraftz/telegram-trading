<script lang="ts">
// 타입 export는 <script lang> (setup 아닌)에서 가능.
export type TradeCandle = {
  ts: number; // milliseconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
</script>

<script setup lang="ts">
// 인터랙티브 캔들 차트 (lightweight-charts).
// kiwoom 차트 컴포넌트 Vue 포팅. 모바일 터치 친화 + 실시간 봉 업데이트.

import { ref, onMounted, onUnmounted, watch } from 'vue';
import {
  CandlestickSeries,
  HistogramSeries,
  LineStyle,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';

const props = withDefaults(
  defineProps<{
    candles: TradeCandle[];
    height?: number;
    showVolume?: boolean;
    entry?: number | null;
    stopLoss?: number | null;
    takeProfit?: number | null;
  }>(),
  { height: 360, showVolume: true, entry: null, stopLoss: null, takeProfit: null },
);

// 한국식 색상 (양봉=빨강, 음봉=파랑)
const THEME = {
  bg: '#0f172a',
  text: '#cbd5e1',
  grid: '#1e293b',
  border: '#334155',
  candle: {
    up: '#ef4444',
    down: '#3b82f6',
    upWick: '#ef4444',
    downWick: '#3b82f6',
  },
  volume: {
    up: '#ef444466',
    down: '#3b82f666',
  },
  lines: {
    entry: '#f59e0b',
    sl: '#3b82f6',
    tp: '#22c55e',
  },
};

const containerRef = ref<HTMLDivElement | null>(null);
let chart: IChartApi | null = null;
let candleSeries: ISeriesApi<'Candlestick'> | null = null;
let volumeSeries: ISeriesApi<'Histogram'> | null = null;
let priceLines: IPriceLine[] = [];
let ro: ResizeObserver | null = null;

function buildChart() {
  const el = containerRef.value;
  if (!el) return;
  chart = createChart(el, {
    width: el.clientWidth,
    height: props.height,
    layout: {
      background: { color: THEME.bg },
      textColor: THEME.text,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: THEME.grid },
      horzLines: { color: THEME.grid },
    },
    rightPriceScale: { borderColor: THEME.border },
    timeScale: {
      borderColor: THEME.border,
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 6,
      barSpacing: 6,
    },
    crosshair: { mode: 1 }, // Magnet 모드
    // 모바일 터치 친화: pinch zoom + drag pan
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
  });

  candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: THEME.candle.up,
    downColor: THEME.candle.down,
    wickUpColor: THEME.candle.upWick,
    wickDownColor: THEME.candle.downWick,
    borderVisible: false,
  });

  volumeSeries = chart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
    visible: props.showVolume,
  });
  chart.priceScale('volume').applyOptions({
    scaleMargins: props.showVolume ? { top: 0.78, bottom: 0 } : { top: 1, bottom: 0 },
  });

  ro = new ResizeObserver((entries) => {
    for (const e of entries) chart?.applyOptions({ width: e.contentRect.width });
  });
  ro.observe(el);
}

function setData() {
  if (!candleSeries || !volumeSeries) return;
  if (props.candles.length === 0) {
    candleSeries.setData([]);
    volumeSeries.setData([]);
    return;
  }
  const sorted = [...props.candles].sort((a, b) => a.ts - b.ts);
  // dedup
  const dedup: TradeCandle[] = [];
  let lastTs = -1;
  for (const c of sorted) {
    if (c.ts === lastTs) dedup[dedup.length - 1] = c;
    else if (c.ts > lastTs) {
      dedup.push(c);
      lastTs = c.ts;
    }
  }
  const cdata: CandlestickData[] = dedup.map((c) => ({
    time: Math.floor(c.ts / 1000) as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
  const vdata: HistogramData[] = dedup.map((c) => ({
    time: Math.floor(c.ts / 1000) as UTCTimestamp,
    value: c.volume,
    color: c.close >= c.open ? THEME.volume.up : THEME.volume.down,
  }));
  candleSeries.setData(cdata);
  volumeSeries.setData(vdata);
  chart?.timeScale().fitContent();
}

function refreshLines() {
  const s = candleSeries;
  if (!s) return;
  for (const pl of priceLines) {
    try {
      s.removePriceLine(pl);
    } catch {
      /* ignore */
    }
  }
  priceLines = [];

  const add = (price: number | null | undefined, title: string, color: string, style: LineStyle) => {
    if (price == null || !Number.isFinite(price)) return;
    priceLines.push(
      s.createPriceLine({
        price,
        color,
        lineStyle: style,
        lineWidth: 2,
        axisLabelVisible: true,
        title,
        axisLabelColor: color,
        axisLabelTextColor: '#fff',
      }),
    );
  };
  add(props.entry, 'ENTRY', THEME.lines.entry, LineStyle.Solid);
  add(props.stopLoss, 'SL', THEME.lines.sl, LineStyle.Dashed);
  add(props.takeProfit, 'TP', THEME.lines.tp, LineStyle.Dashed);
}

onMounted(() => {
  buildChart();
  setData();
  refreshLines();
});
onUnmounted(() => {
  ro?.disconnect();
  chart?.remove();
  chart = null;
  candleSeries = null;
  volumeSeries = null;
  priceLines = [];
});

// 부모가 candles 갱신하면 차트 재렌더
watch(() => props.candles, () => setData(), { deep: false });
watch(
  () => [props.entry, props.stopLoss, props.takeProfit],
  () => refreshLines(),
);
watch(
  () => props.height,
  (h) => chart?.applyOptions({ height: h }),
);
watch(
  () => props.showVolume,
  (sv) => {
    volumeSeries?.applyOptions({ visible: sv });
    chart?.priceScale('volume').applyOptions({
      scaleMargins: sv ? { top: 0.78, bottom: 0 } : { top: 1, bottom: 0 },
    });
  },
);
</script>

<template>
  <div ref="containerRef" class="w-full select-none rounded-lg overflow-hidden" :style="{ height: `${height}px` }" />
</template>
