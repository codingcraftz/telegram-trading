<script setup lang="ts">
import { toasts } from '@/lib/toast';
import { CheckCircle2, XCircle, Info } from 'lucide-vue-next';
</script>

<template>
  <Teleport to="body">
    <div
      class="pointer-events-none fixed inset-x-0 top-3 z-50 mx-auto flex max-w-md flex-col gap-2 px-4"
      style="padding-top: env(safe-area-inset-top);"
    >
      <TransitionGroup
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="-translate-y-2 opacity-0"
        enter-to-class="translate-y-0 opacity-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="-translate-y-1 opacity-0"
      >
        <div
          v-for="t in toasts"
          :key="t.id"
          class="pointer-events-auto flex items-center gap-2 rounded-xl border px-3 py-2 text-sm shadow-lg backdrop-blur"
          :class="{
            'bg-emerald-500/15 border-emerald-500/40 text-emerald-200': t.kind === 'success',
            'bg-red-500/15 border-red-500/40 text-red-200': t.kind === 'error',
            'bg-sky-500/15 border-sky-500/40 text-sky-200': t.kind === 'info',
          }"
        >
          <CheckCircle2 v-if="t.kind === 'success'" class="h-4 w-4 shrink-0" />
          <XCircle v-else-if="t.kind === 'error'" class="h-4 w-4 shrink-0" />
          <Info v-else class="h-4 w-4 shrink-0" />
          <span class="flex-1">{{ t.message }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
