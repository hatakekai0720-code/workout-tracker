// トレーニング中モード(全画面)。進め方の計算は js/logic/workout.js、途中経過の保存は js/data/workout-session.js。
// 片手で押せるよう、よく使うボタン(完了・RIR・休憩の操作)は画面の下にまとめる。
import { getState, getExercise, applyWorkoutSaves, BODY_PARTS } from '../data/store.js';
import { loadWorkout, saveWorkout, clearWorkout } from '../data/workout-session.js';
import { musclesOf, isAvailable } from '../data/guides.js';
import {
  startWorkout, currentItem, isFinished, adjust, completeSet, setRir, addRest, endRest, restLeftSec, skipItem, reopenItem,
  swapCandidates, swapItem, previousText, finishWorkout, sessionPRs, RIR_CHOICES, REST_ADD_SEC, RESUME_HOURS,
} from '../logic/workout.js';
import { computePRs, PR_LABELS, formatPR } from '../logic/insights.js';
import { formatDuration } from '../logic/training.js';
import { toDateStr } from '../logic/dates.js';
import { openGuide } from './guide.js';
import { injuryDecision } from './injury.js';
import { esc, toast } from '../ui/util.js';

const COUNTDOWN_SEC = 3; // 休憩の終わりの何秒前から鳴らすか
const TICK_MS = 250;

let dlg = null;
let w = null; // 途中経過(js/logic/workout.js の状態)
let view = 'main'; // 'main' | 'swap' | 'end' | 'summary'
let result = null; // 終了後のまとめ
let onChange = null;
let tick = null;
let lastBeep = null;
let audio = null;
let wakeLock = null;
let wakeLockState = 'off'; // 'on' | 'off' | 'unsupported'

const settings = () => getState().settings;
const kg = (n) => `${Math.round(n * 100) / 100}`;

// ---- 画面のスリープ防止(Wake Lock) ----

async function lockScreen() {
  if (!('wakeLock' in navigator)) {
    wakeLockState = 'unsupported';
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLockState = 'on';
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
      wakeLockState = 'off';
    });
  } catch {
    wakeLockState = 'off'; // 省電力モードなどで断られた
  }
}

function unlockScreen() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// アプリに戻ってきたら取り直す(画面を離れると自動で外れるため)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && dlg?.open && !wakeLock && view !== 'summary') lockScreen().then(updateLive);
});

// ---- 音と振動 ----

function prepareAudio() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
  } catch {
    audio = null;
  }
}

function tone(freq, len) {
  if (!audio) return;
  try {
    const t0 = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.3, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + len);
    osc.connect(gain).connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + len + 0.02);
  } catch {
    /* 音が出せない環境では表示だけ */
  }
}

// ---- 状態の更新 ----

function update(next, { rerender = true } = {}) {
  w = next;
  w.updatedAt = Date.now();
  saveWorkout(w);
  if (rerender) render();
}

// ---- 描画 ----

function headHtml(title) {
  return `<header class="sheet-head wo-head">
      <span class="wo-elapsed" data-elapsed></span>
      <h2>${title}</h2>
      ${view === 'summary' || view === 'end' ? '<span class="head-spacer"></span>' : '<button type="button" class="btn-ghost" data-action="end">終了</button>'}
    </header>`;
}

function stepper(field, value, unit, label) {
  return `<div class="wo-stepper">
      <span class="wo-step-label">${label}</span>
      <button type="button" class="wo-pm" data-action="adj" data-field="${field}" data-dir="-1" aria-label="${label}を減らす">−</button>
      <span class="wo-value">${value}<small>${unit}</small></span>
      <button type="button" class="wo-pm" data-action="adj" data-field="${field}" data-dir="1" aria-label="${label}を増やす">＋</button>
    </div>`;
}

function restHtml() {
  if (!w.rest) return '';
  return `<div class="wo-rest" role="timer">
      <span class="wo-rest-label">休憩</span>
      <span class="wo-rest-time" data-rest></span>
      <span class="progress wo-rest-bar" aria-hidden="true">${'<i></i>'.repeat(16)}</span>
    </div>`;
}

