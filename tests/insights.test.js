import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePRs, streak, weekSummary, runCalories } from '../js/insights.js';
import { isAchieved, suggestStrength, suggestRun, rankParts, buildSuggestions, defaultTargetDate } from '../js/suggest.js';

const EX = [
  { id: 'sq', name: 'スクワット', kind: 'strength', bodyPart: 'legs', loadType: 'weighted', archived: false },
  { id: 'row', name: 'ロウ', kind: 'strength', bodyPart: 'back', loadType: 'weighted', archived: false },
  { id: 'pull', name: '懸垂', kind: 'strength', bodyPart: 'back', loadType: 'bodyweight', archived: false },
  { id: 'push', name: '腕立て', kind: 'strength', bodyPart: 'chest', loadType: 'bodyweight', archived: false },
  { id: 'plank', name: 'プランク', kind: 'strength', bodyPart: 'core', loadType: 'timed', archived: false },
  { id: 'run', name: 'ランニング', kind: 'run', bodyPart: null, loadType: null, archived: false },
];
const ex = (id) => EX.find((x) => x.id === id);
let seq = 0;
const lift = (date, exerciseId, plan, reps, weight = plan[0]) => ({
  id: `e${seq++}`,
  date,
  exerciseId,
  status: 'done',
  plan: { weightKg: plan[0], reps: plan[1], sets: plan[2] },
  actual: { sets: reps.map((r) => ({ weightKg: weight, reps: r })) },
});
const run = (date, distanceKm, durationSec, status = 'done') => ({
  id: `e${seq++}`,
  date,
  exerciseId: 'run',
  status,
  plan: { distanceKm, durationSec: null },
  actual: status === 'done' ? { distanceKm, durationSec } : null,
});
const planned = (date, exerciseId) => ({ id: `e${seq++}`, date, exerciseId, status: 'planned', plan: { weightKg: 20, reps: 10, sets: 3 }, actual: null });

test('isAchieved', () => {
  assert.equal(isAchieved(lift('2026-11-01', 'sq', [20, 10, 3], [10, 10, 10])), true);
  assert.equal(isAchieved(lift('2026-11-01', 'sq', [20, 10, 3], [10, 10, 9])), false);
  assert.equal(isAchieved(lift('2026-11-01', 'sq', [20, 10, 3], [10, 10])), false); // セット不足
  assert.equal(isAchieved(lift('2026-11-01', 'sq', [20, 10, 3], [10, 10, 10], 17.5)), false); // 重量を下げた
  assert.equal(isAchieved(lift('2026-11-01', 'sq', [20, 10, 3], [12, 11, 10, 8])), false); // 追加セットが未達
});

test('suggestStrength: 達成なら種目に応じて上げる', () => {
  const entries = [
    lift('2026-11-01', 'sq', [20, 10, 3], [10, 10, 10]),
    lift('2026-11-01', 'pull', [0, 6, 3], [6, 6, 7]),
    lift('2026-11-01', 'plank', [0, 60, 3], [60, 60, 60]),
  ];
  const s = suggestStrength(ex('sq'), entries, '2026-11-05');
  assert.deepEqual(s.plan, { weightKg: 22.5, reps: 10, sets: 3 });
  assert.equal(s.tone, 'up');
  assert.match(s.reason, /前回 11\/1に 20kg × 10回 × 3セット を達成 → \+2\.5kg/);
  assert.deepEqual(suggestStrength(ex('pull'), entries, '2026-11-05').plan, { weightKg: 0, reps: 7, sets: 3 });
  assert.deepEqual(suggestStrength(ex('plank'), entries, '2026-11-05').plan, { weightKg: 0, reps: 65, sets: 3 });
  assert.equal(suggestStrength(ex('row'), entries, '2026-11-05').plan, null);
  // 提案日より後の記録は見ない
  assert.equal(suggestStrength(ex('sq'), entries, '2026-11-01').plan, null);
});

test('suggestStrength: 未達は同じ内容、2回連続は据え置き', () => {
  const once = [lift('2026-11-01', 'sq', [20, 10, 3], [10, 10, 10]), lift('2026-11-03', 'sq', [22.5, 10, 3], [10, 9, 8])];
  const a = suggestStrength(ex('sq'), once, '2026-11-05');
  assert.equal(a.tone, 'retry');
  assert.deepEqual(a.plan, { weightKg: 22.5, reps: 10, sets: 3 });
  const twice = [...once, lift('2026-11-05', 'sq', [22.5, 10, 3], [10, 10, 9])];
  const b = suggestStrength(ex('sq'), twice, '2026-11-07');
  assert.equal(b.tone, 'hold');
  assert.deepEqual(b.plan, { weightKg: 22.5, reps: 10, sets: 3 });
  assert.match(b.reason, /2回続けて未達/);
});

