// 次のメニュー提案(ルールベース)。DOM や保存先には触れない。
import { addDays, weekStart, formatShortDate, describePlan, describeActual } from './calc.js';

const TIMED_STEP_SEC = 5;
const RUN_WEEKLY_GROWTH = 1.1;
const MIN_RUN_KM = 1; // 残り枠がこれ未満なら「今週は上限」とする
const MAX_PARTS = 2;
const MAX_PER_PART = 3;

const round1 = (n) => Math.round(n * 10) / 10;
const floor1 = (n) => Math.floor(n * 10 + 1e-9) / 10;

// 予定したセット数を、すべて予定以上の重量・回数でこなせたか
export function isAchieved(e) {
  const sets = e.actual?.sets;
  if (!sets || sets.length < e.plan.sets) return false;
  return sets.every((s) => s.reps >= e.plan.reps && s.weightKg >= e.plan.weightKg);
}

// 種目の実施済み記録を新しい順に
function history(entries, exerciseId, before) {
  return entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.status === 'done' && e.exerciseId === exerciseId && e.actual && e.date < before)
    .sort((a, b) => (a.e.date > b.e.date ? -1 : a.e.date < b.e.date ? 1 : b.i - a.i))
    .map(({ e }) => e);
}

// 筋トレ1種目の提案。記録がなければ plan は null。
export function suggestStrength(ex, entries, targetDate, weightStepKg = 2.5) {
  const [last, prev] = history(entries, ex.id, targetDate);
  if (!last) return { exercise: ex, plan: null, tone: 'new', reason: 'まだ記録がありません。最初の予定を入力してください' };
  const when = `前回 ${formatShortDate(last.date)}`;
  if (isAchieved(last)) {
    const plan = { ...last.plan };
    let change;
    if (ex.loadType === 'weighted') {
      plan.weightKg = round1(plan.weightKg + weightStepKg);
      change = `+${weightStepKg}kg`;
    } else if (ex.loadType === 'timed') {
      plan.reps += TIMED_STEP_SEC;
      change = `+${TIMED_STEP_SEC}秒`;
    } else {
      plan.reps += 1;
      change = '+1回';
    }
    return { exercise: ex, plan, tone: 'up', reason: `${when}に ${describePlan(ex, last.plan)} を達成 → ${change}` };
  }
  const result = describeActual(ex, last.actual);
  if (prev && !isAchieved(prev)) {
    return {
      exercise: ex,
      plan: { ...last.plan },
      tone: 'hold',
      reason: `2回続けて未達(${when}: ${result})。据え置きにして、フォームや休養を見直しましょう`,
    };
  }
  return { exercise: ex, plan: { ...last.plan }, tone: 'retry', reason: `${when}は未達(${result})。同じ内容でもう一度` };
}

// 前日に入っている部位を外し、最後に実施してから日が空いている順に部位を並べる
export function rankParts(entries, exercises, targetDate) {
  const partOf = new Map(exercises.map((x) => [x.id, x.bodyPart]));
  const parts = [...new Set(exercises.filter((x) => x.kind === 'strength' && !x.archived && x.bodyPart).map((x) => x.bodyPart))];
  const dayBefore = addDays(targetDate, -1);
  const skipped = new Set();
  const lastDone = new Map();
  for (const e of entries) {
    const part = partOf.get(e.exerciseId);
    if (!part) continue;
    if (e.date === dayBefore) skipped.add(part);
    if (e.status === 'done' && e.date < targetDate && e.date > (lastDone.get(part) || '')) lastDone.set(part, e.date);
  }
  const ranked = parts
    .filter((p) => !skipped.has(p))
    .map((p, i) => ({ p, i, last: lastDone.get(p) || '' }))
    .sort((a, b) => (a.last < b.last ? -1 : a.last > b.last ? 1 : a.i - b.i))
    .map((x) => x.p);
  return { ranked, skipped: parts.filter((p) => skipped.has(p)) };
}