function mainHtml() {
  // 最後のセットのあとも、RIR を聞くまでは同じ種目を出しておく
  const it = currentItem(w) || (w.pendingRir ? w.items[w.pendingRir.item] : null);
  if (!it) return endHtml();
  const ex = getExercise(it.exerciseId);
  const { entries } = getState();
  const prev = previousText(entries, ex, w.date);
  const n = w.items.length;
  const isRun = it.kind === 'run';
  const setNo = Math.min(it.sets.length + 1, it.plan.sets);
  const values = isRun
    ? stepper('distanceKm', kg(it.edit.distanceKm), 'km', '距離') + stepper('durationMin', it.edit.durationMin, '分', '時間')
    : (ex.loadType === 'weighted' || it.edit.weightKg > 0 ? stepper('weightKg', kg(it.edit.weightKg), 'kg', ex.loadType === 'weighted' ? '重量' : '追加の重り') : '') +
      stepper('reps', it.edit.reps, ex.loadType === 'timed' ? '秒' : '回', ex.loadType === 'timed' ? '時間' : '回数');
  const doneSets = it.sets.length
    ? `<p class="wo-sets">${it.sets.map((s, i) => `<span>${i + 1}: ${ex.loadType === 'weighted' ? `${kg(s.weightKg)}kg×` : ''}${s.reps}${ex.loadType === 'timed' ? '秒' : '回'}${s.rir != null ? ` RIR${s.rir === 4 ? '4+' : s.rir}` : ''}</span>`).join('')}</p>`
    : '';

  // 下側: RIR の入力 → 休憩の操作 → 完了ボタン
  let bottom;
  if (w.pendingRir) {
    bottom = `<p class="wo-ask">あと何回できた？(RIR)</p>
      <div class="wo-rir">${RIR_CHOICES.map((r) => `<button type="button" class="btn-ghost" data-action="rir" data-value="${r}">${r === 4 ? '4+' : r}</button>`).join('')}
        <button type="button" class="btn-ghost" data-action="rir" data-value="">スキップ</button></div>`;
  } else {
    bottom = `${w.rest ? `<div class="wo-row"><button type="button" class="btn-ghost" data-action="rest-add">＋${REST_ADD_SEC}秒</button><button type="button" class="btn-ghost" data-action="rest-skip">休憩をスキップ</button></div>` : ''}
      <div class="wo-row">
        <button type="button" class="btn-ghost" data-action="skip">種目をスキップ</button>
        ${isRun ? '' : '<button type="button" class="btn-ghost" data-action="swap">入れ替え</button>'}
      </div>
      <button type="button" class="btn-primary wo-done" data-action="complete">✓ 完了${isRun ? '' : `(${setNo}セット目)`}</button>`;
  }

  return `<div class="wo-body">
      <p class="wo-progress">種目 ${Math.min(w.cursor + 1, n)} / ${n}${w.items[w.cursor + 1] ? ` ・ 次: ${esc(getExercise(w.items[w.cursor + 1].exerciseId).name)}` : ''}</p>
      <button type="button" class="wo-name" data-action="guide">${esc(ex.name)}<small>ⓘ フォーム</small></button>
      ${it.swappedFrom && getExercise(it.swappedFrom) ? `<p class="hint">「${esc(getExercise(it.swappedFrom).name)}」から入れ替え</p>` : ''}
      ${isRun ? '' : `<p class="wo-setno"><b>${setNo}</b> / ${it.plan.sets} セット</p>`}
      <p class="prev">${prev ? `<b>前回 ${prev.date.slice(5).replace('-', '/')}</b> ${esc(prev.text)}` : '前回の記録はありません'}</p>
      ${restHtml()}
      <div class="wo-values">${values}</div>
      ${doneSets}
      ${wakeLockState === 'unsupported' ? '<p class="hint">この端末は画面のスリープ防止に対応していません。必要なら端末の設定で自動ロックを長くしてください。</p>' : ''}
    </div>
    <footer class="wo-foot">${bottom}</footer>`;
}

function swapHtml() {
  const it = currentItem(w);
  const ex = getExercise(it.exerciseId);
  const exclude = w.items.map((x) => x.exerciseId);
  // 痛みの記録で外す・入れ替える種目は候補に出さない
  const list = swapCandidates(getState().exercises, ex, { musclesOf, isAvailable, exclude }).filter((x) => ['ok', 'lighten'].includes(injuryDecision(x).action));
  return `<div class="wo-body">
      <p class="wo-ask">「${esc(ex.name)}」の代わり<span class="tag">${BODY_PARTS[ex.bodyPart] || ''}</span></p>
      <p class="hint">同じ部位で、持っている器具でできる種目です。効く筋肉が近い順に並べています。</p>
      ${
        list.length
          ? `<ul class="entry-list">${list
              .map(
                (x) => `<li><button type="button" class="entry" data-action="swap-to" data-id="${x.id}">
                  <span class="entry-main"><span class="entry-name">${esc(x.name)}</span></span><span class="chev">›</span></button></li>`,
              )
              .join('')}</ul>`
          : '<p class="empty">入れ替えられる種目がありません</p>'
      }
    </div>
    <footer class="wo-foot"><button type="button" class="btn-ghost wo-done" data-action="back">戻る</button></footer>`;
}

