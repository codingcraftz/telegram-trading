<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    data: number[];
    width?: number;
    height?: number;
    color?: string;
    strokeWidth?: number;
    fill?: boolean;
  }>(),
  { width: 100, height: 32, strokeWidth: 1.5, fill: true },
);

const path = computed(() => {
  const d = props.data;
  if (d.length < 2) return { line: '', area: '' };
  const min = Math.min(...d);
  const max = Math.max(...d);
  const range = max - min || 1;
  const w = props.width;
  const h = props.height;
  const padY = 2;
  const innerH = h - padY * 2;
  const step = w / (d.length - 1);
  const pts = d.map((v, i) => {
    const x = i * step;
    const y = padY + innerH - ((v - min) / range) * innerH;
    return [x, y] as [number, number];
  });
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ');
  const area = `${line} L ${w} ${h} L 0 ${h} Z`;
  return { line, area };
});

const trendColor = computed(() => {
  if (props.color) return props.color;
  const d = props.data;
  if (d.length < 2) return 'currentColor';
  return d[d.length - 1]! >= d[0]! ? '#e23744' : '#1e88e5';
});

const gradId = computed(() => `spark-${Math.random().toString(36).slice(2, 9)}`);
</script>

<template>
  <svg
    :viewBox="`0 0 ${width} ${height}`"
    :width="width"
    :height="height"
    preserveAspectRatio="none"
    class="block"
  >
    <defs v-if="fill">
      <linearGradient :id="gradId" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" :stop-color="trendColor" stop-opacity="0.18" />
        <stop offset="100%" :stop-color="trendColor" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path v-if="fill && path.area" :d="path.area" :fill="`url(#${gradId})`" />
    <path
      v-if="path.line"
      :d="path.line"
      fill="none"
      :stroke="trendColor"
      :stroke-width="strokeWidth"
      stroke-linejoin="round"
      stroke-linecap="round"
      vector-effect="non-scaling-stroke"
    />
  </svg>
</template>
