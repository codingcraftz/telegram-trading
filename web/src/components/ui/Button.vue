<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'outline';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const props = withDefaults(
  defineProps<{
    variant?: Variant;
    size?: Size;
    disabled?: boolean;
    type?: 'button' | 'submit';
  }>(),
  { variant: 'primary', size: 'md', type: 'button' },
);

const cls = computed(() =>
  cn(
    'inline-flex items-center justify-center rounded-lg font-medium transition-colors',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    {
      'bg-primary text-primary-foreground hover:bg-primary/90': props.variant === 'primary',
      'bg-secondary text-secondary-foreground hover:bg-secondary/80': props.variant === 'secondary',
      'hover:bg-accent hover:text-accent-foreground': props.variant === 'ghost',
      'bg-destructive text-destructive-foreground hover:bg-destructive/90': props.variant === 'destructive',
      'border border-border hover:bg-accent': props.variant === 'outline',
    },
    {
      'h-8 px-3 text-xs': props.size === 'sm',
      'h-10 px-4 text-sm': props.size === 'md',
      'h-12 px-6 text-base': props.size === 'lg',
      'h-10 w-10': props.size === 'icon',
    },
  ),
);
</script>

<template>
  <button :class="cls" :disabled="disabled" :type="type">
    <slot />
  </button>
</template>