// ランの提案。週の合計距離が先週の +10% を超えないようにする。
export function suggestRun(ex, entries, runIds, targetDate) {
  const runs = entries.filter((e) => runIds.has(e.exerciseId));
  const done = runs.filter((e) => e.status === 'done' && e.actual && e.date < targetDate);
  if (!done.length) return { exercise: ex, plan: null, tone: 'new', reason: 'まだ記録がありません。最初の予定を入力してください' };
  const last = done.reduce((a, b) => (b.date >= a.date ? b : a));
  const week = weekStart(targetDate);
  const prevWeek = addDays(week, -7);
  const km = (e) => (e.status === 'done' && e.actual ? e.actual.distanceKm : e.plan.distanceKm);
  const sum = (from) => runs.filter((e) => e.date >= from && e.date <= addDays(from, 6)).reduce((a, e) => a + km(e), 0);
  const lastWeekKm = sum(prevWeek);
  if (!(lastWeekKm > 0)) {
    return {
      exercise: ex,
      plan: { distanceKm: last.actual.distanceKm, durationSec: null },
      tone: 'retry',
      reason: `先週は走っていないので、前回(${formatShortDate(last.date)})と同じ距離から`,
    };
  }
  const limit = lastWeekKm * RUN_WEEKLY_GROWTH;
  const thisWeekKm = sum(week); // 予定済みの分も含める
  const room = limit - thisWeekKm;
  const basis = `先週 ${round1(lastWeekKm)}km → 今週は ${floor1(limit)}km まで(予定を含め ${round1(thisWeekKm)}km)`;
  if (room < MIN_RUN_KM) return { exercise: ex, plan: null, tone: 'limit', reason: `${basis}。今週はここまでにしましょう` };
  const distanceKm = floor1(Math.min(last.actual.distanceKm * RUN_WEEKLY_GROWTH, room));
  return { exercise: ex, plan: { distanceKm, durationSec: null }, tone: 'up', reason: basis };
}

// 提案する日: 今日まだ何も実施していなければ今日、していれば明日
export function defaultTargetDate(entries, today) {
  return entries.some((e) => e.date === today && e.status === 'done') ? addDays(today, 1) : today;
}

// targetDate 向けの提案一覧。その日にすでに入っている種目は出さない。
export function buildSuggestions(state, targetDate) {
  const { entries, exercises, settings } = state;
  const onTarget = new Set(entries.filter((e) => e.date === targetDate).map((e) => e.exerciseId));
  const { ranked, skipped } = rankParts(entries, exercises, targetDate);
  const items = [];
  const lastDone = new Map(); // 種目 → 最後に実施した日
  for (const e of entries) {
    if (e.status === 'done' && e.date < targetDate && e.date > (lastDone.get(e.exerciseId) || '')) lastDone.set(e.exerciseId, e.date);
  }
  for (const part of ranked.slice(0, MAX_PARTS)) {
    const candidates = exercises.filter((ex) => ex.kind === 'strength' && !ex.archived && ex.bodyPart === part && !onTarget.has(ex.id));
    // 種目が多いので、最近やった種目を優先して部位ごとに MAX_PER_PART 件まで。
    // その部位でまだ何もやっていなければ、最初の1種目だけを「入力する」として出す。
    const done = candidates
      .filter((ex) => lastDone.has(ex.id))
      .sort((a, b) => (lastDone.get(a.id) > lastDone.get(b.id) ? -1 : lastDone.get(a.id) < lastDone.get(b.id) ? 1 : 0))
      .slice(0, MAX_PER_PART);
    for (const ex of done.length ? done : candidates.slice(0, 1)) {
      items.push(suggestStrength(ex, entries, targetDate, settings?.weightStepKg));
    }
  }
  const runIds = new Set(exercises.filter((x) => x.kind === 'run').map((x) => x.id));
  const run = exercises.find((x) => x.kind === 'run' && !x.archived);
  if (run && !entries.some((e) => e.date === targetDate && runIds.has(e.exerciseId))) {
    items.push(suggestRun(run, entries, runIds, targetDate));
  }
  return { items, skippedParts: skipped };
}
