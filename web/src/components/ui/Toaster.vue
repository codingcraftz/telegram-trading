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
          class="pointer-events-auto flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium text-white shadow-lg"
          :class="{
            'bg-emerald-600 border-emerald-700': t.kind === 'success',
            'bg-red-600 border-red-700': t.kind === 'error',
            'bg-sky-600 border-sky-700': t.kind === 'info',
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
