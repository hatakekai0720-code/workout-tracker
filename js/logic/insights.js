// 自己ベスト(PR)・継続日数・今週のまとめ。すべて記録から毎回計算する(保存しない)。
import { weekStart, addDays } from './dates.js';
import { epley1RM, paceSecPerKm, formatPace, weightOn } from './training.js';

export const PR_LABELS = {
  topWeight: '最大重量',
  est1RM: '推定1RM',
  bestReps: '1セット最大回数',
  bestSec: '1セット最長',
  distance: '最長距離',
  pace: '最速ペース',
};

const trim1 = (n) => (Math.round(n * 10) / 10).toString();

export function formatPR(type, value) {
  switch (type) {
    case 'pace':
      return formatPace(value);
    case 'distance':
      return `${trim1(value)}km`;
    case 'bestReps':
      return `${value}回`;
    case 'bestSec':
      return `${value}秒`;
    default:
      return `${trim1(value)}kg`;
  }
}

const MIN_PACE_KM = 1; // これより短いランは最速ペースの対象にしない

// 1件の実施済み記録から、自己ベストの対象になる値を取り出す
function metricsOf(ex, e) {
  if (ex.kind === 'run') {
    const a = e.actual;
    const out = [{ type: 'distance', value: a.distanceKm }];
    const pace = paceSecPerKm(a.distanceKm, a.durationSec);
    if (pace && a.distanceKm >= MIN_PACE_KM) out.push({ type: 'pace', value: pace, lowerIsBetter: true });
    return out;
  }
  const sets = (e.actual.sets || []).filter((s) => s.reps > 0);
  if (!sets.length) return [];
  if (ex.loadType === 'weighted') {
    return [
      { type: 'topWeight', value: Math.max(...sets.map((s) => s.weightKg)) },
      { type: 'est1RM', value: Math.max(...sets.map((s) => epley1RM(s.weightKg, s.reps))) },
    ];
  }
  return [{ type: ex.loadType === 'timed' ? 'bestSec' : 'bestReps', value: Math.max(...sets.map((s) => s.reps)) }];
}

// bests  : 種目×項目ごとの現在の自己ベスト [{ exerciseId, type, value, date, entryId }]
// updates: それまでのベストを塗り替えた記録 [{ ..., previous }](初めての記録は更新に数えない)
export function computePRs(entries, exercises) {
  const exById = new Map(exercises.map((x) => [x.id, x]));
  const done = entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.status === 'done' && e.actual && exById.has(e.exerciseId))
    .sort((a, b) => (a.e.date < b.e.date ? -1 : a.e.date > b.e.date ? 1 : a.i - b.i));
  const best = new Map();
  const updates = [];
  for (const { e } of done) {
    for (const m of metricsOf(exById.get(e.exerciseId), e)) {
      const key = `${e.exerciseId}|${m.type}`;
      const cur = best.get(key);
      const better = !cur || (m.lowerIsBetter ? m.value < cur.value : m.value > cur.value);
      if (!better) continue;
      const rec = { exerciseId: e.exerciseId, type: m.type, value: m.value, date: e.date, entryId: e.id };
      if (cur) updates.push({ ...rec, previous: cur.value });
      best.set(key, rec);
    }
  }
  return { bests: [...best.values()], updates };
}

// 継続日数: メニューを入れた日のうち、実施した日が続いた数。
// メニューのない日(休養日)では途切れない。過去の予定を1つも実施しなかった日で途切れる。
// 「休んだ(体調不良など)」「痛みのため外した」予定は休養日と同じ扱い(数えない)。「スキップ」は実施しなかった予定として数える。
export function streak(entries, today) {
  const doneByDate = new Map();
  for (const e of entries) {
    if (e.date > today || (e.status === 'skipped' && (e.skipReason === 'sick' || e.skipReason === 'pain'))) continue;
    doneByDate.set(e.date, doneByDate.get(e.date) || e.status === 'done');
  }
  let count = 0;
  for (const date of [...doneByDate.keys()].sort().reverse()) {
    if (doneByDate.get(date)) count++;
    else if (date !== today) break; // 今日の予定はまだこれから
  }
  return count;
}

// ランの消費カロリーの概算(体重 × 距離)。体重の記録がなければ null。
export function runCalories(bodyLogs, date, distanceKm) {
  const w = weightOn(bodyLogs, date) ?? bodyLogs[0]?.weightKg ?? null;
  return w ? w * distanceKm : null;
}

// 今日を含む週(月〜日)の実施済み記録のまとめ
export function weekSummary(entries, exercises, bodyLogs, today) {
  const exById = new Map(exercises.map((x) => [x.id, x]));
  const from = weekStart(today);
  const to = addDays(from, 6);
  const days = new Set();
  let distanceKm = 0;
  let volumeKg = 0;
  let kcal = 0;
  let kcalKnown = true;
  for (const e of entries) {
    const ex = exById.get(e.exerciseId);
    if (e.status !== 'done' || !e.actual || !ex || e.date < from || e.date > to) continue;
    days.add(e.date);
    if (ex.kind === 'run') {
      distanceKm += e.actual.distanceKm;
      const c = runCalories(bodyLogs, e.date, e.actual.distanceKm);
      if (c == null) kcalKnown = false;
      else kcal += c;
    } else {
      volumeKg += e.actual.sets.reduce((a, s) => a + s.weightKg * s.reps, 0);
    }
  }
  return { from, to, days: days.size, distanceKm, volumeKg, kcal: distanceKm > 0 && kcalKnown ? kcal : null };
}
