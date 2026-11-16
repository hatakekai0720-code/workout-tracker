// 筋肉マップ用の集計。DOM や保存先には触れない。
import { weekStart, addDays } from './dates.js';

const SUB_WEIGHT = 0.5; // サブで効く筋肉は、メインの半分として数える
const RUN_SETS = 3; // ラン1回は 3 セット相当として数える
const HEAT_MAX = 10; // これ以上は一番濃い色
const HEAT_LIGHT = [0xf6, 0xcf, 0xb8];
const HEAT_DARK = [0xb3, 0x26, 0x1e];

// 今日を含む週(月〜日)に実施したセット数を、筋肉ごとに集計する。
// 返り値: { 筋肉: { main, sub, score } }(score = main + sub × 0.5。色の濃さに使う)
export function weeklyMuscleSets(entries, exercises, musclesOf, today) {
  const exById = new Map(exercises.map((x) => [x.id, x]));
  const from = weekStart(today);
  const to = addDays(from, 6);
  const out = {};
  const add = (key, field, n) => {
    out[key] ??= { main: 0, sub: 0, score: 0 };
    out[key][field] += n;
    out[key].score += field === 'main' ? n : n * SUB_WEIGHT;
  };
  for (const e of entries) {
    const ex = exById.get(e.exerciseId);
    if (e.status !== 'done' || !e.actual || !ex || e.date < from || e.date > to) continue;
    const sets = ex.kind === 'run' ? RUN_SETS : e.actual.sets.filter((s) => s.reps > 0).length;
    if (!sets) continue;
    const m = musclesOf(ex);
    for (const k of m.main) add(k, 'main', sets);
    for (const k of m.sub) add(k, 'sub', sets);
  }
  return out;
}

// セット数に応じた色。0 なら null(色を付けない)。1つの色相で、多いほど濃くする。
export function heatColor(score) {
  if (!(score > 0)) return null;
  const t = Math.min(score / HEAT_MAX, 1);
  return `#${HEAT_LIGHT.map((c, i) => Math.round(c + (HEAT_DARK[i] - c) * t).toString(16).padStart(2, '0')).join('')}`;
}

export const HEAT_LEGEND = { from: heatColor(0.01), to: heatColor(HEAT_MAX), max: HEAT_MAX };

// その筋肉に効く種目を、メイン・サブに分けて返す。
// 持っている器具でできる種目を先に並べる(同じ中では種目マスタの順)。非表示の種目は含めない。
export function exercisesForMuscle(exercises, musclesOf, key, isAvailable = () => true) {
  const main = [];
  const sub = [];
  for (const ex of exercises) {
    if (ex.archived) continue;
    const m = musclesOf(ex);
    if (m.main.includes(key)) main.push(ex);
    else if (m.sub.includes(key)) sub.push(ex);
  }
  const order = (list) => [...list.filter((x) => isAvailable(x)), ...list.filter((x) => !isAvailable(x))];
  return { main: order(main), sub: order(sub) };
}

// 解説ページのマネキンを、前と後ろのどちらから見せるか(光る筋肉が多い側)
const BACK_SIDE = new Set(['deltRear', 'triceps', 'traps', 'lats', 'erectors', 'glutes', 'hamstrings', 'calves']);
export function bestView(muscles) {
  const weight = (k) => (BACK_SIDE.has(k) ? 1 : -1);
  const score = muscles.main.reduce((a, k) => a + 2 * weight(k), 0) + muscles.sub.reduce((a, k) => a + weight(k), 0);
  return score > 0 ? 'back' : 'front';
}

// ---- 回復マップ ----

export const RECOVERY = {
  rest: { label: '休ませる(48時間未満)', color: '#d03b3b' },
  soon: { label: 'もう少し(48〜72時間)', color: '#e8a013' },
  ready: { label: '回復済み(72時間以上)', color: '#3f9c35' },
};
const RECENT_DAYS = 7; // これより前に鍛えた筋肉は、色を付けない

// 筋肉ごとに、最後にメインで鍛えてからの時間と状態を返す: { 筋肉: { hours, status } }
// 記録に時刻がなければ、その日の正午に行ったものとして数える。1週間より前の分は含めない。
export function recoveryStatus(entries, exercises, musclesOf, nowMs) {
  const exById = new Map(exercises.map((x) => [x.id, x]));
  const last = {};
  for (const e of entries) {
    const ex = exById.get(e.exerciseId);
    if (e.status !== 'done' || !ex) continue;
    const [y, m, d] = e.date.split('-').map(Number);
    const [hh, mm] = (e.time || '12:00').split(':').map(Number);
    const at = new Date(y, m - 1, d, hh, mm).getTime();
    if (at > nowMs) continue;
    for (const k of musclesOf(ex).main) if (!(last[k] > at)) last[k] = at;
  }
  const out = {};
  for (const [k, at] of Object.entries(last)) {
    const hours = (nowMs - at) / 3600000;
    if (hours > RECENT_DAYS * 24) continue;
    out[k] = { hours, status: hours < 48 ? 'rest' : hours < 72 ? 'soon' : 'ready' };
  }
  return out;
}
