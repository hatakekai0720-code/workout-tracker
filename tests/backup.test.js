import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBackup } from '../js/backup.js';

const valid = () => ({
  app: 'workout-tracker',
  schemaVersion: 1,
  profile: { heightCm: 172, targetWeightKg: 65 },
  settings: { theme: 'dark', timerCustomSec: 150, weightStepKg: 2.5, lastBackupAt: '2026-01-01' },
  exercises: [
    { id: 'ex_squat', name: 'スクワット', kind: 'strength', bodyPart: 'legs', loadType: 'weighted', archived: false },
    { id: 'ex_run', name: 'ランニング', kind: 'run', bodyPart: null, loadType: null, archived: false },
  ],
  entries: [
    { id: 'e1', date: '2026-11-10', exerciseId: 'ex_squat', status: 'done', plan: { weightKg: 20, reps: 10, sets: 3 }, actual: { sets: [{ weightKg: 20, reps: 10 }] }, memo: 'ok' },
    { id: 'e2', date: '2026-11-11', exerciseId: 'ex_run', status: 'planned', plan: { distanceKm: 5, durationSec: null }, actual: null },
  ],
  bodyLogs: [
    { date: '2026-11-11', weightKg: 68, bodyFatPct: null },
    { date: '2026-11-10', weightKg: 68.4, bodyFatPct: 18 },
  ],
});
const parse = (obj) => parseBackup(JSON.stringify(obj), '2026-11-15');

test('正しいバックアップを読み込み、整形する', () => {
  const { state, error } = parse({ ...valid(), unknown: 'x' });
  assert.equal(error, undefined);
  assert.equal(state.entries.length, 2);
  assert.equal(state.entries[1].memo, '');
  assert.deepEqual(state.bodyLogs.map((l) => l.date), ['2026-11-10', '2026-11-11']); // 昇順に直す
  assert.equal(state.settings.theme, 'dark');
  assert.equal(state.settings.timerCustomSec, 150);
  assert.deepEqual(state.settings.timerPresets, [60, 90, 120]);
  assert.equal(state.settings.lastBackupAt, '2026-11-15');
  assert.equal('unknown' in state, false);
  assert.equal('app' in state, false);
});

test('JSON でないもの・別物は断る', () => {
  assert.match(parseBackup('not json', '2026-11-15').error, /JSON/);
  assert.match(parse({ hello: 1 }).error, /バックアップではない/);
  assert.match(parse([]).error, /バックアップではない/);
  assert.match(parse({ ...valid(), schemaVersion: 2 }).error, /新しいバージョン/);
});

test('壊れた中身は断る', () => {
  const broken = (edit) => {
    const v = valid();
    edit(v);
    return parse(v).error;
  };
  assert.ok(broken((v) => (v.entries[0].exerciseId = 'nope')));
  assert.ok(broken((v) => (v.entries[0].date = '2026/11/10')));
  assert.ok(broken((v) => (v.entries[0].id = 'a" onclick="x'))); // 属性に入る値なので記号は不可
  assert.ok(broken((v) => (v.entries[0].actual = null))); // 実施済みなのに実績なし
  assert.ok(broken((v) => (v.entries[0].plan.reps = '10')));
  assert.ok(broken((v) => (v.entries[1].plan.distanceKm = 0)));
  assert.ok(broken((v) => (v.entries[1].id = 'e1'))); // 重複
  assert.ok(broken((v) => (v.exercises[0].bodyPart = 'neck')));
  assert.ok(broken((v) => (v.exercises[0].name = '')));
  assert.ok(broken((v) => v.exercises.forEach((x) => (x.archived = true))));
  assert.ok(broken((v) => (v.bodyLogs[0].weightKg = -1)));
  assert.ok(broken((v) => (v.bodyLogs[1].date = '2026-11-11'))); // 同じ日が2件
});

test('設定の不正な値は既定値に戻す', () => {
  const v = valid();
  v.settings = { theme: 'pink', timerCustomSec: 2, weightStepKg: 0 };
  v.profile = { heightCm: 'tall' };
  const { state } = parse(v);
  assert.deepEqual(state.settings, { theme: 'auto', timerPresets: [60, 90, 120], timerCustomSec: null, weightStepKg: 2.5, lastBackupAt: '2026-11-15' });
  assert.deepEqual(state.profile, { heightCm: null, targetWeightKg: null });
});

test('効く筋肉・メモ・自分で書いた解説を復元で残す', () => {
  const v = valid();
  v.exercises[0].muscles = { main: ['quads', 'glutes', 'nope'], sub: ['quads', 'abs'] };
  v.exercises[0].note = '膝を外に';
  v.exercises[0].guideId = 'bw_squat';
  v.exercises[1].guideId = 'bad id"';
  v.exercises[0].customGuide = { steps: 'ゆっくり下ろす', evil: 'x', tips: 42 };
  const { state } = parse(v);
  assert.deepEqual(state.exercises[0].muscles, { main: ['quads', 'glutes'], sub: ['abs'] });
  assert.equal(state.exercises[0].note, '膝を外に');
  assert.equal(state.exercises[0].guideId, 'bw_squat');
  assert.equal('guideId' in state.exercises[1], false);
  assert.deepEqual(state.exercises[0].customGuide, { steps: 'ゆっくり下ろす' });
  // 項目のない古いバックアップもそのまま読める
  assert.equal('muscles' in state.exercises[1], false);
  assert.equal('note' in state.exercises[1], false);
});