test('rankParts: 前日の部位を外し、空いている順に並べる', () => {
  const entries = [
    lift('2026-11-01', 'sq', [20, 10, 3], [10, 10, 10]),
    lift('2026-11-03', 'push', [0, 10, 3], [10, 10, 10]),
    lift('2026-11-04', 'row', [20, 10, 3], [10, 10, 10]),
  ];
  // 11/5 向け: 前日(11/4)の背中を外す。体幹は未実施なので最優先、次に脚
  const r = rankParts(entries, EX, '2026-11-05');
  assert.deepEqual(r.ranked, ['core', 'legs', 'chest']);
  assert.deepEqual(r.skipped, ['back']);
  // 前日の「予定」も外す対象
  const r2 = rankParts([...entries, planned('2026-11-06', 'sq')], EX, '2026-11-07');
  assert.deepEqual(r2.skipped, ['legs']);
});

test('suggestRun: 週の伸びを +10% 以内に', () => {
  // 先週(11/2〜11/8) 10km → 今週は 11km まで
  const base = [run('2026-11-03', 4, 1440), run('2026-11-06', 6, 2160)];
  const ids = new Set(['run']);
  const a = suggestRun(ex('run'), base, ids, '2026-11-10');
  assert.deepEqual(a.plan, { distanceKm: 6.6, durationSec: null }); // 前回 6km の +10%
  // 今週すでに 5km 走り、3km 予定あり → 残り 3km
  const more = [...base, run('2026-11-09', 5, 1800), run('2026-11-12', 3, null, 'planned')];
  const b = suggestRun(ex('run'), more, ids, '2026-11-11');
  assert.deepEqual(b.plan, { distanceKm: 3, durationSec: null });
  // 残り枠が 1km 未満なら提案しない
  const full = [...more, run('2026-11-10', 2.5, 900)];
  const c = suggestRun(ex('run'), full, ids, '2026-11-11');
  assert.equal(c.plan, null);
  assert.equal(c.tone, 'limit');
  // 先週走っていなければ前回と同じ距離
  const d = suggestRun(ex('run'), base, ids, '2026-11-20');
  assert.deepEqual(d.plan, { distanceKm: 6, durationSec: null });
  assert.equal(suggestRun(ex('run'), [], ids, '2026-11-20').plan, null);
});

test('buildSuggestions: 上位2部位＋ラン、提案日に入っている種目は除く', () => {
  const entries = [
    lift('2026-11-01', 'sq', [20, 10, 3], [10, 10, 10]),
    lift('2026-11-02', 'row', [20, 10, 3], [10, 10, 10]),
    lift('2026-11-02', 'pull', [0, 6, 3], [6, 6, 6]),
    lift('2026-11-03', 'push', [0, 10, 3], [10, 10, 10]),
    lift('2026-11-03', 'plank', [0, 60, 3], [60, 60, 60]),
    run('2026-11-03', 5, 1800),
  ];
  const state = { entries, exercises: EX, settings: { weightStepKg: 2.5 } };
  const s = buildSuggestions(state, '2026-11-05');
  assert.deepEqual(s.items.map((i) => i.exercise.id), ['sq', 'row', 'pull', 'run']);
  const s2 = buildSuggestions({ ...state, entries: [...entries, planned('2026-11-05', 'row'), run('2026-11-05', 3, null, 'planned')] }, '2026-11-05');
  assert.deepEqual(s2.items.map((i) => i.exercise.id), ['sq', 'pull']);
});

test('defaultTargetDate', () => {
  const e = [lift('2026-11-05', 'sq', [20, 10, 3], [10, 10, 10]), planned('2026-11-06', 'sq')];
  assert.equal(defaultTargetDate(e, '2026-11-05'), '2026-11-06');
  assert.equal(defaultTargetDate(e, '2026-11-06'), '2026-11-06');
});