function endHtml() {
  const rows = w.items
    .map((it, i) => {
      const ex = getExercise(it.exerciseId);
      const state = it.kind === 'run' ? (it.run ? '完了' : it.skipped ? 'スキップ' : '未実施') : `${it.sets.length}/${it.plan.sets}セット${it.skipped ? '(スキップ)' : ''}`;
      const back = it.skipped || (it.kind === 'run' ? !it.run : it.sets.length < it.plan.sets);
      return `<li class="wo-end-row"><span class="entry-main"><span class="entry-name">${esc(ex.name)}</span><span class="entry-sub">${state}</span></span>
        ${back && view === 'end' ? `<button type="button" class="btn-ghost" data-action="reopen" data-index="${i}">戻ってやる</button>` : ''}</li>`;
    })
    .join('');
  const all = isFinished(w);
  return `<div class="wo-body">
      <p class="wo-ask">${all ? 'すべての種目が終わりました 🎉' : 'トレーニングを終了しますか？'}</p>
      <ul class="entry-list">${rows}</ul>
      <p class="hint">1セットもしなかった種目は、予定のまま残ります。</p>
      ${all ? '' : '<button type="button" class="btn-danger wide" data-action="discard">記録せずにやめる</button>'}
    </div>
    <footer class="wo-foot">
      ${all ? '' : '<button type="button" class="btn-ghost wo-done" data-action="back">続ける</button>'}
      <button type="button" class="btn-primary wo-done" data-action="finish">保存して終了</button>
    </footer>`;
}

function summaryHtml() {
  const { summary, prs } = result;
  const tile = (label, value, unit) => `<div class="tile"><span class="tile-label">${label}</span><span class="tile-value">${value}<small>${unit}</small></span></div>`;
  return `<div class="wo-body">
      <p class="wo-ask">おつかれさまでした！</p>
      <div class="tiles">
        ${tile('時間', formatDuration(summary.durationSec), '')}
        ${tile('総挙上量', Math.round(summary.volumeKg).toLocaleString('ja-JP'), 'kg')}
        ${tile('セット数', summary.setsDone, 'セット')}
        ${summary.distanceKm > 0 ? tile('距離', summary.distanceKm, 'km') : tile('種目', summary.exercisesDone, '種目')}
      </div>
      <h3>🏆 自己ベスト更新</h3>
      ${
        prs.length
          ? `<ul class="pr-recent">${prs
              .map((u) => `<li><span class="pr-what">🏆 ${esc(getExercise(u.exerciseId).name)} ${PR_LABELS[u.type]}</span>
                <span class="pr-value">${formatPR(u.type, u.value)}<small>前 ${formatPR(u.type, u.previous)}</small></span></li>`)
              .join('')}</ul>`
          : '<p class="empty">今回は更新なし。続けていけば必ず伸びます</p>'
      }
      ${summary.skipped ? `<p class="hint">スキップした ${summary.skipped}種目は、予定のまま残しています。</p>` : ''}
    </div>
    <footer class="wo-foot"><button type="button" class="btn-primary wo-done" data-action="close">閉じる</button></footer>`;
}

function render() {
  const titles = { main: 'トレーニング中', swap: '種目の入れ替え', end: '終了', summary: 'まとめ' };
  const body = view === 'summary' ? summaryHtml() : view === 'swap' ? swapHtml() : view === 'end' ? endHtml() : mainHtml();
  dlg.innerHTML = `<div class="sheet workout">${headHtml(titles[view])}${body}</div>`;
  updateLive();
}

// 毎秒変わる表示(経過時間・休憩の残り)だけを書き換える
function updateLive() {
  if (!dlg?.open || !w) return;
  const now = Date.now();
  const el = dlg.querySelector('[data-elapsed]');
  if (el) el.textContent = view === 'summary' ? '' : `⏱ ${formatDuration((now - w.startedAt) / 1000)}${wakeLockState === 'on' ? ' ・ 画面オン' : ''}`;
  if (!w.rest) return;
  const left = restLeftSec(w, now);
  const late = now - w.rest.endAt > 1500; // 離れている間に終わっていた分は鳴らさない
  if (left <= COUNTDOWN_SEC && left !== lastBeep && !late && document.visibilityState === 'visible') {
    lastBeep = left;
    if (left > 0) {
      tone(660, 0.12);
      navigator.vibrate?.(80);
    } else {
      tone(990, 0.6);
      navigator.vibrate?.([300, 100, 300]);
    }
  }
  if (left <= 0) {
    lastBeep = null;
    update(endRest(w), { rerender: view === 'main' });
    if (view === 'main' && !late) toast('休憩おわり。次のセットへ');
    return;
  }
  const t = dlg.querySelector('[data-rest]');
  if (t) t.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  const filled = Math.round(((w.rest.totalSec - left) / w.rest.totalSec) * 16);
  dlg.querySelectorAll('.wo-rest-bar i').forEach((b, i) => b.classList.toggle('on', i < filled));
}

