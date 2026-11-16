import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findMissed, daysSinceMissed, planReschedule, restartShift, restartWindow, lightenPlan, nextSessionEntries, RETURN_LIGHT, RESTART_LIGHT,
} from '../js/logic/reschedule.js';
import { streak } from '../js/logic/insights.js';

const TODAY = '2026-11-16'; // 月曜
const SETTINGS = { dayStart: '06:00', dayEnd: '23:00', timeStepMin: 60 };
const partsOf = new Map([['sq', 'legs'], ['bp', 'chest'], ['plank', 'core']]);
let seq = 0;
// プログラムの1回ぶん(スクワット+ベンチ)
const session = (date, time, n, extra = {}) => [
  { id: `e${seq++}`, date, time, durationMin: 60, exerciseId: 'sq', status: 'planned', plan: { weightKg: 40, reps: 10, sets: 3 }, actual: null, programId: 'p', sessionKey: `p:0:s${n}`, sessionLabel: `全身${n}`, ...extra },
  { id: `e${seq++}`, date, time, durationMin: 60, exerciseId: 'bp', status: 'planned', plan: { weightKg: 30, reps: 10, sets: 3 }, actual: null, programId: 'p', sessionKey: `p:0:s${n}`, sessionLabel: `全身${n}`, ...extra },
];
const runEntry = (date, time, n) => ({ id: `e${seq++}`, date, time, durationMin: 30, exerciseId: 'run', status: 'planned', plan: { distanceKm: 4, durationSec: null }, actual: null, programId: 'p', sessionKey: `p:0:r${n}`, sessionLabel: `ランニング 4km` });
const plan = (entries, extra = {}) =>
  planReschedule({ entries, events: [], settings: SETTINGS, programId: 'p', partsOf, today: TODAY, nowMin: 8 * 60, timeOfDay: 'night', ...extra });

test('findMissed: 過去の未実施を1回ぶんずつ。手で入れた予定・一部だけ実施した回は動かさない側', () => {
  const s0 = session('2026-11-13', '19:00', 0);
  const s1 = session('2026-11-14', '19:00', 1);
  s1[0] = { ...s1[0], status: 'done', actual: { sets: [] } };
  const manual = { id: 'm1', date: '2026-11-15', exerciseId: 'bp', status: 'planned', plan: {}, actual: null };
  const future = session('2026-11-18', '19:00', 2);
  const list = findMissed([...s0, ...s1, manual, ...future, runEntry('2026-11-15', '07:00', 0)], TODAY, 'p', partsOf);
  assert.deepEqual(list.map((m) => [m.key, m.program, m.partial, m.isRun, m.entryIds.length]), [
    ['p:0:s0|2026-11-13', true, false, false, 2],
    ['p:0:s1|2026-11-14', false, true, false, 1],
    ['p:0:r0|2026-11-15', true, false, true, 1],
    ['d|2026-11-15', false, false, false, 1],
  ]);
  assert.equal(daysSinceMissed(list, TODAY), 3);
  // プログラムがなければ、すべて手で入れた予定の扱い
  assert.ok(findMissed(s0, TODAY, null, partsOf).every((m) => !m.program));
});

test('振り替え: 今日の空き時間(今から30分より後、希望の時間帯)へ。間隔の足りない後ろの回は順に押し出す', () => {
  const entries = [...session('2026-11-13', '19:00', 0), ...session('2026-11-17', '19:00', 1), ...session('2026-11-20', '19:00', 2)];
  const { moves } = plan(entries);
  assert.deepEqual(moves.map((m) => [m.key, m.toDate, m.toTime]), [
    ['p:0:s0|2026-11-13', '2026-11-16', '19:00'],
    ['p:0:s1|2026-11-17', '2026-11-18', '19:00'], // 同じ部位を48時間空ける
  ]);
  assert.equal(moves[0].fromTime, '19:00');
  assert.equal(moves[0].durationMin, 60);
  assert.deepEqual(moves[0].warnings, []);
  // 11/20 の回は 11/18 から48時間空いているので動かさない
});

test('振り替え: バイトの前後30分を避け、順番を保つ', () => {
  const events = [{ id: 'w', title: 'バイト', kind: 'work', date: TODAY, start: '17:00', end: '22:00', repeat: null, exceptions: {}, termId: null }];
  const entries = [...session('2026-11-14', '19:00', 0), ...session('2026-11-15', '19:00', 1)];
  const { moves } = planReschedule({ entries, events, settings: SETTINGS, programId: 'p', partsOf, today: TODAY, nowMin: 8 * 60, timeOfDay: 'night' });
  // 今日の夜はバイトで埋まっているので、時間帯の外(22:30以降は日の終わりを越える)→ 時間帯の外で今日の空き
  const first = moves.find((m) => m.key.startsWith('p:0:s0'));
  const second = moves.find((m) => m.key.startsWith('p:0:s1'));
  assert.ok(first.toDate === TODAY || first.toDate === '2026-11-17');
  assert.ok(first.toTime < '16:30' || first.toDate !== TODAY);
  assert.ok(second.toDate > first.toDate); // 順番を保つ
  assert.ok(second.toDate >= '2026-11-18'); // 48時間
});

