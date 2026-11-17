import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decide, involvement, recoverFactor, needsCheck, scalePlan, planInjuryAdjustments, alternativesFor, historyByPart, withLevel, injuryLabel, activeMarks,
} from '../js/logic/injury.js';
import { streak } from '../js/logic/insights.js';
import { readFileSync } from 'node:fs';

const TODAY = '2026-11-17';
const EX = [
  { id: 'bench', name: 'ベンチ', kind: 'strength', bodyPart: 'chest', loadType: 'weighted', archived: false },
  { id: 'fly', name: 'フライ', kind: 'strength', bodyPart: 'chest', loadType: 'weighted', archived: false },
  { id: 'cable', name: 'ケーブル', kind: 'strength', bodyPart: 'chest', loadType: 'weighted', archived: false },
  { id: 'curl', name: 'カール', kind: 'strength', bodyPart: 'arms', loadType: 'weighted', archived: false },
  { id: 'push', name: '腕立て', kind: 'strength', bodyPart: 'chest', loadType: 'bodyweight', archived: false },
  { id: 'squat', name: 'スクワット', kind: 'strength', bodyPart: 'legs', loadType: 'weighted', archived: false },
  { id: 'run', name: 'ラン', kind: 'run', bodyPart: null, loadType: null, archived: false },
];
const M = {
  bench: [['chest'], ['triceps', 'deltFront']], fly: [['chest'], []], cable: [['chest'], ['deltFront']], curl: [['biceps'], ['forearms']],
  push: [['chest', 'triceps'], ['deltFront']], squat: [['quads', 'glutes'], []], run: [['quads', 'calves'], []],
};
const S = { bench: ['shoulder', 'wrist'], fly: ['shoulder'], cable: [], curl: ['elbow', 'wrist'], push: ['shoulder', 'wrist'], squat: ['knee'], run: ['knee', 'ankle'] };
const exById = new Map(EX.map((x) => [x.id, x]));
const ctx = {
  musclesOf: (ex) => ({ main: M[ex.id][0], sub: M[ex.id][1] }),
  stressOf: (ex) => S[ex.id],
  isAvailable: () => true,
  exercises: EX,
  exById,
  weightStepKg: 2.5,
  suggestPlan: () => null,
};
const inj = (part, level, extra = {}) => ({ id: `i_${part}`, part, side: 'right', startDate: '2026-11-10', healedDate: null, history: [{ date: '2026-11-10', level, memo: '' }], ...extra });
const planned = (id, exerciseId, date = '2026-11-18', plan = { weightKg: 40, reps: 10, sets: 3 }, extra = {}) => ({ id, date, exerciseId, status: 'planned', plan, actual: null, memo: '', ...extra });

test('関わり方: 筋肉はメイン/サブ、関節は負担', () => {
  assert.equal(involvement(exById.get('bench'), 'chest', ctx), 'main');
  assert.equal(involvement(exById.get('bench'), 'triceps', ctx), 'sub');
  assert.equal(involvement(exById.get('bench'), 'wrist', ctx), 'stress');
  assert.equal(involvement(exById.get('squat'), 'wrist', ctx), null);
});

test('強さごとの調整: 軽い=メイン・負担を8割、中くらい=入れ替え(サブは8割)、強い=すべて外す', () => {
  const d = (id, injuries) => decide(exById.get(id), injuries, TODAY, ctx);
  assert.deepEqual([d('bench', [inj('chest', 'mild')]).action, d('bench', [inj('chest', 'mild')]).pct], ['lighten', 0.8]);
  assert.equal(d('bench', [inj('triceps', 'mild')]).action, 'ok'); // サブだけなら軽いときはそのまま
  assert.equal(d('bench', [inj('wrist', 'moderate')]).action, 'replace');
  assert.equal(d('bench', [inj('triceps', 'moderate')]).action, 'lighten');
  assert.equal(d('bench', [inj('triceps', 'severe')]).action, 'remove');
  assert.equal(d('squat', [inj('chest', 'severe')]).action, 'ok');
  // いちばん強い調整を使う
  assert.equal(d('bench', [inj('chest', 'mild'), inj('wrist', 'severe')]).action, 'remove');
  // 開始日より前の予定には効かない
  assert.equal(decide(exById.get('bench'), [inj('chest', 'severe', { startDate: '2026-11-20' })], TODAY, ctx).action, 'ok');
  assert.match(d('bench', [inj('chest', 'mild')]).reasons[0], /右の胸の痛み\(軽い\)/);
});

