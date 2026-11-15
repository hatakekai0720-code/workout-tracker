import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toDateStr,
  monthGrid,
  paceSecPerKm,
  formatPace,
  formatDuration,
  findPrevious,
  describePlan,
  describeActual,
  formatDateJa,
} from '../js/calc.js';

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
