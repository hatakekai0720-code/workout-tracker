// トレーニング中モードの進め方。DOM や保存先には触れない(状態を受け取り、新しい状態を返す)。
//
// 状態 w(途中経過。保存データとは別のキーに置き、終わったら消す):
//   { v: 1, date, startedAt, updatedAt, cursor, rest: { endAt, totalSec } | null, pendingRir: { item, set } | null,
//     items: [{ entryId, exerciseId, swappedFrom, kind, loadType, plan, restSec, sets: [{ weightKg, reps, rir? }],
//               skipped, run: { distanceKm, durationSec } | null, edit: { weightKg, reps } | { distanceKm, durationMin } }] }
//   cursor: いま行っている種目の番号。すべて終われば items.length。
import { findPrevious, describeActual } from './training.js';
import { suggestStrength } from './suggest.js';

export const DEFAULT_REST_SEC = 90;
export const REST_ADD_SEC = 15;
export const TIMED_STEP_SEC = 5;
export const RIR_CHOICES = [0, 1, 2, 3, 4]; // 4 は「4回以上」
export const RESUME_HOURS = 12; // これより前に止まった途中経過は、自動では開かない
const RUN_STEP_KM = 0.1;

const round2 = (n) => Math.round(n * 100) / 100;

// 予定の並び順: 時刻 → 登録順(プログラムは種目の順に登録している)
export function orderEntries(entries) {
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.time || '99') < (b.e.time || '99') ? -1 : (a.e.time || '99') > (b.e.time || '99') ? 1 : a.i - b.i)
    .map(({ e }) => e);
}

// 今日の予定を、開始ボタンを出す単位(プログラムの1回ぶん/時刻ごと/それ以外)にまとめる
export function groupToday(entries, today) {
  const groups = new Map();
  for (const e of orderEntries(entries.filter((x) => x.date === today && x.status === 'planned'))) {
    const key = e.sessionKey || (e.time ? `t${e.time}` : 'other');
    if (!groups.has(key)) groups.set(key, { key, label: e.sessionLabel || null, time: e.time || null, entries: [] });
    groups.get(key).entries.push(e);
  }
  return [...groups.values()];
}

function itemFor(e, ex, defaultRest) {
  const base = { entryId: e.id, exerciseId: ex.id, swappedFrom: null, kind: ex.kind, loadType: ex.loadType, skipped: false, sets: [], run: null };
  if (ex.kind === 'run') {
    const min = e.plan.durationSec ? Math.round(e.plan.durationSec / 60) : Math.max(1, Math.round(e.plan.distanceKm * 7));
    return { ...base, plan: { ...e.plan }, restSec: 0, edit: { distanceKm: e.plan.distanceKm, durationMin: min } };
  }
  return {
    ...base,
    plan: { weightKg: e.plan.weightKg, reps: e.plan.reps, sets: e.plan.sets },
    restSec: e.plan.restSec > 0 ? e.plan.restSec : defaultRest,
    edit: { weightKg: e.plan.weightKg, reps: e.plan.reps },
  };
}

// 開始する。entries は予定(planned)の記録、exById は種目id → 種目。
export function startWorkout(entries, exById, { date, nowMs, restSec = DEFAULT_REST_SEC }) {
  const items = orderEntries(entries)
    .filter((e) => e.status === 'planned' && exById.has(e.exerciseId))
    .map((e) => itemFor(e, exById.get(e.exerciseId), restSec));
  return { v: 1, date, startedAt: nowMs, updatedAt: nowMs, cursor: 0, rest: null, pendingRir: null, items };
}

const clone = (w) => JSON.parse(JSON.stringify(w));

export const currentItem = (w) => w.items[w.cursor] || null;
export const isFinished = (w) => w.cursor >= w.items.length;

// 途中経過として使えるか(形が壊れていないか)
export function isValidWorkout(w) {
  return !!w && w.v === 1 && Array.isArray(w.items) && Number.isInteger(w.cursor) && typeof w.date === 'string';
}