test('治ったあと14日間は 50% から日ごとに戻す', () => {
  const healed = inj('chest', 'moderate', { healedDate: '2026-11-17' });
  assert.equal(recoverFactor(healed, '2026-11-17'), 0.5);
  assert.equal(recoverFactor(healed, '2026-11-24'), 0.75);
  assert.equal(recoverFactor(healed, '2026-12-01'), null);
  assert.equal(recoverFactor(healed, '2026-11-16'), null);
  const d = decide(exById.get('bench'), [healed], '2026-11-24', ctx);
  assert.deepEqual([d.action, d.pct, d.kind], ['lighten', 0.75, 'recover']);
});

test('「痛みはどう？」は前回の記録から3日ごと', () => {
  const i = inj('chest', 'mild', { history: [{ date: '2026-11-15', level: 'mild', memo: '' }] });
  assert.equal(needsCheck(i, '2026-11-17'), false);
  assert.equal(needsCheck(i, '2026-11-18'), true);
  assert.equal(needsCheck({ ...i, healedDate: '2026-11-16' }, '2026-11-20'), false);
});

test('scalePlan: 重さは刻みで切り下げ。重さがなければ回数・秒数、ランは距離', () => {
  assert.deepEqual(scalePlan(exById.get('bench'), { weightKg: 42.5, reps: 10, sets: 3 }, 0.8), { weightKg: 32.5, reps: 10, sets: 3 });
  assert.deepEqual(scalePlan(exById.get('push'), { weightKg: 0, reps: 12, sets: 3 }, 0.5), { weightKg: 0, reps: 6, sets: 3 });
  assert.deepEqual(scalePlan({ kind: 'strength', loadType: 'timed' }, { weightKg: 0, reps: 60, sets: 3 }, 0.8), { weightKg: 0, reps: 50, sets: 3 });
  assert.deepEqual(scalePlan(exById.get('run'), { distanceKm: 5, durationSec: 1800 }, 0.8), { distanceKm: 4, durationSec: null });
});

test('代わりの種目: 同じ部位で、痛みの調整がかからないもの', () => {
  assert.deepEqual(alternativesFor(exById.get('bench'), EX, [inj('shoulder', 'moderate')], TODAY, ctx).map((x) => x.id), ['cable']);
});

test('予定の調整: 今日以降だけ。軽くする・入れ替える・外す。治れば元に戻る', () => {
  const entries = [
    planned('past', 'bench', '2026-11-16'),
    planned('a', 'bench'),
    planned('b', 'fly', '2026-11-18', { weightKg: 10, reps: 12, sets: 3, restSec: 60 }),
    planned('c', 'squat'),
    planned('r', 'run', '2026-11-19', { distanceKm: 5, durationSec: null }),
  ];
  const apply = (list, changes) => list.map((e) => {
    const c = changes.find((x) => x.id === e.id);
    if (!c) return e;
    const n = { ...e, ...c.set };
    for (const k of c.unset) delete n[k];
    return n;
  });
  // 肩(中くらい): ベンチとフライは肩に負担 → ケーブルに入れ替え(重さは前回の記録がなければ 0)
  let injuries = [inj('shoulder', 'moderate')];
  let changes = planInjuryAdjustments(entries, injuries, TODAY, ctx);
  assert.deepEqual(changes.map((c) => c.id), ['a', 'b']);
  let next = apply(entries, changes);
  assert.deepEqual(next[1], { ...entries[1], exerciseId: 'cable', swappedFrom: 'bench', plan: { weightKg: 0, reps: 10, sets: 3 }, basePlan: { weightKg: 40, reps: 10, sets: 3 }, adjustReason: 'pain' });
  assert.equal(next[2].plan.restSec, 60); // 休憩の秒数は引き継ぐ
  // 何度呼んでも同じ(入れ替え先は変えない)
  assert.deepEqual(planInjuryAdjustments(next, injuries, TODAY, ctx), []);
  // 強くなった: 肩に負担のない種目もサブで肩を使うなら外す。入れ替えていたケーブルも肩(サブ)を使うので外す
  injuries = [withLevel(injuries[0], TODAY, 'severe')];
  next = apply(next, planInjuryAdjustments(next, injuries, TODAY, ctx));
  assert.deepEqual([next[1].exerciseId, next[1].status, next[1].skipReason, next[1].plan.weightKg], ['bench', 'skipped', 'pain', 40]);
  assert.equal('swappedFrom' in next[1] || 'basePlan' in next[1], false);
  // 治った: 回復中は元の種目に戻し、重さを5割から
  injuries = [{ ...injuries[0], healedDate: TODAY }];
  next = apply(next, planInjuryAdjustments(next, injuries, TODAY, ctx));
  assert.deepEqual([next[1].status, next[1].exerciseId, next[1].plan.weightKg, next[1].adjustReason], ['planned', 'bench', 20, 'recover']); // 11/18 は 1日目 → 53% → 20kg
  // 記録を消す: すべて元どおり
  next = apply(next, planInjuryAdjustments(next, [], TODAY, ctx));
  assert.deepEqual(next, entries);
});

