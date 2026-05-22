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
  LineSeries,
  LineStyle,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
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
    visibleBars?: number | null;
    movingAverages?: number[];
    splitVolume?: boolean;
    volumeHeight?: number;
    /** 분봉 모드 — 시간축에 시각 표시 + 크로스헤어 날짜/시간 */
    isMinute?: boolean;
  }>(),
  {
    height: 360,
    showVolume: true,
    entry: null,
    stopLoss: null,
    takeProfit: null,
    visibleBars: null,
    movingAverages: () => [],
    splitVolume: false,
    volumeHeight: 80,
    isMinute: false,
  },
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
  // 이동평균선 색상 — KIS 차트 동일 매핑.
  ma: { 5: '#e23744', 20: '#a855f7', 60: '#1e88e5', 120: '#22c55e' } as Record<number, string>,
  maDefault: '#94a3b8',
};

function smaSeries(candles: TradeCandle[], period: number): LineData[] {
  if (period <= 1 || candles.length < period) return [];
  const out: LineData[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i]!.close;
    if (i >= period) sum -= candles[i - period]!.close;
    if (i >= period - 1) {
      out.push({
        time: Math.floor(candles[i]!.ts / 1000) as UTCTimestamp,
        value: sum / period,
      });
    }
  }
  return out;
}

const containerRef = ref<HTMLDivElement | null>(null);
const volumeContainerRef = ref<HTMLDivElement | null>(null);
const tooltipData = ref<{
  label: string;
  open: number; high: number; low: number; close: number; volume: number;
  openPct: number; highPct: number; lowPct: number; closePct: number;
  up: boolean;
} | null>(null);

function fmtPctSigned(v: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function findPrevClose(tsMs: number): number {
  const sorted = props.candles;
  for (let i = sorted.length - 1; i >= 1; i--) {
    if (sorted[i]!.ts === tsMs) return sorted[i - 1]!.close;
  }
  return 0;
}
let chart: IChartApi | null = null;
let volChart: IChartApi | null = null;
let candleSeries: ISeriesApi<'Candlestick'> | null = null;
let volumeSeries: ISeriesApi<'Histogram'> | null = null;
let maSeries: { period: number; series: ISeriesApi<'Line'> }[] = [];
let priceLines: IPriceLine[] = [];
let ro: ResizeObserver | null = null;
let syncingRange = false;

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
  const isSplit = props.splitVolume && props.showVolume;
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
      // split 모드면 volume 이 별도 chart 라 가격 차트가 거의 전 영역 사용.
      scaleMargins: isSplit ? { top: 0.05, bottom: 0.05 } : { top: 0.08, bottom: 0.26 },
      entireTextOnly: true,
    },
    timeScale: {
      borderColor: t.border,
      borderVisible: false,
      timeVisible: props.isMinute,
      secondsVisible: false,
      rightOffset: 4,
      barSpacing: 8,
      fixLeftEdge: false,
      fixRightEdge: false,
      visible: !isSplit,
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

  if (isSplit) {
    // ───── 거래량 별도 chart 인스턴스 + 시간축 동기화 ─────
    const vol = volumeContainerRef.value;
    if (vol) {
      volChart = createChart(vol, {
        width: vol.clientWidth,
        height: props.volumeHeight,
        layout: {
          background: { color: t.bg },
          textColor: t.text,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 11,
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: t.grid, style: LineStyle.Dotted },
          horzLines: { visible: false },
        },
        rightPriceScale: {
          borderColor: t.border,
          borderVisible: false,
          scaleMargins: { top: 0.1, bottom: 0.05 },
          entireTextOnly: true,
        },
        timeScale: {
          borderColor: t.border,
          borderVisible: false,
          timeVisible: props.isMinute,
          secondsVisible: false,
          rightOffset: 4,
          barSpacing: 8,
        },
        crosshair: { mode: 1 },
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      });
      volumeSeries = volChart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceLineVisible: false,
        lastValueVisible: false,
      });

      // 시간축 양방향 sync — 무한 루프 방지 flag
      chart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
        if (syncingRange || !r || !volChart) return;
        syncingRange = true;
        try { volChart.timeScale().setVisibleLogicalRange(r); } finally { syncingRange = false; }
      });
      volChart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
        if (syncingRange || !r || !chart) return;
        syncingRange = true;
        try { chart.timeScale().setVisibleLogicalRange(r); } finally { syncingRange = false; }
      });
    }
  } else {
    // 통합 모드 — 가격 차트 안에 volume histogram (별도 priceScale)
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
  }

  // 크로스헤어 OHLCV 툴팁
  chart.subscribeCrosshairMove((param) => {
    if (!param.time || !candleSeries) {
      tooltipData.value = null;
      return;
    }
    const cd = param.seriesData.get(candleSeries) as CandlestickData | undefined;
    if (!cd) { tooltipData.value = null; return; }
    const ts = (param.time as number) * 1000;
    const kst = new Date(ts + 9 * 3600 * 1000);
    const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(kst.getUTCDate()).padStart(2, '0');
    let label = `${mm}/${dd}`;
    if (props.isMinute) {
      const hh = String(kst.getUTCHours()).padStart(2, '0');
      const mn = String(kst.getUTCMinutes()).padStart(2, '0');
      label += ` ${hh}:${mn}`;
    }
    const vol = volumeSeries ? (param.seriesData.get(volumeSeries) as HistogramData | undefined)?.value : undefined;
    // 이전 봉 종가 기준 변동률
    const prevClose = findPrevClose(ts);
    const pct = (v: number) => prevClose > 0 ? ((v - prevClose) / prevClose) * 100 : 0;
    tooltipData.value = {
      label,
      open: cd.open, high: cd.high, low: cd.low, close: cd.close,
      volume: vol ?? 0,
      openPct: pct(cd.open), highPct: pct(cd.high), lowPct: pct(cd.low), closePct: pct(cd.close),
      up: cd.close >= cd.open,
    };
  });

  ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      if (e.target === el) chart?.applyOptions({ width: e.contentRect.width });
      else if (e.target === volumeContainerRef.value) volChart?.applyOptions({ width: e.contentRect.width });
    }
  });
  ro.observe(el);
  if (volumeContainerRef.value) ro.observe(volumeContainerRef.value);
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

  // 이동평균선 갱신
  rebuildMaSeries(dedup);

  const ts = chart?.timeScale();
  if (!ts) return;
  if (props.visibleBars && dedup.length > props.visibleBars) {
    const total = dedup.length;
    ts.setVisibleLogicalRange({ from: total - props.visibleBars, to: total - 0.5 });
  } else {
    ts.fitContent();
  }
}