// 次にやる種目へ進める(終わった・スキップした種目は飛ばす)
function advance(w) {
  while (w.cursor < w.items.length) {
    const it = w.items[w.cursor];
    const done = it.skipped || (it.kind === 'run' ? !!it.run : it.sets.length >= it.plan.sets);
    if (!done) return;
    w.cursor++;
  }
}

// 重量・回数(秒)・距離・時間を +/- する。step は weightKg の刻み。
export function adjust(w, field, dir, { weightStepKg = 2.5 } = {}) {
  const n = clone(w);
  const it = currentItem(n);
  if (!it) return n;
  const e = it.edit;
  if (field === 'weightKg') e.weightKg = Math.max(0, round2(e.weightKg + dir * weightStepKg));
  else if (field === 'reps') e.reps = Math.max(it.loadType === 'timed' ? TIMED_STEP_SEC : 1, e.reps + dir * (it.loadType === 'timed' ? TIMED_STEP_SEC : 1));
  else if (field === 'distanceKm') e.distanceKm = Math.max(RUN_STEP_KM, round2(e.distanceKm + dir * RUN_STEP_KM));
  else if (field === 'durationMin') e.durationMin = Math.max(1, e.durationMin + dir);
  return n;
}

// 1セット完了。筋トレは RIR の入力待ちにして、休憩を始める(最後の種目の最後のセットでは休憩しない)。
export function completeSet(w, nowMs) {
  const n = clone(w);
  const it = currentItem(n);
  if (!it || n.pendingRir) return n;
  n.updatedAt = nowMs;
  if (it.kind === 'run') {
    it.run = { distanceKm: it.edit.distanceKm, durationSec: it.edit.durationMin * 60 };
    n.rest = null;
    advance(n);
    return n;
  }
  it.sets.push({ weightKg: it.edit.weightKg, reps: it.edit.reps });
  n.pendingRir = { item: n.cursor, set: it.sets.length - 1 };
  advance(n);
  n.rest = isFinished(n) ? null : { endAt: nowMs + it.restSec * 1000, totalSec: it.restSec };
  return n;
}

// RIR(あと何回できたか)。null はスキップ。
export function setRir(w, rir) {
  const n = clone(w);
  const p = n.pendingRir;
  if (!p) return n;
  if (rir !== null && RIR_CHOICES.includes(rir)) n.items[p.item].sets[p.set].rir = rir;
  n.pendingRir = null;
  return n;
}

export function addRest(w, sec = REST_ADD_SEC) {
  if (!w.rest) return w;
  const n = clone(w);
  n.rest.endAt += sec * 1000;
  n.rest.totalSec += sec;
  return n;
}

export function endRest(w) {
  if (!w.rest) return w;
  return { ...clone(w), rest: null };
}

export const restLeftSec = (w, nowMs) => (w.rest ? Math.max(0, Math.ceil((w.rest.endAt - nowMs) / 1000)) : 0);

// 今の種目を飛ばす(途中までやったセットは記録に残す)
export function skipItem(w, nowMs) {
  const n = clone(w);
  const it = currentItem(n);
  if (!it) return n;
  it.skipped = true;
  n.rest = null;
  n.pendingRir = null;
  n.updatedAt = nowMs;
  advance(n);
  return n;
}

// スキップした種目に戻る(終了前のまとめから)
export function reopenItem(w, index) {
  const n = clone(w);
  const it = n.items[index];
  if (!it) return n;
  it.skipped = false;
  n.cursor = Math.min(n.cursor, index);
  advance(n);
  return n;
}

// 入れ替えの候補: 同じ部位の筋トレ種目で、持っている器具でできるもの。
// メインで効く筋肉が重なる種目を先に並べる。
export function swapCandidates(exercises, current, { musclesOf, isAvailable = () => true, exclude = [] }) {
  if (!current || current.kind !== 'strength') return [];
  const mine = new Set(musclesOf(current).main);
  const skip = new Set([current.id, ...exclude]);
  return exercises
    .map((ex, i) => ({ ex, i }))
    .filter(({ ex }) => ex.kind === 'strength' && !ex.archived && ex.bodyPart === current.bodyPart && !skip.has(ex.id) && isAvailable(ex))
    .map(({ ex, i }) => ({ ex, i, overlap: musclesOf(ex).main.filter((k) => mine.has(k)).length }))
    .sort((a, b) => b.overlap - a.overlap || a.i - b.i)
    .map(({ ex }) => ex);
}

