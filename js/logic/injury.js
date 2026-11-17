// 痛み・ケガの記録と、それに合わせたメニューの調整。DOM や保存先には触れない。
//
// injuries の形: [{ id, part, side, startDate, healedDate: 'YYYY-MM-DD' | null, history: [{ date, level, memo }] }]
//   part : 筋肉(js/logic/muscles.js の16種)か関節(JOINTS)
//   side : 'left' | 'right' | 'both' | 'center'(首・腰・腹筋など左右のない部位)
//   level: 'mild'(軽い) | 'moderate'(中くらい) | 'severe'(強い)。history の最後が今の強さ
//
// 調整のルール(痛みのある部位と種目の関わり: メインで効く/サブで効く/負担がかかる関節):
//   軽い    : メイン・負担 → 重さを8割に
//   中くらい: メイン・負担 → 代わりの種目に入れ替え(なければ外す)、サブ → 重さを8割に
//   強い    : メイン・サブ・負担のどれか → 外す
//   治ったあと14日間: 関わる種目は重さを5割から日ごとに10割へ戻す
import { MUSCLES } from './muscles.js';
import { dayNumber } from './dates.js';
import { swapCandidates } from './workout.js';

export const JOINTS = {
  neck: '首',
  shoulder: '肩関節',
  elbow: 'ひじ',
  wrist: '手首',
  lowerBack: '腰',
  hip: '股関節',
  knee: 'ひざ',
  ankle: '足首',
};
export const SIDES = { left: '左', right: '右', both: '両側', center: '' };
export const LEVELS = { mild: '軽い', moderate: '中くらい', severe: '強い' };
const RANK = { mild: 1, moderate: 2, severe: 3 };
export const CENTER_PARTS = new Set(['neck', 'lowerBack', 'abs']); // 左右を聞かない部位
export const CHECK_DAYS = 3; // この日数ごとに「痛みはどう？」と聞く
export const RECOVER_DAYS = 14; // 治ったあと、重さを戻していく日数
export const MILD_PCT = 0.8;
const RECOVER_FROM = 0.5;

// 筋肉をタップしたときに一緒に選べる、近くの関節
export const NEAR_JOINTS = {
  chest: ['shoulder'],
  deltFront: ['shoulder'],
  deltSide: ['shoulder'],
  deltRear: ['shoulder'],
  biceps: ['elbow', 'shoulder'],
  triceps: ['elbow', 'shoulder'],
  forearms: ['wrist', 'elbow'],
  abs: ['lowerBack'],
  obliques: ['lowerBack'],
  traps: ['neck', 'shoulder'],
  lats: ['shoulder', 'lowerBack'],
  erectors: ['lowerBack'],
  glutes: ['hip', 'lowerBack'],
  quads: ['knee', 'hip'],
  hamstrings: ['knee', 'hip'],
  calves: ['ankle', 'knee'],
};

export const isJoint = (part) => part in JOINTS;
export const partLabel = (part) => JOINTS[part] || MUSCLES[part] || part;
export const injuryLabel = (inj) => `${SIDES[inj.side] || ''}${SIDES[inj.side] ? 'の' : ''}${partLabel(inj.part)}`;
export const currentLevel = (inj) => inj.history.at(-1)?.level || 'mild';
export const isActive = (inj) => !inj.healedDate;
export const lastCheckDate = (inj) => inj.history.at(-1)?.date || inj.startDate;

// 「痛みはどう？」と聞く時期か(前回の記録から CHECK_DAYS 日以上たった、治っていない痛み)
export const needsCheck = (inj, today) => isActive(inj) && dayNumber(today) - dayNumber(lastCheckDate(inj)) >= CHECK_DAYS;

// 治ったあとの戻し方: date の日の重さの割合。回復期間でなければ null。
export function recoverFactor(inj, date) {
  if (!inj.healedDate || date < inj.healedDate) return null;
  const days = dayNumber(date) - dayNumber(inj.healedDate);
  if (days >= RECOVER_DAYS) return null;
  return Math.round((RECOVER_FROM + ((1 - RECOVER_FROM) * days) / RECOVER_DAYS) * 100) / 100;
}

// 種目と部位の関わり: 'main' | 'sub' | 'stress'(負担がかかる関節) | null
export function involvement(ex, part, { musclesOf, stressOf }) {
  if (isJoint(part)) return stressOf(ex).includes(part) ? 'stress' : null;
  const m = musclesOf(ex);
  return m.main.includes(part) ? 'main' : m.sub.includes(part) ? 'sub' : null;
}

const ACTION_RANK = { ok: 0, lighten: 1, replace: 2, remove: 3 };

// date の日に、その種目をどうするか。
// 返り値: { action: 'ok'|'lighten'|'replace'|'remove', pct(lighten の割合), kind: 'pain'|'recover', reasons: [文] }
export function decide(ex, injuries, date, ctx) {
  let out = { action: 'ok', pct: 1, kind: 'pain', reasons: [] };
  const consider = (action, pct, kind, reason) => {
    const better = ACTION_RANK[action] > ACTION_RANK[out.action] || (action === 'lighten' && out.action === 'lighten' && pct < out.pct);
    if (better) out = { ...out, action, pct, kind };
    if (action !== 'ok') out.reasons.push(reason);
  };
  for (const inj of injuries) {
    const inv = involvement(ex, inj.part, ctx);
    if (!inv) continue;
    const label = injuryLabel(inj);
    if (isActive(inj)) {
      if (inj.startDate > date) continue;
      const level = currentLevel(inj);
      const strong = inv === 'main' || inv === 'stress';
      if (level === 'severe') consider('remove', 1, 'pain', `${label}の痛み(強い)`);
      else if (level === 'moderate') {
        if (strong) consider('replace', 1, 'pain', `${label}の痛み(中くらい)`);
        else consider('lighten', MILD_PCT, 'pain', `${label}の痛み(中くらい)`);
      } else if (strong) consider('lighten', MILD_PCT, 'pain', `${label}の痛み(軽い)`);
    } else {
      const f = recoverFactor(inj, date);
      if (f !== null) consider('lighten', f, 'recover', `${label}が治ったあとの回復中(${Math.round(f * 100)}%)`);
    }
  }
  return out;
}

