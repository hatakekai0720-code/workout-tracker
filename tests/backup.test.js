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
  assert.deepEqual(state.settings, { theme: 'auto', timerPresets: [60, 90, 120], timerCustomSec: null, weightStepKg: 2.5, lastBackupAt: '2026-11-15', ownedEquipment: null, timeStepMin: 60, dayStart: '06:00', dayEnd: '23:00' });
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

test('持っている器具の設定を復元で残す', () => {
  const v = valid();
  v.settings.ownedEquipment = ['dumbbell', 'pullup_bar', 'dumbbell', 'jetpack'];
  assert.deepEqual(parse(v).state.settings.ownedEquipment, ['dumbbell', 'pullup_bar']);
  v.settings.ownedEquipment = [];
  assert.deepEqual(parse(v).state.settings.ownedEquipment, []); // 「絞り込むが何も持っていない」は null と区別する
  assert.equal(parse(valid()).state.settings.ownedEquipment, null);
});

test('スケジュール(予定・テンプレート・学期)と、トレーニングの時刻を復元で残す', () => {
  const v = valid();
  v.entries[0].time = '18:00';
  v.entries[0].durationMin = 45;
  v.entries[1].time = '25:00'; // 不正な時刻は捨てる
  v.terms = [{ id: 't1', name: '後期', from: '2026-09-22', to: '2027-01-31' }];
  v.events = [
    { id: 'ev1', title: 'バイト', kind: 'work', date: '2026-11-02', start: '17:00', end: '24:00',
      repeat: { freq: 'weekly', days: [0, 2, 9, 2], until: null, count: 10 },
      exceptions: { '2026-11-09': { skip: true }, '2026-11-16': { start: '13:00', end: '16:00' } }, termId: null },
    { id: 'ev2', title: '統計学', kind: 'school', date: '2026-09-28', start: '09:00', end: '10:30', repeat: null, termId: 't1' },
    { id: 'ev3', title: '用事', kind: '???', date: '2026-11-03', start: '10:00', end: '11:00', termId: 'gone' },
  ];
  v.eventTemplates = [{ id: 'tp1', title: '中番', kind: 'work', start: '12:00', end: '18:00' }];
  v.settings.timeStepMin = 15;
  v.settings.dayStart = '07:00';
  v.settings.dayEnd = '24:00';
  const { state, error } = parse(v);
  assert.equal(error, undefined);
  assert.deepEqual([state.entries[0].time, state.entries[0].durationMin, 'time' in state.entries[1]], ['18:00', 45, false]);
  assert.deepEqual(state.events[0].repeat, { freq: 'weekly', days: [0, 2], until: null, count: 10 });
  assert.deepEqual(state.events[0].exceptions, { '2026-11-09': { skip: true }, '2026-11-16': { start: '13:00', end: '16:00' } });
  assert.equal(state.events[0].end, '24:00');
  assert.equal(state.events[1].termId, 't1');
  assert.deepEqual([state.events[2].kind, state.events[2].termId, state.events[2].repeat], ['other', null, null]);
  assert.deepEqual(state.eventTemplates, v.eventTemplates);
  assert.deepEqual(state.terms, v.terms);
  assert.deepEqual([state.settings.timeStepMin, state.settings.dayStart, state.settings.dayEnd], [15, '07:00', '24:00']);
});

test('スケジュールのない古いバックアップは、空の予定と初期のテンプレートになる', () => {
  const { state } = parse(valid());
  assert.deepEqual(state.events, []);
  assert.deepEqual(state.terms, []);
  assert.deepEqual(state.eventTemplates.map((t) => t.title), ['早番', '遅番']);
  assert.deepEqual([state.settings.timeStepMin, state.settings.dayStart, state.settings.dayEnd], [60, '06:00', '23:00']);
});

test('壊れた予定は断る', () => {
  const bad = (edit) => {
    const v = valid();
    v.events = [{ id: 'ev1', title: 'バイト', kind: 'work', date: '2026-11-02', start: '17:00', end: '22:00', repeat: null }];
    edit(v.events[0]);
    return parse(v).error;
  };
  assert.ok(bad((e) => (e.start = '23:00'))); // 開始 >= 終了
  assert.ok(bad((e) => (e.end = '9:00')));
  assert.ok(bad((e) => (e.title = '')));
  assert.ok(bad((e) => (e.date = 'tomorrow')));
  assert.ok(bad((e) => (e.repeat = { freq: 'hourly' })));
  assert.ok(bad((e) => (e.exceptions = { '2026-11-09': { start: '22:00', end: '21:00' } })));
  assert.ok(bad((e) => (e.id = 'x" onclick="y')));
});
