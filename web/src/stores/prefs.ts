import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export type Mode = 'easy' | 'advanced';
export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'owlim:prefs';

function load(): { mode: Mode; theme: Theme } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { mode: 'easy', theme: 'system' };
    const parsed = JSON.parse(raw);
    return {
      mode: parsed.mode === 'advanced' ? 'advanced' : 'easy',
      theme: parsed.theme === 'light' || parsed.theme === 'dark' ? parsed.theme : 'system',
    };
  } catch {
    return { mode: 'easy', theme: 'system' };
  }
}

function applyTheme(theme: Theme) {
  const html = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const wantDark = theme === 'dark' || (theme === 'system' && prefersDark);
  html.classList.toggle('dark', wantDark);
}

export const usePrefs = defineStore('prefs', () => {
  const initial = load();
  const mode = ref<Mode>(initial.mode);
  const theme = ref<Theme>(initial.theme);

  applyTheme(theme.value);

  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  mql.addEventListener('change', () => {
    if (theme.value === 'system') applyTheme('system');
  });

  watch([mode, theme], ([m, t]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: m, theme: t }));
    applyTheme(t);
  });

  return { mode, theme };
});
