// メニューの登録・編集フォーム(予定の入力と、実施済みにしたときの実績入力)。
import { getState, getExercise, getEntry, upsertEntry, deleteEntry } from '../store.js';
import {
  findPrevious,
  paceSecPerKm,
  formatPace,
  formatDateJa,
  formatShortDate,
  describeActual,
} from '../calc.js';
import { computePRs, PR_LABELS } from '../insights.js';
import { timerHtml, refreshTimers } from '../timer.js';
import { groupByCategory, isAvailable } from '../guides.js';
import { timeOptions } from '../schedule.js';
import { openGuide } from './guide.js';
import { esc, toast } from '../util.js';

const MAX_SETS = 20;

let dlg = null;
let session = null; // { date, entryId, onChange, model }

const str = (v) => (v == null ? '' : String(v));
const splitDur = (sec) => (sec > 0 ? { min: str(Math.floor(sec / 60)), sec: str(sec % 60) } : { min: '', sec: '' });
const emptyPlan = () => ({ weight: '', reps: '', sets: '', distance: '', min: '', sec: '' });
const emptyRun = () => ({ distance: '', min: '', sec: '' });

function planToModel(ex, plan) {
  if (ex.kind === 'run') return { ...emptyPlan(), distance: str(plan.distanceKm), ...splitDur(plan.durationSec) };
  return { ...emptyPlan(), weight: str(plan.weightKg), reps: str(plan.reps), sets: str(plan.sets) };
}

// 新規のときは、前回の予定を初期値にする
function planFromPrevious(exerciseId, date) {
  const prev = findPrevious(getState().entries, exerciseId, date);
  return prev ? planToModel(getExercise(exerciseId), prev.plan) : emptyPlan();
}

function modelFromEntry(e) {
  const ex = getExercise(e.exerciseId);
  const m = {
    exerciseId: e.exerciseId,
    done: e.status === 'done',
    plan: planToModel(ex, e.plan),
    actualSets: [],
    actualRun: emptyRun(),
    memo: e.memo || '',
    date: e.date,
    time: e.time || '',
    duration: e.durationMin ? String(e.durationMin) : '',
    rpe: e.rpe ? String(e.rpe) : '',
  };
  if (e.actual) {
    if (ex.kind === 'run') m.actualRun = { distance: str(e.actual.distanceKm), ...splitDur(e.actual.durationSec) };
    else m.actualSets = e.actual.sets.map((s) => ({ weight: str(s.weightKg), reps: str(s.reps) }));
  }
  return m;
}

function copyPlanToActual(m) {
  const ex = getExercise(m.exerciseId);
  if (ex.kind === 'run') {
    m.actualRun = { distance: m.plan.distance, min: m.plan.min, sec: m.plan.sec };
  } else {
    const n = Math.min(Math.max(parseInt(m.plan.sets, 10) || 1, 1), MAX_SETS);
    m.actualSets = Array.from({ length: n }, () => ({ weight: m.plan.weight, reps: m.plan.reps }));
  }
}

// ---- 入力値の読み取り ----

const num = (s) => (String(s).trim() === '' ? NaN : Number(s));
const isInt = (n) => Number.isInteger(n);

// 分・秒の入力 → 秒。両方空なら null、不正なら NaN。
function durationOf(o) {
  if (o.min.trim() === '' && o.sec.trim() === '') return null;
  const mi = num(o.min || '0');
  const se = num(o.sec || '0');
  if (!isInt(mi) || !isInt(se) || mi < 0 || se < 0 || se > 59) return NaN;
  return mi * 60 + se > 0 ? mi * 60 + se : NaN;
}

function livePace(o) {
  const dur = durationOf(o);
  const pace = paceSecPerKm(num(o.distance), dur);
  return pace == null ? 'ペース —' : `ペース ${formatPace(pace)}`;
}

