import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDateStr, monthGrid, formatDateJa } from '../js/logic/dates.js';
import {
  paceSecPerKm,
  formatPace,
  formatDuration,
  findPrevious,
  describePlan,
  describeActual,
} from '../js/logic/training.js';

test('toDateStr はローカル日付をゼロ埋めする', () => {
  assert.equal(toDateStr(new Date(2026, 0, 5)), '2026-01-05');
});

test('formatDateJa', () => {
  assert.equal(formatDateJa('2026-11-16'), '11月16日(月)');
});

test('monthGrid は月曜始まりで前後の月を埋める', () => {
  // 2026年11月1日は日曜 → 最初の週は 10/26(月) から
  const g = monthGrid(2026, 10);
  assert.equal(g.length, 6);
  assert.equal(g[0][0].date, '2026-10-26');
  assert.equal(g[0][0].inMonth, false);
  assert.equal(g[0][6].date, '2026-11-01');
  assert.equal(g[0][6].inMonth, true);
  assert.equal(g[5][0].date, '2026-11-30');
  assert.ok(g.every((w) => w.length === 7));
});

test('monthGrid: 月曜始まりの月は余分な週を作らない', () => {
  // 2027年2月1日は月曜、28日まで → ちょうど4週
  const g = monthGrid(2027, 1);
  assert.equal(g.length, 4);
  assert.equal(g[0][0].date, '2027-02-01');
  assert.equal(g[3][6].date, '2027-02-28');
});

test('ペース計算', () => {
  assert.equal(paceSecPerKm(5, 1800), 360);
  assert.equal(formatPace(360), '6:00/km');
  assert.equal(formatPace(paceSecPerKm(3, 1000)), '5:33/km');
  assert.equal(paceSecPerKm(0, 1800), null);
  assert.equal(paceSecPerKm(5, null), null);
  assert.equal(formatPace(null), '—');
  // 丸めで 60 秒にならない
  assert.equal(formatPace(359.6), '6:00/km');
});

test('formatDuration', () => {
  assert.equal(formatDuration(1800), '30:00');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(3725), '1:02:05');
});

test('findPrevious は指定日より前の最新の実施済みを返す', () => {
  const entries = [
    { id: 'a', date: '2026-11-01', exerciseId: 'x', status: 'done' },
    { id: 'b', date: '2026-11-05', exerciseId: 'x', status: 'done' },
    { id: 'c', date: '2026-11-07', exerciseId: 'x', status: 'planned' },
    { id: 'd', date: '2026-11-08', exerciseId: 'y', status: 'done' },
    { id: 'e', date: '2026-11-10', exerciseId: 'x', status: 'done' },
  ];
  assert.equal(findPrevious(entries, 'x', '2026-11-10').id, 'b');
  assert.equal(findPrevious(entries, 'x', '2026-11-11').id, 'e');
  assert.equal(findPrevious(entries, 'x', '2026-11-01'), null);
  assert.equal(findPrevious(entries, 'z', '2026-11-10'), null);
});

const weighted = { kind: 'strength', loadType: 'weighted' };
const bodyweight = { kind: 'strength', loadType: 'bodyweight' };
const timed = { kind: 'strength', loadType: 'timed' };
const run = { kind: 'run', loadType: null };

test('describePlan', () => {
  assert.equal(describePlan(weighted, { weightKg: 20, reps: 10, sets: 3 }), '20kg × 10回 × 3セット');
  assert.equal(describePlan(bodyweight, { weightKg: 0, reps: 8, sets: 3 }), '8回 × 3セット');
  assert.equal(describePlan(bodyweight, { weightKg: 5, reps: 8, sets: 3 }), '+5kg × 8回 × 3セット');
  assert.equal(describePlan(timed, { weightKg: 0, reps: 60, sets: 3 }), '60秒 × 3セット');
  assert.equal(describePlan(run, { distanceKm: 5, durationSec: null }), '5km');
  assert.equal(describePlan(run, { distanceKm: 5, durationSec: 1800 }), '5km ・ 30:00 ・ 6:00/km');
});

test('describeActual', () => {
  const s = (weightKg, reps) => ({ weightKg, reps });
  assert.equal(describeActual(weighted, { sets: [s(20, 10), s(20, 10), s(20, 10)] }), '20kg × 10回 × 3セット');
  assert.equal(describeActual(weighted, { sets: [s(20, 10), s(20, 10), s(20, 8)] }), '20kg × 10・10・8回');
  assert.equal(describeActual(weighted, { sets: [s(20, 10), s(22.5, 8)] }), '20kg×10 / 22.5kg×8');
  assert.equal(describeActual(bodyweight, { sets: [s(0, 8), s(5, 6)] }), '自重×8 / +5kg×6');
  assert.equal(describeActual(timed, { sets: [s(0, 60), s(0, 45)] }), '60・45秒');
  assert.equal(describeActual(run, { distanceKm: 5.2, durationSec: 1872 }), '5.2km ・ 31:12 ・ 6:00/km');
});

import { dayNumber, dayNumberToDateStr, addDays } from '../js/logic/dates.js';
import { movingAverage, bmi } from '../js/logic/training.js';