// ---- 終了 ----

function finish() {
  const { saves, summary } = finishWorkout(w, Date.now());
  const ids = applyWorkoutSaves(saves);
  const { entries, exercises } = getState();
  result = { summary, prs: sessionPRs(computePRs(entries, exercises).updates, ids) };
  clearWorkout();
  w.rest = null;
  view = 'summary';
  unlockScreen();
  render();
  onChange?.();
}

function close() {
  clearInterval(tick);
  tick = null;
  unlockScreen();
  dlg.close();
  w = null;
  result = null;
  onChange?.();
}

function setup() {
  dlg = document.getElementById('workout-dialog');
  dlg.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-action]');
    if (!t) return;
    const step = { weightStepKg: settings().weightStepKg };
    switch (t.dataset.action) {
      case 'adj':
        update(adjust(w, t.dataset.field, Number(t.dataset.dir), step));
        break;
      case 'complete':
        prepareAudio(); // 音はタップをきっかけに準備しないと鳴らせない
        lastBeep = null;
        update(completeSet(w, Date.now()));
        if (isFinished(w) && !w.pendingRir) view = 'end';
        render();
        break;
      case 'rir':
        update(setRir(w, t.dataset.value === '' ? null : Number(t.dataset.value)));
        if (isFinished(w)) {
          view = 'end';
          render();
        }
        break;
      case 'rest-add':
        update(addRest(w));
        break;
      case 'rest-skip':
        update(endRest(w));
        break;
      case 'skip':
        if (!confirm(`「${getExercise(currentItem(w).exerciseId).name}」をスキップしますか？`)) break;
        update(skipItem(w, Date.now()));
        if (isFinished(w)) {
          view = 'end';
          render();
        }
        break;
      case 'swap':
        view = 'swap';
        render();
        break;
      case 'swap-to': {
        const ex = getExercise(t.dataset.id);
        view = 'main';
        update(swapItem(w, ex, getState().entries, step));
        toast(`「${ex.name}」に入れ替えました`);
        break;
      }
      case 'back':
        view = 'main';
        render();
        break;
      case 'guide':
        openGuide(currentItem(w).exerciseId);
        break;
      case 'end':
        view = 'end';
        render();
        break;
      case 'reopen':
        view = 'main';
        update(reopenItem(w, Number(t.dataset.index)));
        break;
      case 'finish':
        finish();
        break;
      case 'discard':
        if (!confirm('今回の記録を保存せずにやめます。よろしいですか？')) break;
        clearWorkout();
        close();
        break;
      case 'close':
        close();
        break;
    }
  });
  // 戻るボタン・Esc で閉じない(誤操作で消えないように)。まとめの画面だけは閉じる。
  dlg.addEventListener('cancel', (ev) => {
    ev.preventDefault();
    if (view === 'summary') close();
  });
}

function show() {
  if (!dlg) setup();
  view = 'main';
  if (isFinished(w)) view = 'end';
  if (!dlg.open) dlg.showModal();
  render();
  clearInterval(tick);
  tick = setInterval(updateLive, TICK_MS);
  lockScreen().then(updateLive);
}

// 予定(planned の記録)から開始する。途中のものがあれば、続けるか確かめる。
export function startWorkoutFor(entryIds, { onChange: cb } = {}) {
  onChange = cb;
  const existing = loadWorkout();
  if (existing && !confirm('途中のトレーニングがあります。破棄して新しく始めますか？\n(「キャンセル」で途中から再開します)')) {
    w = existing;
    show();
    return;
  }
  const { entries, exercises } = getState();
  const ids = new Set(entryIds);
  const exById = new Map(exercises.map((x) => [x.id, x]));
  w = startWorkout(entries.filter((e) => ids.has(e.id)), exById, { date: toDateStr(new Date()), nowMs: Date.now(), restSec: settings().restSec || undefined });
  if (!w.items.length) {
    toast('始められる予定がありません');
    w = null;
    return;
  }
  saveWorkout(w);
  show();
}

// 途中経過から再開する
export function resumeWorkout({ onChange: cb } = {}) {
  const saved = loadWorkout();
  if (!saved) return false;
  onChange = cb;
  w = saved;
  show();
  return true;
}

export function discardWorkout() {
  clearWorkout();
}

// 途中経過の案内用: { startedAt, updatedAt, recent(自動で開いてよいか), names }
export function pendingWorkout() {
  const saved = loadWorkout();
  if (!saved) return null;
  return {
    startedAt: saved.startedAt,
    recent: Date.now() - saved.updatedAt < RESUME_HOURS * 3600000,
    names: saved.items.map((it) => getExercise(it.exerciseId)?.name).filter(Boolean),
    done: saved.items.filter((it) => it.sets.length || it.run).length,
    total: saved.items.length,
  };
}

