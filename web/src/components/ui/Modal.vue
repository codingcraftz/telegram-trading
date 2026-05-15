<script setup lang="ts">
const props = defineProps<{ open: boolean; title?: string }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-100"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center"
        @click.self="emit('close')"
      >
        <Transition
          enter-active-class="transition duration-200"
          enter-from-class="translate-y-4 opacity-0 sm:translate-y-0 sm:scale-95"
          enter-to-class="translate-y-0 opacity-100 sm:scale-100"
        >
          <div
            v-if="open"
            class="w-full max-w-md rounded-t-2xl border border-border bg-card p-5 shadow-2xl sm:rounded-2xl"
            style="padding-bottom: max(1.25rem, env(safe-area-inset-bottom));"
          >
            <h3 v-if="title" class="mb-3 text-base font-semibold">{{ title }}</h3>
            <slot />
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