test('日付と通し日数の変換', () => {
  assert.equal(dayNumber('2026-11-16') - dayNumber('2026-11-09'), 7);
  assert.equal(dayNumberToDateStr(dayNumber('2026-03-01')), '2026-03-01');
  assert.equal(addDays('2026-02-27', 2), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});

test('movingAverage は直近7暦日の平均を返す', () => {
  const logs = [
    { date: '2026-11-01', weightKg: 70 },
    { date: '2026-11-02', weightKg: 68 },
    { date: '2026-11-07', weightKg: 69 },
    { date: '2026-11-08', weightKg: 67 }, // 11/01 が窓から外れる
    { date: '2026-11-20', weightKg: 66 }, // 間が空いたら自分だけ
  ];
  const avg = movingAverage(logs).map((p) => p.value);
  assert.deepEqual(avg, [70, 69, 69, 68, 66]);
  assert.deepEqual(movingAverage([]), []);
});

test('bmi', () => {
  assert.equal(bmi(68, 170).toFixed(1), '23.5');
  assert.equal(bmi(68, null), null);
});

import { weekStart, weekRange } from '../js/logic/dates.js';
import {
  epley1RM,
  weightOn,
  strengthSeries,
  runSeries,
  weeklyRunDistance,
  weeklySetsByPart,
} from '../js/logic/training.js';

test('epley1RM', () => {
  assert.equal(epley1RM(20, 1), 20);
  assert.equal(epley1RM(20, 10).toFixed(2), '26.67');
  assert.equal(epley1RM(20, 0), 0);
});

test('weekStart は月曜を返す', () => {
  assert.equal(weekStart('2026-11-16'), '2026-11-16'); // 月
  assert.equal(weekStart('2026-11-22'), '2026-11-16'); // 日
  assert.equal(weekStart('2026-11-15'), '2026-11-09'); // 日
  assert.equal(weekStart('2026-01-01'), '2025-12-29'); // 木、年またぎ
  assert.deepEqual(weekRange('2026-11-02', '2026-11-16'), ['2026-11-02', '2026-11-09', '2026-11-16']);
});

test('weightOn はその日以前の直近の体重', () => {
  const logs = [
    { date: '2026-11-01', weightKg: 70 },
    { date: '2026-11-05', weightKg: 69 },
  ];
  assert.equal(weightOn(logs, '2026-10-31'), null);
  assert.equal(weightOn(logs, '2026-11-03'), 70);
  assert.equal(weightOn(logs, '2026-11-05'), 69);
  assert.equal(weightOn(logs, '2026-12-01'), 69);
});

const done = (date, exerciseId, sets) => ({ date, exerciseId, status: 'done', actual: { sets: sets.map(([weightKg, reps]) => ({ weightKg, reps })) } });

test('strengthSeries は日ごとに集計する', () => {
  const entries = [
    done('2026-11-05', 'sq', [[22.5, 8], [22.5, 0]]),
    done('2026-11-01', 'sq', [[20, 10], [20, 10], [20, 8]]),
    done('2026-11-01', 'sq', [[25, 1]]), // 同じ日は合算
    done('2026-11-01', 'row', [[30, 10]]),
    { date: '2026-11-06', exerciseId: 'sq', status: 'planned', actual: null },
    done('2026-11-07', 'sq', [[20, 0]]), // 0回だけの日は除く
  ];
  const s = strengthSeries(entries, 'sq', [{ date: '2026-11-03', weightKg: 60 }]);
  assert.deepEqual(s.map((p) => p.date), ['2026-11-01', '2026-11-05']);
  assert.equal(s[0].topWeight, 25);
  assert.equal(s[0].volume, 20 * 28 + 25);
  assert.equal(s[0].est1RM.toFixed(2), '26.67');
  assert.equal(s[0].totalReps, 29);
  assert.equal(s[0].bestReps, 10);
  assert.equal(s[0].ratio, null); // 体重の記録がまだない
  assert.equal(s[1].volume, 180);
  assert.equal(s[1].ratio.toFixed(3), (28.5 / 60).toFixed(3));
});

test('runSeries と週ごとの合計距離', () => {
  const run = (date, distanceKm, durationSec) => ({ date, exerciseId: 'run', status: 'done', actual: { distanceKm, durationSec } });
  const entries = [
    run('2026-11-10', 5, 1800),
    run('2026-11-10', 1, 300),
    run('2026-11-15', 3, 1080),
    run('2026-11-16', 4, 1440),
    { date: '2026-11-17', exerciseId: 'run', status: 'planned', plan: { distanceKm: 5 }, actual: null },
    done('2026-11-10', 'sq', [[20, 10]]),
  ];
  const runs = runSeries(entries, new Set(['run']));
  assert.equal(runs.length, 3);
  assert.equal(runs[0].distanceKm, 6);
  assert.equal(runs[0].pace, 350);
  assert.deepEqual([...weeklyRunDistance(runs)], [['2026-11-09', 9], ['2026-11-16', 4]]);
});

test('weeklySetsByPart', () => {
  const exercises = [
    { id: 'sq', bodyPart: 'legs' },
    { id: 'row', bodyPart: 'back' },
    { id: 'pull', bodyPart: 'back' },
    { id: 'run', bodyPart: null },
  ];
  const entries = [
    done('2026-11-09', 'sq', [[20, 10], [20, 10], [20, 0]]),
    done('2026-11-11', 'row', [[30, 10], [30, 10]]),
    done('2026-11-15', 'pull', [[0, 5]]),
    done('2026-11-16', 'sq', [[20, 10]]),
    { date: '2026-11-12', exerciseId: 'run', status: 'done', actual: { distanceKm: 5, durationSec: 1800 } },
  ];
  const w = weeklySetsByPart(entries, exercises);
  assert.deepEqual(w.get('2026-11-09'), { legs: 2, back: 3 });
  assert.deepEqual(w.get('2026-11-16'), { legs: 1 });
});
