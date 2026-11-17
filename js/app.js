import { initStore } from './data/store.js';
import { mountHome } from './views/home.js';
import { mountCalendar } from './views/calendar.js';
import { mountBody } from './views/body.js';
import { mountStats } from './views/stats.js';
import { mountExercises } from './views/exercises.js';
import { loadGuides, syncCatalog } from './data/guides.js';
import { mountSettings } from './views/settings.js';
import { initTheme } from './ui/theme.js';
import { initTimer, refreshTimers } from './ui/timer.js';
import { toast } from './ui/util.js';
import { resumeWorkout, pendingWorkout } from './views/workout.js';
import { checkMissed } from './views/reschedule.js';
import { syncInjuryAdjustments } from './views/injury.js';

const loaded = initStore();
await loadGuides();
syncCatalog();
window.Chart.defaults.font.family = "'Noto Sans JP', sans-serif";

// 過去の未実施の予定を振り替える(設定が自動のとき。結果はホームのバナーに出る)
checkMissed();
// 痛み・ケガの記録に合わせて、今日以降の予定を調整する(治ったあとの戻し方は日ごとに変わる)
syncInjuryAdjustments();

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
  syncInjuryAdjustments(); // 日付が変わると調整(回復中の重さ)も変わる
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

// トレーニングの途中でアプリを閉じていたら、続きから開く(しばらく前のものはホームの案内から再開する)
if (pendingWorkout()?.recent) resumeWorkout({ onChange: () => shown && views[shown].render() });

// 保存データを変換したとき・新しい版のデータを読んだときは知らせる
if (loaded.migratedFrom !== null) toast('データを新しい形に変換しました(変換前の状態は自動バックアップに残しています)');
else if (loaded.tooNew) toast('新しい版のアプリで保存したデータです。アプリを最新の版にしてください');

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
