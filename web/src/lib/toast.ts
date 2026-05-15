// 간단한 토스트 시스템 — Pinia 의존성 없이 reactive ref.
import { ref } from 'vue';

export type ToastKind = 'success' | 'error' | 'info';
export type Toast = { id: number; kind: ToastKind; message: string };

export const toasts = ref<Toast[]>([]);
let nextId = 1;

function push(kind: ToastKind, message: string, durationMs = 3500) {
  const id = nextId++;
  toasts.value.push({ id, kind, message });
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, durationMs);
}

export const toast = {
  success: (msg: string) => push('success', msg),
  error: (msg: string) => push('error', msg, 5000),
  info: (msg: string) => push('info', msg),
};