// 今の種目を別の種目に入れ替える。重さ・回数は、その種目の前回の記録から提案する(なければ回数とセット数を引き継ぐ)。
export function swapItem(w, newEx, entries, { weightStepKg = 2.5 } = {}) {
  const n = clone(w);
  const it = currentItem(n);
  if (!it || it.kind !== 'strength' || newEx.kind !== 'strength') return n;
  const s = suggestStrength(newEx, entries, n.date, weightStepKg);
  const remaining = Math.max(1, it.plan.sets - it.sets.length);
  // すでに終えたセットがあれば、その分は元の種目として残す
  const base = s.plan || { weightKg: 0, reps: newEx.loadType === 'timed' ? 30 : it.plan.reps, sets: remaining };
  const plan = { ...base, sets: it.sets.length ? remaining : base.sets };
  const next = {
    ...it,
    exerciseId: newEx.id,
    swappedFrom: (it.swappedFrom || it.exerciseId) === newEx.id ? null : it.swappedFrom || it.exerciseId,
    loadType: newEx.loadType,
    plan,
    sets: [],
    skipped: false,
    edit: { weightKg: plan.weightKg, reps: plan.reps },
  };
  if (it.sets.length) {
    // 途中で入れ替えた: 元の種目は終えたセットまでで完了にし、新しい種目を次に足す(記録は新しく作る)
    it.plan = { ...it.plan, sets: it.sets.length };
    n.items.splice(n.cursor + 1, 0, { ...next, entryId: null, originEntryId: it.entryId, swappedFrom: it.exerciseId });
    n.cursor++;
  } else {
    n.items[n.cursor] = next;
  }
  n.rest = null;
  return n;
}

// 前回の記録の表示用
export function previousText(entries, ex, date) {
  const prev = findPrevious(entries, ex.id, date);
  return prev?.actual ? { date: prev.date, text: describeActual(ex, prev.actual) } : null;
}

// 終了。保存する内容とまとめを返す。
// saves: [{ entryId | null, originEntryId, exerciseId, patch }] — entryId が null のものは、originEntryId の予定を写して新しい記録として足す
// 1セットもしていない種目は、予定のまま残す(入れ替えだけしてやらなかった場合も元の種目に戻す)。
export function finishWorkout(w, nowMs) {
  const doneAt = new Date(nowMs).toISOString();
  const saves = [];
  let volumeKg = 0;
  let setsDone = 0;
  let distanceKm = 0;
  for (const it of w.items) {
    if (it.kind === 'run') {
      if (!it.run) continue;
      distanceKm += it.run.distanceKm;
      saves.push({ entryId: it.entryId, exerciseId: it.exerciseId, patch: { status: 'done', actual: { ...it.run }, doneAt } });
      continue;
    }
    if (!it.sets.length) continue;
    setsDone += it.sets.length;
    volumeKg += it.sets.reduce((a, s) => a + s.weightKg * s.reps, 0);
    const patch = { status: 'done', exerciseId: it.exerciseId, actual: { sets: it.sets.map((s) => ({ ...s })) }, doneAt };
    if (it.swappedFrom) Object.assign(patch, { swappedFrom: it.swappedFrom, plan: { weightKg: it.plan.weightKg, reps: it.plan.reps, sets: it.plan.sets } });
    saves.push({ entryId: it.entryId, originEntryId: it.originEntryId || null, exerciseId: it.exerciseId, patch });
  }
  return {
    saves,
    summary: {
      durationSec: Math.max(0, Math.round((nowMs - w.startedAt) / 1000)),
      volumeKg: round2(volumeKg),
      setsDone,
      distanceKm: round2(distanceKm),
      exercisesDone: saves.length,
      skipped: w.items.filter((it) => it.skipped && !(it.sets.length || it.run)).length,
    },
  };
}

// 自己ベストの更新のうち、今回の記録によるもの
export const sessionPRs = (updates, entryIds) => updates.filter((u) => entryIds.has(u.entryId));