test('ラン: ひざの痛みが中くらいなら外す(代わりはない)、軽いなら距離を8割', () => {
  const entries = [planned('r', 'run', '2026-11-19', { distanceKm: 5, durationSec: null })];
  assert.deepEqual(planInjuryAdjustments(entries, [inj('knee', 'moderate')], TODAY, ctx)[0].set, { status: 'skipped', skipReason: 'pain', adjustReason: 'pain' });
  assert.deepEqual(planInjuryAdjustments(entries, [inj('knee', 'mild')], TODAY, ctx)[0].set.plan, { distanceKm: 4, durationSec: null });
});

test('「休み明け」で軽くした予定は、痛みの調整が優先され、元に戻すと最初の予定になる', () => {
  const e = planned('a', 'bench', '2026-11-18', { weightKg: 35, reps: 10, sets: 2 }, { basePlan: { weightKg: 40, reps: 10, sets: 3 }, adjustReason: 'return' });
  assert.deepEqual(planInjuryAdjustments([e], [], TODAY, ctx), []); // 痛みがなければ触らない
  const c = planInjuryAdjustments([e], [inj('chest', 'mild')], TODAY, ctx)[0];
  assert.deepEqual(c.set, { plan: { weightKg: 30, reps: 10, sets: 3 }, adjustReason: 'pain' }); // 40kg の8割 = 32kg → 2.5kg 刻みで切り下げ
});

test('部位ごとの履歴・印・記録の上書き', () => {
  const a = inj('chest', 'mild');
  const b = inj('chest', 'severe', { id: 'i2', startDate: '2026-10-01', healedDate: '2026-10-20', side: 'left' });
  const k = inj('knee', 'mild', { side: 'both' });
  assert.deepEqual(historyByPart([b, a, k]).map((g) => [g.label, g.injuries.map((i) => i.id)]), [['胸', ['i_chest', 'i2']], ['ひざ', ['i_knee']]]);
  assert.deepEqual(activeMarks([a, b]), [{ part: 'chest', side: 'right' }]);
  assert.equal(injuryLabel(k), '両側のひざ');
  assert.equal(injuryLabel({ part: 'lowerBack', side: 'center' }), '腰');
  const w = withLevel(withLevel(a, TODAY, 'moderate', 'x'), TODAY, 'mild', 'y');
  assert.deepEqual(w.history.map((h) => [h.date, h.level, h.memo]), [['2026-11-10', 'mild', ''], [TODAY, 'mild', 'y']]);
});

test('継続日数: 痛みで外した予定は休養日と同じ', () => {
  assert.equal(streak([{ date: '2026-11-15', status: 'done' }, { date: '2026-11-16', status: 'skipped', skipReason: 'pain' }], TODAY), 1);
});

test('カタログの全種目に、負担がかかる関節がある', () => {
  const cat = JSON.parse(readFileSync(new URL('../data/exercises.json', import.meta.url)));
  const joints = new Set(['neck', 'shoulder', 'elbow', 'wrist', 'lowerBack', 'hip', 'knee', 'ankle']);
  for (const [k, v] of Object.entries(cat)) {
    assert.ok(Array.isArray(v.stress) && v.stress.length, k);
    assert.ok(v.stress.every((j) => joints.has(j)), k);
  }
  assert.deepEqual(cat.bench_press.stress.slice(0, 2), ['shoulder', 'wrist']);
});
