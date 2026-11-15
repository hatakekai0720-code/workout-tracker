import { initStore } from './store.js';
import { mountHome } from './views/home.js';
import { mountCalendar } from './views/calendar.js';
import { mountBody } from './views/body.js';
import { mountStats } from './views/stats.js';
import { mountSettings } from './views/settings.js';
import { initTheme } from './theme.js';
import { initTimer, refreshTimers } from './timer.js';

initStore();
window.Chart.defaults.font.family = "'Noto Sans JP', sans-serif";

const views = {
  home: mountHome(document.getElementById('view-home')),
  calendar: mountCalendar(document.getElementById('view-calendar')),
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
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
// 端末の空き容量が減ったときに、記録が自動で消されにくくする
navigator.storage?.persist?.().catch(() => {});