test('振り替え: 今日はもう遅ければ明日以降。過去の回だけが対象で、動かさない回(held)はそのまま', () => {
  const entries = [...session('2026-11-14', '19:00', 0), ...session('2026-11-15', '19:00', 1)];
  const { moves } = plan(entries, { nowMin: 22 * 60, held: new Set(['p:0:s0|2026-11-14']) });
  assert.deepEqual(moves.map((m) => [m.key, m.toDate]), [['p:0:s1|2026-11-15', '2026-11-17']]);
});

test('ラン: 1日1回まで。分ける設定なら筋トレの日を避ける', () => {
  const entries = [...session('2026-11-14', '19:00', 0), runEntry('2026-11-15', '19:00', 0)];
  const { moves } = plan(entries, { separateRun: true });
  const run = moves.find((m) => m.isRun);
  const lift = moves.find((m) => !m.isRun);
  assert.equal(lift.toDate, TODAY);
  assert.equal(run.toDate, '2026-11-17');
  const together = plan(entries, { separateRun: false }).moves.find((m) => m.isRun);
  assert.equal(together.toDate, TODAY); // 分けない設定なら同じ日でもよい
  assert.notEqual(together.toTime, '19:00'); // 時間は重ねない
});

test('再開プラン: いちばん古い回を今日にそろえ、残りも同じ日数だけずらす。最初の1週間を軽くする対象', () => {
  const entries = [...session('2026-11-02', '19:00', 0), ...session('2026-11-04', '19:00', 1), ...session('2026-11-20', '19:00', 2)];
  const missed = findMissed(entries, TODAY, 'p', partsOf);
  assert.equal(daysSinceMissed(missed, TODAY), 14);
  const shift = restartShift(missed, TODAY);
  const { moves } = plan(entries, { shiftDays: shift });
  assert.deepEqual(moves.map((m) => m.toDate), ['2026-11-16', '2026-11-18', '2026-12-04']);
  const light = restartWindow(moves, TODAY);
  assert.deepEqual([...light], ['p:0:s0|2026-11-16', 'p:0:s1|2026-11-18']);
});

test('実施済みの部位も見る(昨日脚をやったら、今日は避ける)', () => {
  const done = { id: 'd1', date: '2026-11-15', time: '19:00', exerciseId: 'sq', status: 'done', plan: {}, actual: { sets: [] } };
  const { moves } = plan([done, ...session('2026-11-14', '19:00', 0)]);
  assert.equal(moves[0].toDate, '2026-11-17');
});

test('lightenPlan: 重さは刻みで切り下げ、セットは2セットまで残す。ランは距離を減らす', () => {
  const ex = { kind: 'strength', loadType: 'weighted' };
  assert.deepEqual(lightenPlan(ex, { weightKg: 40, reps: 10, sets: 3 }, RETURN_LIGHT), { weightKg: 35, reps: 10, sets: 2 });
  assert.deepEqual(lightenPlan(ex, { weightKg: 42.5, reps: 8, sets: 4, restSec: 90 }, RESTART_LIGHT), { weightKg: 32.5, reps: 8, sets: 3, restSec: 90 });
  assert.deepEqual(lightenPlan(ex, { weightKg: 0, reps: 10, sets: 2 }, RETURN_LIGHT), { weightKg: 0, reps: 10, sets: 2 });
  assert.deepEqual(lightenPlan(ex, { weightKg: 20, reps: 10, sets: 1 }, RETURN_LIGHT, 1), { weightKg: 18, reps: 10, sets: 1 });
  assert.deepEqual(lightenPlan({ kind: 'run' }, { distanceKm: 5, durationSec: 1800 }, RESTART_LIGHT), { distanceKm: 4, durationSec: null });
});

test('nextSessionEntries: 今日以降でいちばん早い1回ぶん', () => {
  const a = session('2026-11-18', '19:00', 1);
  const b = session('2026-11-17', '07:00', 0);
  const manual = { id: 'm', date: '2026-11-17', time: '20:00', exerciseId: 'bp', status: 'planned', plan: {} };
  assert.deepEqual(nextSessionEntries([...a, manual, ...b], TODAY).map((e) => e.id), b.map((e) => e.id));
  assert.deepEqual(nextSessionEntries([manual], TODAY).map((e) => e.id), ['m']);
  assert.deepEqual(nextSessionEntries([], TODAY), []);
});

test('継続日数: 「休んだ」の日は休養日と同じ。「スキップ」の日は途切れる', () => {
  const d = (date, status, skipReason) => ({ date, status, ...(skipReason ? { skipReason } : {}) });
  assert.equal(streak([d('2026-11-13', 'done'), d('2026-11-14', 'skipped', 'sick'), d('2026-11-15', 'done')], TODAY), 2);
  assert.equal(streak([d('2026-11-13', 'done'), d('2026-11-14', 'skipped', 'skip'), d('2026-11-15', 'done')], TODAY), 1);
});