// model → 保存する entry。入力に問題があれば { error }。
function buildEntry() {
  const m = session.model;
  const ex = getExercise(m.exerciseId);
  let plan;
  let actual = null;

  if (ex.kind === 'run') {
    const d = num(m.plan.distance);
    if (!(d > 0)) return { error: '予定の距離を入力してください' };
    const dur = durationOf(m.plan);
    if (Number.isNaN(dur)) return { error: '予定の時間を正しく入力してください(秒は0〜59)' };
    plan = { distanceKm: d, durationSec: dur };
    if (m.done) {
      const ad = num(m.actualRun.distance);
      if (!(ad > 0)) return { error: '実績の距離を入力してください' };
      const adur = durationOf(m.actualRun);
      if (!(adur > 0)) return { error: '実績の時間を入力してください(秒は0〜59)' };
      actual = { distanceKm: ad, durationSec: adur };
    }
  } else {
    const amount = ex.loadType === 'timed' ? '秒数' : '回数';
    const readWeight = (s) => {
      if (ex.loadType === 'timed') return 0;
      if (ex.loadType === 'bodyweight' && String(s).trim() === '') return 0;
      return num(s);
    };
    const w = readWeight(m.plan.weight);
    if (!(w >= 0)) return { error: '予定の重量を入力してください' };
    const reps = num(m.plan.reps);
    if (!isInt(reps) || reps < 1) return { error: `予定の${amount}を入力してください` };
    const sets = num(m.plan.sets);
    if (!isInt(sets) || sets < 1 || sets > MAX_SETS) return { error: `セット数は1〜${MAX_SETS}で入力してください` };
    plan = { weightKg: w, reps, sets };
    if (m.done) {
      if (!m.actualSets.length) return { error: '実績のセットを1つ以上入力してください' };
      const out = [];
      for (const [i, s] of m.actualSets.entries()) {
        const sw = readWeight(s.weight);
        const sr = num(s.reps);
        if (!(sw >= 0)) return { error: `${i + 1}セット目の重量を入力してください` };
        if (!isInt(sr) || sr < 0) return { error: `${i + 1}セット目の${amount}を入力してください` };
        out.push({ weightKg: sw, reps: sr });
      }
      actual = { sets: out };
    }
  }

  if (!m.date) return { error: '日付を入力してください' };
  // 画面にない項目(プログラムとの結びつきなど)を消さないよう、元の記録を土台にする
  const entry = {
    ...(session.entryId ? getEntry(session.entryId) : {}),
    id: session.entryId || null,
    date: m.date,
    exerciseId: m.exerciseId,
    status: m.done ? 'done' : 'planned',
    plan,
    actual,
    memo: m.memo.trim(),
  };
  delete entry.time;
  delete entry.durationMin;
  delete entry.rpe;
  if (m.done && m.rpe) entry.rpe = Number(m.rpe);
  if (m.time) {
    entry.time = m.time;
    if (m.duration) entry.durationMin = Number(m.duration);
  }
  return { entry };
}

// ---- 描画 ----

const numInput = (path, value, label, extra = '') =>
  `<label class="field"><span>${label}</span>
    <input type="number" inputmode="decimal" step="any" min="0" data-path="${path}" value="${esc(value)}" ${extra}>
  </label>`;

function runFields(prefix, o, paceKey, timeLabel) {
  return `<div class="row">
      ${numInput(`${prefix}.distance`, o.distance, '距離 (km)')}
      ${numInput(`${prefix}.min`, o.min, `${timeLabel} 分`, 'inputmode="numeric"')}
      ${numInput(`${prefix}.sec`, o.sec, '秒', 'inputmode="numeric" max="59"')}
    </div>
    <p class="pace" data-pace="${paceKey}">${livePace(o)}</p>`;
}

function planSection(ex, m) {
  if (ex.kind === 'run') return runFields('plan', m.plan, 'plan', '時間(任意)');
  const amount = ex.loadType === 'timed' ? '秒数' : '回数';
  const weight =
    ex.loadType === 'weighted'
      ? numInput('plan.weight', m.plan.weight, '重量 (kg)')
      : ex.loadType === 'bodyweight'
        ? numInput('plan.weight', m.plan.weight, '加重 (kg・任意)')
        : '';
  return `<div class="row">
      ${weight}
      ${numInput('plan.reps', m.plan.reps, amount, 'inputmode="numeric"')}
      ${numInput('plan.sets', m.plan.sets, 'セット数', 'inputmode="numeric"')}
    </div>`;
}

function actualSection(ex, m) {
  if (ex.kind === 'run') return runFields('actualRun', m.actualRun, 'actual', '時間');
  const amount = ex.loadType === 'timed' ? '秒' : '回';
  const rows = m.actualSets
    .map((s, i) => {
      const weight =
        ex.loadType === 'timed'
          ? ''
          : `<input type="number" inputmode="decimal" step="any" min="0" data-path="actualSets.${i}.weight"
               value="${esc(s.weight)}" aria-label="${i + 1}セット目の重量"><span class="unit">kg</span>`;
      return `<div class="set-row">
          <span class="set-no">${i + 1}</span>
          ${weight}
          <input type="number" inputmode="numeric" step="1" min="0" data-path="actualSets.${i}.reps"
            value="${esc(s.reps)}" aria-label="${i + 1}セット目の${amount}数"><span class="unit">${amount}</span>
          <button type="button" class="icon-btn small" data-action="remove-set" data-index="${i}" aria-label="${i + 1}セット目を削除">×</button>
        </div>`;
    })
    .join('');
  return `${rows}
    <div class="row-actions">
      <button type="button" class="btn-ghost" data-action="add-set">＋ セットを追加</button>
      <button type="button" class="btn-ghost" data-action="copy-plan">予定どおりに戻す</button>
    </div>`;
}

