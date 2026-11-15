// セット間のインターバルタイマー。
// 終了時刻を持って残りを計算するので、アプリを離れて戻っても残り時間は正しい。
// 画面のどこでも <div data-timer> を置けば同じタイマーが表示される。
import { getState } from './store.js';
import { toast } from './util.js';

const KEY = 'workoutTracker.timer';
const DONE_SHOW_MS = 4000;
const BLOCKS = 16; // 進み具合のブロック数

let endAt = null;
let totalSec = 0;
let doneUntil = 0;
let audio = null;

try {
  const saved = JSON.parse(localStorage.getItem(KEY));
  if (saved && saved.endAt > Date.now()) ({ endAt, totalSec } = saved);
} catch {
  /* 壊れていたら使わない */
}

const fmt = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

function presets() {
  const s = getState().settings;
  const list = [...s.timerPresets];
  if (s.timerCustomSec && !list.includes(s.timerCustomSec)) list.push(s.timerCustomSec);
  return list;
}

function beep() {
  try {
    const t0 = audio.currentTime;
    [0, 0.28, 0.56].forEach((at) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + at + 0.2);
      osc.connect(gain).connect(audio.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.22);
    });
  } catch {
    /* 音が出せない環境では表示だけ */
  }
}

function start(sec) {
  totalSec = sec;
  endAt = Date.now() + sec * 1000;
  doneUntil = 0;
  localStorage.setItem(KEY, JSON.stringify({ endAt, totalSec }));
  // 音はタップをきっかけに準備しておかないと鳴らせない
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
  } catch {
    audio = null;
  }
  refreshTimers();
}

function stop() {
  endAt = null;
  doneUntil = 0;
  localStorage.removeItem(KEY);
  refreshTimers();
}

function finish(late) {
  endAt = null;
  localStorage.removeItem(KEY);
  doneUntil = Date.now() + DONE_SHOW_MS;
  if (late) return; // 離れている間に終わっていた分は鳴らさない
  beep();
  navigator.vibrate?.([200, 100, 200]);
  toast('⏰ インターバル終了');
}

export const timerHtml = () => '<div class="timer" data-timer></div>';

// 表示中のすべてのタイマーを今の状態に合わせる。画面を描き直したあとにも呼ぶ。
export function refreshTimers() {
  const now = Date.now();
  if (endAt && now >= endAt) finish(now - endAt > 1500);
  const mode = endAt ? 'running' : now < doneUntil ? 'done' : 'idle';
  const remaining = endAt ? Math.ceil((endAt - now) / 1000) : 0;
  const filled = endAt ? Math.round(((totalSec - remaining) / totalSec) * BLOCKS) : BLOCKS;

  for (const el of document.querySelectorAll('[data-timer]')) {
    if (el.dataset.mode !== mode) {
      el.dataset.mode = mode;
      el.innerHTML =
        mode === 'idle'
          ? `<span class="timer-label">インターバル</span>
             <span class="timer-presets">${presets()
               .map((s) => `<button type="button" class="btn-ghost" data-timer-start="${s}">${s}秒</button>`)
               .join('')}</span>`
          : `<span class="timer-time" role="timer" aria-live="off"></span>
             <span class="progress" aria-hidden="true">${'<i></i>'.repeat(BLOCKS)}</span>
             <button type="button" class="btn-ghost" data-timer-stop>${mode === 'done' ? '閉じる' : '停止'}</button>`;
    }
    if (mode === 'idle') continue;
    el.querySelector('.timer-time').textContent = mode === 'done' ? '終了！' : fmt(remaining);
    el.querySelectorAll('.progress i').forEach((b, i) => b.classList.toggle('on', i < filled));
  }
}

export function initTimer() {
  document.addEventListener('click', (ev) => {
    const startBtn = ev.target.closest('[data-timer-start]');
    if (startBtn) return start(Number(startBtn.dataset.timerStart));
    if (ev.target.closest('[data-timer-stop]')) stop();
  });
  setInterval(refreshTimers, 250);
  document.addEventListener('visibilitychange', refreshTimers);
}
