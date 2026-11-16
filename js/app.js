import { initStore } from './store.js';
import { mountHome } from './views/home.js';
import { mountCalendar } from './views/calendar.js';
import { mountBody } from './views/body.js';
import { mountStats } from './views/stats.js';
import { mountExercises } from './views/exercises.js';
import { loadGuides, syncCatalog } from './guides.js';
import { mountSettings } from './views/settings.js';
import { initTheme } from './theme.js';
import { initTimer, refreshTimers } from './timer.js';
import { toast } from './util.js';

initStore();
await loadGuides();
syncCatalog();
window.Chart.defaults.font.family = "'Noto Sans JP', sans-serif";

const views = {
  home: mountHome(document.getElementById('view-home')),
  calendar: mountCalendar(document.getElementById('view-calendar')),
  exercises: mountExercises(document.getElementById('view-exercises')),
  stats: mountStats(document.getElementById('view-stats')),
  body: mountBody(document.getElementById('view-body')),
  settings: mountSettings(document.getElementById('view-settings')),
};

let shown = null;

function show(name) {
  if (!views[name]) name = 'home';
  for (const key of Object.keys(views)) {
    document.getElementById(`view-${key}`).hidden = key !== name;
  }
  for (const a of document.querySelectorAll('.tabbar a')) {
    if (a.hash === `#${name}`) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  views[name].render();
  refreshTimers();
  if (name !== shown) window.scrollTo(0, 0);
  shown = name;
}

initTimer();
initTheme(() => shown && show(shown));
window.addEventListener('hashchange', () => show(location.hash.slice(1)));
show(location.hash.slice(1));

// グラフの文字は読み込み前のフォントで描かれるので、読み込み後に描き直す
document.fonts?.ready.then(() => show(location.hash.slice(1)));

// オフラインでも開けるようにする。失敗してもアプリ自体は動く。
if ('serviceWorker' in navigator) {
  const register = () => navigator.serviceWorker.register('sw.js').catch(() => {});
  // 新しい版の Service Worker に切り替わったら、1回だけ読み込み直して新しい画面にする。
  // 最初の登録(まだ何も制御していなかった)ときと、入力中(ダイアログが開いている)ときは読み込み直さない。
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    if (document.querySelector('dialog[open]')) {
      toast('新しい版を受け取りました。アプリを開き直すと反映されます');
      return;
    }
    reloaded = true;
    location.reload();
  });
  // このファイルは解説データの読み込みを待つので、ここに来た時点で load が済んでいることがある
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register);
}
// 端末の空き容量が減ったときに、記録が自動で消されにくくする
navigator.storage?.persist?.().catch(() => {});