// 割合に合わせて予定を軽くする。重さがあれば重さを(刻みで切り下げ)、なければ回数・秒数を減らす。ランは距離。
export function scalePlan(ex, plan, pct, weightStepKg = 2.5) {
  if (ex.kind === 'run') return { ...plan, distanceKm: Math.max(0.5, Math.round(plan.distanceKm * pct * 10) / 10), durationSec: null };
  if (plan.weightKg > 0) {
    const step = weightStepKg > 0 ? weightStepKg : 2.5;
    return { ...plan, weightKg: Math.round(Math.floor((plan.weightKg * pct) / step + 1e-9) * step * 100) / 100 };
  }
  if (ex.loadType === 'timed') return { ...plan, reps: Math.max(5, Math.round((plan.reps * pct) / 5) * 5) };
  return { ...plan, reps: Math.max(1, Math.round(plan.reps * pct)) };
}

// 代わりの種目: 同じ部位で、使える器具でできて、痛みの調整がかからない種目
export function alternativesFor(ex, exercises, injuries, date, ctx) {
  return swapCandidates(exercises, ex, ctx).filter((x) => decide(x, injuries, date, ctx).action === 'ok');
}

const MANAGED = ['exerciseId', 'status', 'skipReason', 'plan', 'basePlan', 'adjustReason', 'swappedFrom'];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// 今日以降の予定を、痛みの記録に合わせた形にする。何度呼んでも同じ結果になる(痛みが治れば元に戻る)。
// ctx: { musclesOf, stressOf, isAvailable, exById, exercises, suggestPlan(ex, date) → plan | null, weightStepKg }
// 返り値: [{ id, set: { 項目: 値 }, unset: [項目] }]
//
// 「休み明け」「再開プラン」で軽くした予定に痛みの調整がかかったときは、痛みの調整を優先する(元に戻すと最初の予定になる)。
export function planInjuryAdjustments(entries, injuries, today, ctx) {
  const changes = [];
  for (const e of entries) {
    if (e.date < today) continue;
    const managed = e.adjustReason === 'pain' || e.adjustReason === 'recover' || e.skipReason === 'pain';
    if (!(e.status === 'planned' || (e.status === 'skipped' && e.skipReason === 'pain'))) continue;
    const origId = managed && e.swappedFrom ? e.swappedFrom : e.exerciseId;
    const origEx = ctx.exById.get(origId);
    if (!origEx) continue;
    const origPlan = e.basePlan ?? e.plan;
    const d = decide(origEx, injuries, e.date, ctx);
    let target;
    if (d.action === 'ok') {
      if (!managed) continue;
      target = { exerciseId: origId, status: 'planned', plan: origPlan };
    } else if (d.action === 'lighten') {
      target = { exerciseId: origId, status: 'planned', plan: scalePlan(origEx, origPlan, d.pct, ctx.weightStepKg), basePlan: origPlan, adjustReason: d.kind };
    } else {
      let alt = null;
      if (d.action === 'replace' && origEx.kind === 'strength') {
        // すでに入れ替えてあり、その種目が今も問題なければそのまま使う
        const cur = managed && e.swappedFrom ? ctx.exById.get(e.exerciseId) : null;
        alt = cur && decide(cur, injuries, e.date, ctx).action === 'ok' && e.status === 'planned' ? cur : alternativesFor(origEx, ctx.exercises, injuries, e.date, ctx)[0] || null;
      }
      if (alt) {
        const keep = alt.id === e.exerciseId && e.status === 'planned';
        const s = keep ? e.plan : ctx.suggestPlan(alt, e.date) || { weightKg: 0, reps: alt.loadType === 'timed' ? 30 : origPlan.reps, sets: origPlan.sets };
        const plan = origPlan.restSec && !s.restSec ? { ...s, restSec: origPlan.restSec } : s;
        target = { exerciseId: alt.id, status: 'planned', plan, basePlan: origPlan, adjustReason: 'pain', swappedFrom: origId };
      } else {
        target = { exerciseId: origId, status: 'skipped', skipReason: 'pain', plan: origPlan, adjustReason: 'pain' };
      }
    }
    const set = {};
    const unset = [];
    for (const k of MANAGED) {
      if (k in target) {
        if (!same(e[k], target[k])) set[k] = target[k];
      } else if (k in e) unset.push(k);
    }
    if (Object.keys(set).length || unset.length) changes.push({ id: e.id, set, unset });
  }
  return changes;
}

// マネキンに出す印: [{ part, side }](治っていない痛み)
export const activeMarks = (injuries) => injuries.filter(isActive).map((i) => ({ part: i.part, side: i.side }));

// 部位ごとの履歴(新しい痛みが上)
export function historyByPart(injuries) {
  const groups = new Map();
  for (const inj of [...injuries].sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0))) {
    if (!groups.has(inj.part)) groups.set(inj.part, []);
    groups.get(inj.part).push(inj);
  }
  return [...groups.entries()].map(([part, list]) => ({ part, label: partLabel(part), injuries: list }));
}

// 1日1件。同じ日の記録は上書きする。
export function withLevel(inj, date, level, memo = '') {
  const history = inj.history.filter((h) => h.date !== date);
  history.push({ date, level, memo });
  history.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { ...inj, history };
}

export const levelRank = (level) => RANK[level] || 0;
