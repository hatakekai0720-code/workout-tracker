import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startWorkout, currentItem, isFinished, adjust, completeSet, setRir, addRest, endRest, restLeftSec, skipItem, reopenItem,
  swapCandidates, swapItem, finishWorkout, groupToday, orderEntries, sessionPRs, isValidWorkout,
} from '../js/logic/workout.js';
import { loadWorkout, saveWorkout, clearWorkout } from '../js/data/workout-session.js';
import { MemoryStorage } from './memory-storage.js';

const EX = [
  { id: 'bench', name: 'ベンチ', kind: 'strength', bodyPart: 'chest', loadType: 'weighted', archived: false },
  { id: 'push', name: '腕立て', kind: 'strength', bodyPart: 'chest', loadType: 'bodyweight', archived: false },
  { id: 'fly', name: 'フライ', kind: 'strength', bodyPart: 'chest', loadType: 'weighted', archived: false },
  { id: 'cable', name: 'ケーブル', kind: 'strength', bodyPart: 'chest', loadType: 'weighted', archived: false },
  { id: 'old', name: '昔の', kind: 'strength', bodyPart: 'chest', loadType: 'weighted', archived: true },
  { id: 'plank', name: 'プランク', kind: 'strength', bodyPart: 'core', loadType: 'timed', archived: false },
  { id: 'run', name: 'ラン', kind: 'run', bodyPart: null, loadType: null, archived: false },
];
const exById = new Map(EX.map((x) => [x.id, x]));
const MUSCLES = { bench: ['chest', 'triceps'], push: ['chest', 'triceps'], fly: ['chest'], cable: ['deltFront'], old: ['chest'], plank: ['abs'], run: [] };
const musclesOf = (ex) => ({ main: MUSCLES[ex.id], sub: [] });
const T0 = new Date(2026, 10, 16, 18, 0).getTime();
const planned = (id, exerciseId, plan, extra = {}) => ({ id, date: '2026-11-16', exerciseId, status: 'planned', plan, actual: null, memo: '', ...extra });
const entries = () => [
  planned('e1', 'bench', { weightKg: 40, reps: 10, sets: 2, restSec: 120 }),
  planned('e2', 'plank', { weightKg: 0, reps: 30, sets: 1 }),
  planned('e3', 'run', { distanceKm: 3, durationSec: null }),
];
const start = () => startWorkout(entries(), exById, { date: '2026-11-16', nowMs: T0, restSec: 90 });

test('開始: 予定の順に種目を並べ、休憩はプログラムの秒数か既定値', () => {
  const w = start();
  assert.equal(w.items.length, 3);
  assert.equal(currentItem(w).exerciseId, 'bench');
  assert.equal(w.items[0].restSec, 120);
  assert.equal(w.items[1].restSec, 90);
  assert.deepEqual(w.items[0].edit, { weightKg: 40, reps: 10 });
  assert.deepEqual(w.items[2].edit, { distanceKm: 3, durationMin: 21 }); // 時間の予定がなければ 1km 7分で見積もる
  assert.ok(isValidWorkout(w));
  assert.equal(isValidWorkout({ v: 2 }), false);
});

test('+/- で重量・回数・秒を調整する(0 や 1 より下にはしない)', () => {
  let w = start();
  w = adjust(w, 'weightKg', 1, { weightStepKg: 2.5 });
  w = adjust(w, 'reps', -1);
  assert.deepEqual(currentItem(w).edit, { weightKg: 42.5, reps: 9 });
  for (let i = 0; i < 30; i++) w = adjust(w, 'weightKg', -1);
  assert.equal(currentItem(w).edit.weightKg, 0);
  for (let i = 0; i < 30; i++) w = adjust(w, 'reps', -1);
  assert.equal(currentItem(w).edit.reps, 1);
});

test('完了 → RIR の入力待ちと休憩が同時に始まり、セットがそろうと次の種目へ', () => {
  let w = start();
  w = completeSet(w, T0 + 1000);
  assert.deepEqual(w.pendingRir, { item: 0, set: 0 });
  assert.equal(restLeftSec(w, T0 + 1000), 120);
  assert.equal(restLeftSec(w, T0 + 31000), 90);
  w = completeSet(w, T0 + 2000); // RIR を答えるまでは次のセットにしない
  assert.equal(w.items[0].sets.length, 1);
  w = setRir(w, 2);
  assert.equal(w.items[0].sets[0].rir, 2);
  w = addRest(w);
  assert.equal(w.rest.totalSec, 135);
  w = endRest(w);
  assert.equal(w.rest, null);
  w = completeSet(adjust(w, 'reps', -2), T0 + 200000);
  w = setRir(w, null); // スキップ
  assert.deepEqual(w.items[0].sets, [{ weightKg: 40, reps: 10, rir: 2 }, { weightKg: 40, reps: 8 }]);
  assert.equal(currentItem(w).exerciseId, 'plank');
  assert.equal(w.rest.totalSec, 120); // 休憩は終えた種目の秒数
});

test('秒の種目は 5 秒刻み。ランは距離と時間を入れて完了(RIR・休憩なし)。最後は休憩しない', () => {
  let w = start();
  w = skipItem(w, T0);
  w = adjust(w, 'reps', 1);
  assert.equal(currentItem(w).edit.reps, 35);
  w = setRir(completeSet(w, T0), 4);
  w = adjust(adjust(w, 'distanceKm', 1), 'durationMin', -1);
  w = completeSet(w, T0 + 60000);
  assert.equal(w.pendingRir, null);
  assert.deepEqual(w.items[2].run, { distanceKm: 3.1, durationSec: 20 * 60 });
  assert.ok(isFinished(w));
  assert.equal(w.rest, null);
});

