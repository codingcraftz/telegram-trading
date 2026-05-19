<script lang="ts">
export type TradeCandle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
</script>

<script setup lang="ts">
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
    /** 처음 보이는 바 개수 (이후엔 pinch zoom으로 조절) */
    visibleBars?: number | null;
  }>(),
  { height: 360, showVolume: true, entry: null, stopLoss: null, takeProfit: null, visibleBars: null },
);

function readCssColor(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `hsl(${v})` : fallback;
}

const THEME = {
  candle: { up: '#e23744', down: '#1e88e5' },
  volume: { up: 'rgba(226, 55, 68, 0.45)', down: 'rgba(30, 136, 229, 0.45)' },
  lines: { entry: '#f59e0b', sl: '#3b82f6', tp: '#22c55e' },
};

const containerRef = ref<HTMLDivElement | null>(null);
let chart: IChartApi | null = null;
let candleSeries: ISeriesApi<'Candlestick'> | null = null;
let volumeSeries: ISeriesApi<'Histogram'> | null = null;
let priceLines: IPriceLine[] = [];
let ro: ResizeObserver | null = null;

function themedOptions() {
  const isDark = document.documentElement.classList.contains('dark');
  const bg = readCssColor('--card', isDark ? '#181b21' : '#ffffff');
  const text = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)';
  const grid = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
  const border = 'transparent';
  return { bg, text, grid, border };
}

function buildChart() {
  const el = containerRef.value;
  if (!el) return;
  const t = themedOptions();
  chart = createChart(el, {
    width: el.clientWidth,
    height: props.height,
    layout: {
      background: { color: t.bg },
      textColor: t.text,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 11,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: t.grid, style: LineStyle.Dotted },
      horzLines: { color: t.grid, style: LineStyle.Dotted },
    },
    rightPriceScale: {
      borderColor: t.border,
      borderVisible: false,
      scaleMargins: { top: 0.08, bottom: 0.26 },
      entireTextOnly: true,
    },
    timeScale: {
      borderColor: t.border,
      borderVisible: false,
      timeVisible: false,
      secondsVisible: false,
      rightOffset: 4,
      barSpacing: 8,
      fixLeftEdge: false,
      fixRightEdge: false,
    },
    crosshair: {
      mode: 1,
      vertLine: { color: 'rgba(127,127,127,0.5)', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#222' },
      horzLine: { color: 'rgba(127,127,127,0.5)', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#222' },
    },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
  });

  candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: THEME.candle.up,
    downColor: THEME.candle.down,
    wickUpColor: THEME.candle.up,
    wickDownColor: THEME.candle.down,
    borderVisible: false,
    priceFormat: { type: 'price', precision: 0, minMove: 1 },
    priceLineVisible: false,
    lastValueVisible: true,
  });

  volumeSeries = chart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
    visible: props.showVolume,
    priceLineVisible: false,
    lastValueVisible: false,
  });
  chart.priceScale('volume').applyOptions({
    scaleMargins: props.showVolume ? { top: 0.82, bottom: 0 } : { top: 1, bottom: 0 },
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
    open: c.open, high: c.high, low: c.low, close: c.close,
  }));
  const vdata: HistogramData[] = dedup.map((c) => ({
    time: Math.floor(c.ts / 1000) as UTCTimestamp,
    value: c.volume,
    color: c.close >= c.open ? THEME.volume.up : THEME.volume.down,
  }));
  candleSeries.setData(cdata);
  volumeSeries.setData(vdata);

  const ts = chart?.timeScale();
  if (!ts) return;
  if (props.visibleBars && dedup.length > props.visibleBars) {
    const total = dedup.length;
    ts.setVisibleLogicalRange({ from: total - props.visibleBars, to: total - 0.5 });
  } else {
    ts.fitContent();
  }
}

function refreshLines() {
  const s = candleSeries;
  if (!s) return;
  for (const pl of priceLines) {
    try { s.removePriceLine(pl); } catch { /* ignore */ }
  }
  priceLines = [];
  const add = (price: number | null | undefined, title: string, color: string, style: LineStyle) => {
    if (price == null || !Number.isFinite(price)) return;
    priceLines.push(
      s.createPriceLine({
        price, color, lineStyle: style, lineWidth: 1,
        axisLabelVisible: true, title,
        axisLabelColor: color, axisLabelTextColor: '#fff',
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

watch(() => props.candles, () => setData(), { deep: false });
watch(() => [props.entry, props.stopLoss, props.takeProfit], () => refreshLines());
watch(() => props.height, (h) => chart?.applyOptions({ height: h }));
watch(() => props.showVolume, (sv) => {
  volumeSeries?.applyOptions({ visible: sv });
  chart?.priceScale('volume').applyOptions({
    scaleMargins: sv ? { top: 0.82, bottom: 0 } : { top: 1, bottom: 0 },
  });
});
</script>

<template>
  <div ref="containerRef" class="w-full select-none overflow-hidden rounded-lg" :style="{ height: `${height}px` }" />
</template>