test('computePRs: 初回は更新に数えず、塗り替えたときだけ', () => {
  const a = lift('2026-11-01', 'sq', [20, 10, 3], [10, 10, 10]);
  const b = lift('2026-11-03', 'sq', [22.5, 10, 3], [8, 8, 8]); // 最大重量のみ更新(1RM は 26.67 → 28.5 で更新)
  const c = lift('2026-11-05', 'sq', [20, 10, 3], [10, 10, 10]); // 更新なし
  const r1 = run('2026-11-02', 5, 1800);
  const r2 = run('2026-11-04', 4, 1320); // ペースのみ更新
  const r3 = run('2026-11-06', 0.5, 120); // 短すぎるのでペース対象外
  const { bests, updates } = computePRs([c, r3, b, r2, a, r1], EX);
  assert.deepEqual(updates.map((u) => [u.entryId, u.type]), [
    [b.id, 'topWeight'],
    [b.id, 'est1RM'],
    [r2.id, 'pace'],
  ]);
  assert.equal(updates[0].previous, 20);
  const best = (id, type) => bests.find((x) => x.exerciseId === id && x.type === type);
  assert.equal(best('sq', 'topWeight').value, 22.5);
  assert.equal(best('run', 'distance').value, 5);
  assert.equal(best('run', 'pace').value, 330);
  assert.equal(best('run', 'pace').date, '2026-11-04');
});

test('streak: 休養日では途切れず、予定を飛ばした日で途切れる', () => {
  const e = [
    lift('2026-11-01', 'sq', [20, 10, 3], [10, 10, 10]),
    planned('2026-11-03', 'row'), // 実施しなかった
    lift('2026-11-05', 'sq', [20, 10, 3], [10, 10, 10]),
    lift('2026-11-09', 'row', [20, 10, 3], [10, 10, 10]), // 間の休養日は問題なし
    planned('2026-11-10', 'sq'), // 今日の予定はまだ
    planned('2026-11-12', 'sq'), // 未来
  ];
  assert.equal(streak(e, '2026-11-10'), 2);
  assert.equal(streak(e, '2026-11-11'), 0); // 11/10 を飛ばした
  assert.equal(streak(e, '2026-11-02'), 1);
  assert.equal(streak([], '2026-11-02'), 0);
});

test('weekSummary と runCalories', () => {
  const logs = [{ date: '2026-11-08', weightKg: 60 }];
  const e = [
    lift('2026-11-08', 'sq', [20, 10, 3], [10, 10, 10]), // 先週(日曜)
    lift('2026-11-09', 'sq', [20, 10, 3], [10, 10, 10]),
    run('2026-11-09', 5, 1800),
    run('2026-11-12', 3, 1080),
    planned('2026-11-13', 'row'),
    run('2026-11-16', 9, 3000), // 来週
  ];
  const s = weekSummary(e, EX, logs, '2026-11-11');
  assert.equal(s.from, '2026-11-09');
  assert.equal(s.days, 2);
  assert.equal(s.distanceKm, 8);
  assert.equal(s.volumeKg, 600);
  assert.equal(s.kcal, 480);
  assert.equal(weekSummary(e, EX, [], '2026-11-11').kcal, null);
  assert.equal(runCalories([{ date: '2026-12-01', weightKg: 70 }], '2026-11-09', 5), 350); // 以前の記録がなければ最初の体重
});

test('buildSuggestions: 種目が多くても、部位ごとに最近やった3種目まで。未経験の部位は1種目だけ', () => {
  const many = [
    ...['a', 'b', 'c', 'd', 'e'].map((k) => ({ id: `chest_${k}`, name: k, kind: 'strength', bodyPart: 'chest', loadType: 'bodyweight', archived: false })),
    ...['a', 'b', 'c'].map((k) => ({ id: `legs_${k}`, name: k, kind: 'strength', bodyPart: 'legs', loadType: 'bodyweight', archived: false })),
  ];
  const entries = [
    lift('2026-11-01', 'chest_a', [0, 10, 3], [10, 10, 10]),
    lift('2026-11-03', 'chest_c', [0, 10, 3], [10, 10, 10]),
    lift('2026-11-02', 'chest_d', [0, 10, 3], [10, 10, 10]),
    lift('2026-10-20', 'chest_e', [0, 10, 3], [10, 10, 10]),
  ];
  const s = buildSuggestions({ entries, exercises: many, settings: {} }, '2026-11-10');
  // 脚は未経験なので最優先で1種目、胸は最近の順に3種目
  assert.deepEqual(s.items.map((i) => i.exercise.id), ['legs_a', 'chest_c', 'chest_d', 'chest_a']);
  assert.equal(s.items[0].plan, null);
});