function rebuildMaSeries(candles: TradeCandle[]) {
  if (!chart || !candleSeries) return;
  // 기존 series 정리
  for (const { series } of maSeries) {
    try { chart.removeSeries(series); } catch { /* ignore */ }
  }
  maSeries = [];
  // periods prop 으로 새로 생성
  for (const p of props.movingAverages) {
    if (!Number.isFinite(p) || p <= 1) continue;
    const color = THEME.ma[p] ?? THEME.maDefault;
    const s = chart.addSeries(LineSeries, {
      color,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    s.setData(smaSeries(candles, p));
    maSeries.push({ period: p, series: s });
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
  volChart?.remove();
  chart = null;
  volChart = null;
  candleSeries = null;
  volumeSeries = null;
  maSeries = [];
  priceLines = [];
});

watch(() => props.candles, () => setData(), { deep: false });
watch(() => props.movingAverages, () => rebuildMaSeries(props.candles), { deep: false });
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
  <div class="relative">
    <!-- OHLCV 팝업 카드 — 크로스헤어 활성 시 차트 위에 오버레이 -->
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 scale-95"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="tooltipData"
        class="pointer-events-none absolute left-2 top-2 z-10 rounded-lg bg-card/95 ring-1 ring-border/60 px-3 py-2 shadow-lg backdrop-blur-sm"
      >
        <div class="flex items-center gap-2 mb-1.5">
          <span class="text-[11px] font-semibold text-muted-foreground">{{ tooltipData.label }}</span>
          <button
            class="pointer-events-auto ml-auto rounded p-0.5 text-muted-foreground/60 hover:text-foreground transition"
            @click="tooltipData = null"
          >✕</button>
        </div>
        <div class="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
          <span class="text-muted-foreground">시</span>
          <span class="text-right font-semibold">{{ tooltipData.open.toLocaleString() }}</span>
          <span :class="tooltipData.openPct >= 0 ? 'text-up' : 'text-down'" class="text-right text-[10px]">{{ fmtPctSigned(tooltipData.openPct) }}</span>

          <span class="text-up font-semibold">고</span>
          <span class="text-right font-semibold">{{ tooltipData.high.toLocaleString() }}</span>
          <span :class="tooltipData.highPct >= 0 ? 'text-up' : 'text-down'" class="text-right text-[10px]">{{ fmtPctSigned(tooltipData.highPct) }}</span>

          <span class="text-down font-semibold">저</span>
          <span class="text-right font-semibold">{{ tooltipData.low.toLocaleString() }}</span>
          <span :class="tooltipData.lowPct >= 0 ? 'text-up' : 'text-down'" class="text-right text-[10px]">{{ fmtPctSigned(tooltipData.lowPct) }}</span>

          <span class="text-muted-foreground">종가</span>
          <span class="text-right font-semibold" :class="tooltipData.up ? 'text-up' : 'text-down'">{{ tooltipData.close.toLocaleString() }}</span>
          <span :class="tooltipData.closePct >= 0 ? 'text-up' : 'text-down'" class="text-right text-[10px]">{{ fmtPctSigned(tooltipData.closePct) }}</span>

          <span class="text-muted-foreground">거래량</span>
          <span class="text-right font-semibold col-span-2">{{ tooltipData.volume.toLocaleString() }}</span>
        </div>
      </div>
    </Transition>
    <div ref="containerRef" class="w-full select-none overflow-hidden rounded-t-lg" :style="{ height: `${height}px` }" />
    <div
      v-if="splitVolume && showVolume"
      ref="volumeContainerRef"
      class="w-full select-none overflow-hidden border-t border-border/60 rounded-b-lg"
      :style="{ height: `${volumeHeight}px` }"
    />
  </div>
</template>
