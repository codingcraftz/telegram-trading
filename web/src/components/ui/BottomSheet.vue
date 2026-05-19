<script setup lang="ts">
// BottomSheet — 옛 Modal 톤 그대로 + 하단 슬라이드업 + footer 슬롯 + grab handle.
import { watch, onUnmounted } from 'vue';
import { X } from 'lucide-vue-next';

const props = withDefaults(
  defineProps<{ open: boolean; title?: string; dismissible?: boolean }>(),
  { dismissible: true },
);
const emit = defineEmits<{ close: [] }>();

function onBackdrop() { if (props.dismissible) emit('close'); }
function lock() { document.body.style.overflow = 'hidden'; }
function unlock() { document.body.style.overflow = ''; }
watch(() => props.open, (v) => (v ? lock() : unlock()), { immediate: true });
onUnmounted(unlock);
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-150"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-40 bg-black/60"
        @click="onBackdrop"
      />
    </Transition>
    <Transition
      enter-active-class="transition duration-300 ease-out"
      leave-active-class="transition duration-200 ease-in"
      enter-from-class="translate-y-full"
      leave-to-class="translate-y-full"
    >
      <div
        v-if="open"
        class="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90vh] max-w-md flex-col rounded-t-2xl border border-b-0 border-border bg-card shadow-2xl"
        style="padding-bottom: env(safe-area-inset-bottom);"
        @click.stop
      >
        <!-- grab handle -->
        <div class="flex justify-center pt-2">
          <div class="h-1 w-10 rounded-full bg-muted" />
        </div>

        <!-- header -->
        <div v-if="title || dismissible" class="flex items-center justify-between px-5 pt-3">
          <h3 v-if="title" class="text-base font-bold tracking-tight">{{ title }}</h3>
          <span v-else />
          <button
            v-if="dismissible"
            type="button"
            class="-mr-2 rounded-full p-2 text-muted-foreground transition hover:bg-accent"
            aria-label="닫기"
            @click="emit('close')"
          >
            <X class="h-5 w-5" />
          </button>
        </div>

        <!-- body -->
        <div class="flex-1 overflow-y-auto px-5 pt-3 pb-4">
          <slot />
        </div>

        <!-- footer -->
        <div v-if="$slots.footer" class="border-t border-border bg-card px-5 py-3">
          <slot name="footer" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