test('スキップした種目に戻れる', () => {
  let w = start();
  w = skipItem(w, T0);
  w = skipItem(w, T0);
  w = skipItem(w, T0);
  assert.ok(isFinished(w));
  w = reopenItem(w, 1);
  assert.equal(currentItem(w).exerciseId, 'plank');
  assert.equal(w.items[1].skipped, false);
});

test('入れ替えの候補: 同じ部位・使える器具・非表示でない。効く筋肉が近い順', () => {
  const list = swapCandidates(EX, exById.get('bench'), { musclesOf, isAvailable: (x) => x.id !== 'fly' });
  assert.deepEqual(list.map((x) => x.id), ['push', 'cable']);
  const all = swapCandidates(EX, exById.get('bench'), { musclesOf, exclude: ['push'] });
  assert.deepEqual(all.map((x) => x.id), ['fly', 'cable']);
  assert.deepEqual(swapCandidates(EX, exById.get('run'), { musclesOf }), []);
});

test('入れ替え: 前回の記録から提案。記録がなければ回数とセット数を引き継ぐ', () => {
  const history = [
    { id: 'h1', date: '2026-11-10', exerciseId: 'fly', status: 'done', plan: { weightKg: 10, reps: 12, sets: 3 }, actual: { sets: [12, 12, 12].map((r) => ({ weightKg: 10, reps: r })) } },
  ];
  let w = swapItem(start(), exById.get('fly'), history);
  let it = currentItem(w);
  assert.equal(it.exerciseId, 'fly');
  assert.equal(it.swappedFrom, 'bench');
  assert.deepEqual(it.plan, { weightKg: 12.5, reps: 12, sets: 3 }); // 達成していたので +2.5kg
  w = swapItem(w, exById.get('cable'), history);
  it = currentItem(w);
  assert.equal(it.swappedFrom, 'bench'); // 最初の種目を覚えておく
  assert.deepEqual(it.plan, { weightKg: 0, reps: 12, sets: 3 }); // 記録がなければ、今の種目の回数・セット数のまま
  w = swapItem(w, exById.get('bench'), history);
  assert.equal(currentItem(w).swappedFrom, null); // 元に戻した
});

test('途中で入れ替えたときは、終えたセットを元の種目に残して新しい種目を足す', () => {
  let w = setRir(completeSet(start(), T0), 1);
  w = swapItem(w, exById.get('push'), []);
  assert.equal(w.items.length, 4);
  assert.equal(w.items[0].plan.sets, 1);
  const it = currentItem(w);
  assert.equal(w.cursor, 1);
  assert.equal(it.exerciseId, 'push');
  assert.equal(it.entryId, null);
  assert.equal(it.originEntryId, 'e1');
  assert.equal(it.plan.sets, 1);
  w = setRir(completeSet(w, T0), null);
  const { saves } = finishWorkout(w, T0 + 600000);
  assert.deepEqual(saves.map((s) => [s.entryId, s.exerciseId]), [['e1', 'bench'], [null, 'push']]);
  assert.equal(saves[1].originEntryId, 'e1');
  assert.equal(saves[1].patch.swappedFrom, 'bench');
});

test('終了: 1セットもしなかった種目は保存しない。時間・総挙上量を出す', () => {
  let w = start();
  w = setRir(completeSet(w, T0), 1);
  w = endRest(w);
  w = setRir(completeSet(adjust(w, 'weightKg', 1), T0), 1);
  const { saves, summary } = finishWorkout(w, T0 + 25 * 60000);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].entryId, 'e1');
  assert.equal(saves[0].patch.status, 'done');
  assert.deepEqual(saves[0].patch.actual.sets.map((s) => s.weightKg), [40, 42.5]);
  assert.equal(saves[0].patch.doneAt, new Date(T0 + 25 * 60000).toISOString());
  assert.equal('swappedFrom' in saves[0].patch, false);
  assert.deepEqual(summary, { durationSec: 1500, volumeKg: 825, setsDone: 2, distanceKm: 0, exercisesDone: 1, skipped: 0 });
});

test('自己ベストの更新のうち、今回の記録だけを取り出す', () => {
  const updates = [{ entryId: 'a' }, { entryId: 'b' }];
  assert.deepEqual(sessionPRs(updates, new Set(['b'])), [{ entryId: 'b' }]);
});

test('今日の予定をまとめる: プログラムの回ごと・時刻ごと', () => {
  const list = [
    planned('x1', 'bench', {}, { sessionKey: 'p:0:s1', sessionLabel: '全身A', time: '18:00' }),
    planned('x2', 'fly', {}, { sessionKey: 'p:0:s1', sessionLabel: '全身A', time: '18:00' }),
    planned('x3', 'run', {}, { time: '07:00' }),
    planned('x4', 'push', {}),
    { ...planned('x5', 'push', {}), status: 'done' },
    { ...planned('x6', 'push', {}), date: '2026-11-17' },
  ];
  const g = groupToday(list, '2026-11-16');
  assert.deepEqual(g.map((x) => [x.key, x.entries.map((e) => e.id)]), [['t07:00', ['x3']], ['p:0:s1', ['x1', 'x2']], ['other', ['x4']]]);
  assert.equal(g[1].label, '全身A');
  assert.deepEqual(orderEntries([list[3], list[0], list[2]]).map((e) => e.id), ['x3', 'x1', 'x4']);
});

test('途中経過の保存・読み込み。壊れたものは読まない', () => {
  const st = new MemoryStorage();
  assert.equal(loadWorkout(st), null);
  const w = start();
  saveWorkout(w, st);
  assert.deepEqual(loadWorkout(st), w);
  st.setItem('workoutTracker.workout', '{broken');
  assert.equal(loadWorkout(st), null);
  clearWorkout(st);
  assert.equal(st.getItem('workoutTracker.workout'), null);
});
