// テーマ(端末に合わせる / ライト / ダーク)を <html data-theme> に反映する。
// 起動直後のちらつきを防ぐため、index.html の先頭にも同じ判定の短いスクリプトがある。
import { getState } from './store.js';

const media = window.matchMedia('(prefers-color-scheme: dark)');
let onChange = () => {};

export function applyTheme() {
  const pref = getState().settings.theme;
  const theme = pref === 'light' || pref === 'dark' ? pref : media.matches ? 'dark' : 'light';
  if (document.documentElement.dataset.theme === theme) return;
  document.documentElement.dataset.theme = theme;
  onChange(); // グラフは色を描き込むので描き直してもらう
}

export function initTheme(callback) {
  onChange = callback;
  media.addEventListener('change', applyTheme);
  applyTheme();
}