// きつさ(RPE)。自動メニュー作成で、次の重さを決める参考にする。
const RPE_LABELS = { 10: '10 限界(もう1回もできない)', 9: '9 あと1回できた', 8: '8 あと2回できた', 7: '7 あと3回できた', 6: '6 まだ余裕があった', 5: '5 かなり余裕', 4: '4', 3: '3', 2: '2', 1: '1 とても軽い' };
const rpeField = (m) => `<label class="field rpe"><span>きつさ(RPE・任意)</span>
    <select data-path="rpe"><option value="">未入力</option>${[10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
      .map((n) => `<option value="${n}" ${String(n) === m.rpe ? 'selected' : ''}>${RPE_LABELS[n]}</option>`)
      .join('')}</select></label>`;

// 開始時刻の選択肢。時刻を入れると、週・日のタイムラインに時間帯で表示される。
function timeChoices(value) {
  const step = getState().settings.timeStepMin;
  const list = timeOptions(step, 0, 1440 - step);
  if (value && !list.includes(value)) list.push(value);
  list.sort();
  return `<option value="">未定</option>${list.map((t) => `<option ${t === value ? 'selected' : ''}>${t}</option>`).join('')}`;
}

function durationChoices(value) {
  const list = [15, 30, 45, 60, 75, 90, 120];
  if (value && !list.includes(Number(value))) list.push(Number(value));
  list.sort((a, b) => a - b);
  return `<option value="">60分</option>${list
    .filter((n) => n !== 60 || value === '60')
    .map((n) => `<option value="${n}" ${String(n) === value ? 'selected' : ''}>${n}分</option>`)
    .join('')}`;
}

function render() {
  const m = session.model;
  const ex = getExercise(m.exerciseId);
  const prev = findPrevious(getState().entries, m.exerciseId, session.date);
  const options = groupByCategory(getState().exercises.filter((x) => (!x.archived && isAvailable(x)) || x.id === m.exerciseId))
    .map(
      (g) => `<optgroup label="${g.label}">${g.items
        .map((x) => `<option value="${x.id}" ${x.id === m.exerciseId ? 'selected' : ''}>${esc(x.name)}</option>`)
        .join('')}</optgroup>`,
    )
    .join('');
  const body = dlg.querySelector('.sheet-body');
  const scroll = body ? body.scrollTop : 0;

  dlg.innerHTML = `<form class="sheet" novalidate>
      <header class="sheet-head">
        <button type="button" class="btn-ghost" data-action="close">閉じる</button>
        <h2>${formatDateJa(session.date)}</h2>
        <button type="submit" class="btn-primary">保存</button>
      </header>
      <div class="sheet-body">
        <div class="row">
          <label class="field"><span>種目</span><select data-path="exerciseId">${options}</select></label>
          <button type="button" class="btn-ghost" data-action="guide">解説</button>
        </div>
        <p class="prev">${
          prev
            ? `<b>前回 ${formatShortDate(prev.date)}</b> ${esc(describeActual(ex, prev.actual))}`
            : '前回の記録はありません'
        }</p>

        <div class="row when">
          <label class="field"><span>日付</span><input type="date" data-path="date" value="${m.date}"></label>
          <label class="field"><span>開始時刻</span><select data-path="time">${timeChoices(m.time)}</select></label>
          <label class="field"><span>所要時間</span><select data-path="duration" ${m.time ? '' : 'disabled'}>${durationChoices(m.duration)}</select></label>
        </div>

        <h3>予定</h3>
        ${planSection(ex, m)}

        <label class="toggle"><input type="checkbox" data-path="done" ${m.done ? 'checked' : ''}><span>実施済みにする</span></label>
        ${m.done ? `<h3>実績</h3>${actualSection(ex, m)}${rpeField(m)}` : ''}

        <label class="field"><span>メモ</span><textarea data-path="memo" rows="2">${esc(m.memo)}</textarea></label>
        <p class="error" role="alert" hidden></p>
        ${session.entryId ? '<button type="button" class="btn-danger wide" data-action="delete">このメニューを削除</button>' : ''}
      </div>
      ${ex.kind === 'strength' ? `<footer class="sheet-foot">${timerHtml()}</footer>` : ''}
    </form>`;
  dlg.querySelector('.sheet-body').scrollTop = scroll;
  refreshTimers();
}

