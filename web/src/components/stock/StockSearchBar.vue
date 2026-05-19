<script setup lang="ts">
// StockSearchBar — 종목 탭 전용. sticky top + 한글 IME composition 안전.
import { ref, watch, onMounted, nextTick } from 'vue';
import { Search, X } from 'lucide-vue-next';

const props = defineProps<{ modelValue: string; autofocus?: boolean; placeholder?: string }>();
const emit = defineEmits<{ 'update:modelValue': [string]; focus: []; blur: [] }>();

const inputEl = ref<HTMLInputElement | null>(null);
const isComposing = ref(false);

watch(() => props.modelValue, (v) => {
  if (inputEl.value && inputEl.value.value !== v) inputEl.value.value = v;
});

function onInput(e: Event) {
  const value = (e.target as HTMLInputElement).value;
  if (isComposing.value) return;
  emit('update:modelValue', value);
}
function onCompositionStart() { isComposing.value = true; }
function onCompositionEnd(e: CompositionEvent) {
  isComposing.value = false;
  emit('update:modelValue', (e.target as HTMLInputElement).value);
}
function clear() {
  emit('update:modelValue', '');
  if (inputEl.value) { inputEl.value.value = ''; inputEl.value.focus(); }
}
function focus() { inputEl.value?.focus(); }
defineExpose({ focus });

onMounted(async () => {
  if (props.autofocus) { await nextTick(); focus(); }
});
</script>

<template>
  <div class="sticky top-0 z-20 -mx-4 bg-background/85 px-4 pb-2 pt-1 backdrop-blur">
    <div class="relative">
      <Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref="inputEl"
        :value="modelValue"
        type="search"
        inputmode="search"
        autocomplete="off"
        spellcheck="false"
        :placeholder="placeholder ?? '종목명 또는 6자리 코드'"
        class="w-full rounded-lg border border-border bg-background py-2.5 pl-9 pr-9 text-sm focus:border-primary focus:outline-none"
        @input="onInput"
        @compositionstart="onCompositionStart"
        @compositionend="onCompositionEnd"
        @focus="$emit('focus')"
        @blur="$emit('blur')"
      />
      <button
        v-if="modelValue"
        type="button"
        class="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition hover:bg-accent"
        aria-label="지우기"
        @click="clear"
      >
        <X class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>