function setPath(path, value) {
  const keys = path.split('.');
  let o = session.model;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys.at(-1)] = value;
}

function refreshPace() {
  const m = session.model;
  const p = dlg.querySelector('[data-pace="plan"]');
  if (p) p.textContent = livePace(m.plan);
  const a = dlg.querySelector('[data-pace="actual"]');
  if (a) a.textContent = livePace(m.actualRun);
}

function close() {
  dlg.close();
  session = null;
}

function setup() {
  dlg = document.getElementById('entry-dialog');

  dlg.addEventListener('input', (ev) => {
    const path = ev.target.dataset.path;
    if (!path || path === 'done' || path === 'exerciseId') return;
    setPath(path, ev.target.value);
    refreshPace();
  });

  dlg.addEventListener('change', (ev) => {
    const m = session.model;
    const path = ev.target.dataset.path;
    if (path === 'exerciseId') {
      m.exerciseId = ev.target.value;
      // 種目が変わると予定・実績の形が変わるので入れ直す
      m.plan = planFromPrevious(m.exerciseId, session.date);
      m.actualSets = [];
      m.actualRun = emptyRun();
      if (m.done) copyPlanToActual(m);
      render();
    } else if (path === 'date' || path === 'time') {
      m[path] = ev.target.value;
      if (path === 'date' && m.date) session.date = m.date; // 「前回の記録」はこの日付より前を探す
      render();
    } else if (path === 'done') {
      m.done = ev.target.checked;
      const ex = getExercise(m.exerciseId);
      const empty = ex.kind === 'run' ? !m.actualRun.distance && !m.actualRun.min && !m.actualRun.sec : !m.actualSets.length;
      if (m.done && empty) copyPlanToActual(m);
      render();
    }
  });

  dlg.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-action]');
    if (!t) return;
    const m = session.model;
    switch (t.dataset.action) {
      case 'close':
        close();
        break;
      case 'guide':
        openGuide(m.exerciseId);
        break;
      case 'add-set': {
        if (m.actualSets.length >= MAX_SETS) break;
        const last = m.actualSets.at(-1) || { weight: m.plan.weight, reps: m.plan.reps };
        m.actualSets.push({ ...last });
        render();
        break;
      }
      case 'remove-set':
        m.actualSets.splice(Number(t.dataset.index), 1);
        render();
        break;
      case 'copy-plan':
        copyPlanToActual(m);
        render();
        break;
      case 'delete': {
        if (!confirm('このメニューを削除しますか？')) break;
        deleteEntry(session.entryId);
        const { onChange } = session;
        close();
        onChange();
        break;
      }
    }
  });

  dlg.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const { entry, error } = buildEntry();
    if (error) {
      const el = dlg.querySelector('.error');
      el.textContent = error;
      el.hidden = false;
      el.scrollIntoView({ block: 'nearest' });
      return;
    }
    const id = upsertEntry(entry);
    if (entry.status === 'done') {
      const { entries, exercises } = getState();
      const types = computePRs(entries, exercises)
        .updates.filter((u) => u.entryId === id)
        .map((u) => PR_LABELS[u.type]);
      if (types.length) toast(`🏆 自己ベスト更新！ ${types.join('・')}`);
    }
    const { onChange } = session;
    close();
    onChange();
  });

  dlg.addEventListener('cancel', () => {
    session = null;
  });
}

export function openEntryForm({ date, entryId = null, exerciseId = null, onChange }) {
  if (!dlg) setup();
  let model;
  if (entryId) {
    model = modelFromEntry(getEntry(entryId));
  } else {
    const first = (exerciseId && getExercise(exerciseId)) ||
      getState().exercises.find((x) => !x.archived && isAvailable(x)) ||
      getState().exercises.find((x) => !x.archived);
    model = {
      exerciseId: first.id,
      done: false,
      plan: planFromPrevious(first.id, date),
      actualSets: [],
      actualRun: emptyRun(),
      memo: '',
      date,
      time: '',
      duration: '',
      rpe: '',
    };
  }
  session = { date, entryId, onChange, model };
  render();
  dlg.showModal();
}
