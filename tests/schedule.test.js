import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toMin, fromMin, weekdayOf, expandEvents, firstOccurrence, editEvent, deleteEvent,
  termEvents, copyWeek, findConflicts, freeStarts, rescheduleOptions,
} from '../js/schedule.js';

const ev = (over) => ({ id: 'a', title: 'バイト', kind: 'work', date: '2026-11-02', start: '17:00', end: '22:00', repeat: null, exceptions: {}, termId: null, ...over });
const dates = (events, from, to) => expandEvents(events, from, to).map((o) => o.date);
let n = 0;
const newId = () => `new${++n}`;

test('時刻と曜日', () => {
  assert.equal(toMin('09:30'), 570);
  assert.equal(fromMin(570), '09:30');
  assert.equal(fromMin(1440), '24:00');
  assert.equal(weekdayOf('2026-11-02'), 0); // 月
  assert.equal(weekdayOf('2026-11-08'), 6); // 日
});

test('繰り返さない予定は、その日だけ', () => {
  assert.deepEqual(dates([ev()], '2026-11-01', '2026-11-30'), ['2026-11-02']);
  assert.deepEqual(dates([ev()], '2026-11-03', '2026-11-30'), []);
});

test('毎日・平日のみ', () => {
  const daily = ev({ repeat: { freq: 'daily', until: '2026-11-05' } });
  assert.deepEqual(dates([daily], '2026-11-01', '2026-11-30'), ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
  const weekdays = ev({ repeat: { freq: 'weekdays' } });
  assert.deepEqual(dates([weekdays], '2026-11-05', '2026-11-10'), ['2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10']);
});

test('毎週(曜日を複数)・隔週', () => {
  const weekly = ev({ repeat: { freq: 'weekly', days: [1, 3] } }); // 火・木。開始日は月曜
  assert.deepEqual(dates([weekly], '2026-11-01', '2026-11-13'), ['2026-11-03', '2026-11-05', '2026-11-10', '2026-11-12']);
  assert.equal(firstOccurrence(weekly), '2026-11-03');
  const noDays = ev({ repeat: { freq: 'weekly' } }); // 曜日を選ばなければ開始日の曜日
  assert.deepEqual(dates([noDays], '2026-11-01', '2026-11-20'), ['2026-11-02', '2026-11-09', '2026-11-16']);
  const biweekly = ev({ repeat: { freq: 'biweekly', days: [0, 4] } }); // 月・金
  assert.deepEqual(dates([biweekly], '2026-11-01', '2026-11-30'), ['2026-11-02', '2026-11-06', '2026-11-16', '2026-11-20', '2026-11-30']);
});

test('毎月(日付)・毎月(第何何曜日)', () => {
  const byDate = ev({ date: '2026-10-31', repeat: { freq: 'monthlyDate' } }); // 31日のない月は飛ばす
  assert.deepEqual(dates([byDate], '2026-10-01', '2027-01-31'), ['2026-10-31', '2026-12-31', '2027-01-31']);
  const byNth = ev({ date: '2026-11-10', repeat: { freq: 'monthlyNth' } }); // 第2火曜
  assert.deepEqual(dates([byNth], '2026-11-01', '2027-02-01'), ['2026-11-10', '2026-12-08', '2027-01-12']);
});

test('終了条件: 終了日まで・回数を指定・終わりなし', () => {
  const until = ev({ repeat: { freq: 'weekly', until: '2026-11-16' } });
  assert.deepEqual(dates([until], '2026-11-01', '2026-12-31'), ['2026-11-02', '2026-11-09', '2026-11-16']);
  const count = ev({ repeat: { freq: 'weekly', days: [0, 2], count: 5 } });
  assert.deepEqual(dates([count], '2026-11-01', '2026-12-31'), ['2026-11-02', '2026-11-04', '2026-11-09', '2026-11-11', '2026-11-16']);
  assert.deepEqual(dates([count], '2026-11-10', '2026-12-31'), ['2026-11-11', '2026-11-16']); // 途中から見ても回数は最初から数える
  const forever = ev({ repeat: { freq: 'weekly' } });
  assert.deepEqual(dates([forever], '2028-01-01', '2028-01-10'), ['2028-01-03', '2028-01-10']);
});

test('例外: この日だけ休み・この日だけ時間変更', () => {
  const e = ev({ repeat: { freq: 'weekly', count: 4 }, exceptions: { '2026-11-09': { skip: true }, '2026-11-16': { start: '13:00', end: '16:00' } } });
  const occ = expandEvents([e], '2026-11-01', '2026-12-31');
  assert.deepEqual(occ.map((o) => [o.date, o.start, o.end, o.changed]), [
    ['2026-11-02', '17:00', '22:00', false],
    ['2026-11-16', '13:00', '16:00', true],
    ['2026-11-23', '17:00', '22:00', false], // 休みにした回も回数に数えるので、4回目はここ
  ]);
});

test('編集: この回だけ / これ以降すべて / すべて', () => {
  const base = ev({ repeat: { freq: 'weekly', until: null, count: null }, exceptions: { '2026-11-09': { skip: true }, '2026-11-30': { skip: true } } });
  const one = editEvent([base], 'a', '2026-11-16', 'one', { start: '18:00', end: '21:00', title: '変えない' }, newId);
  assert.equal(one.length, 1);
  assert.equal(one[0].title, 'バイト'); // この回だけでは時間しか変わらない
  assert.deepEqual(one[0].exceptions['2026-11-16'], { start: '18:00', end: '21:00' });

  const all = editEvent([base], 'a', '2026-11-16', 'all', { title: '遅番', start: '18:00' }, newId);
  assert.deepEqual([all[0].title, all[0].start, all[0].date], ['遅番', '18:00', '2026-11-02']);

  const future = editEvent([base], 'a', '2026-11-16', 'future', { start: '10:00', end: '15:00' }, newId);
  assert.equal(future.length, 2);
  assert.equal(future[0].repeat.until, '2026-11-15');
  assert.deepEqual(Object.keys(future[0].exceptions), ['2026-11-09']);
  assert.equal(future[1].date, '2026-11-16');
  assert.notEqual(future[1].id, 'a');
  assert.deepEqual(Object.keys(future[1].exceptions), ['2026-11-30']);
  assert.deepEqual(expandEvents(future, '2026-11-01', '2026-12-07').map((o) => [o.date, o.start]), [
    ['2026-11-02', '17:00'], ['2026-11-16', '10:00'], ['2026-11-23', '10:00'], ['2026-12-07', '10:00'],
  ]);
  // 最初の回で「これ以降」を選んだら、全体の変更と同じ
  assert.equal(editEvent([base], 'a', '2026-11-02', 'future', { start: '10:00' }, newId).length, 1);
  // 繰り返さない予定はそのまま変わる
  assert.equal(editEvent([ev()], 'a', '2026-11-02', 'one', { title: '早番', date: '2026-11-03' }, newId)[0].date, '2026-11-03');
});

test('編集: 回数指定の繰り返しを途中で分けても、合計の回数は変わらない', () => {
  const base = ev({ repeat: { freq: 'weekly', until: null, count: 5 } });
  const future = editEvent([base], 'a', '2026-11-16', 'future', { start: '10:00', repeat: base.repeat }, newId);
  assert.equal(future[1].repeat.count, 3);
  assert.equal(expandEvents(future, '2026-11-01', '2027-03-01').length, 5);
});

test('削除: この回だけ / これ以降すべて / すべて', () => {
  const base = ev({ repeat: { freq: 'weekly', until: null, count: null } });
  const one = deleteEvent([base], 'a', '2026-11-09', 'one');
  assert.deepEqual(dates(one, '2026-11-01', '2026-11-20'), ['2026-11-02', '2026-11-16']);
  const future = deleteEvent([base], 'a', '2026-11-09', 'future');
  assert.deepEqual(dates(future, '2026-11-01', '2026-12-31'), ['2026-11-02']);
  assert.deepEqual(deleteEvent([base], 'a', '2026-11-09', 'all'), []);
  assert.deepEqual(deleteEvent([base], 'a', '2026-11-02', 'future'), []);
  assert.deepEqual(deleteEvent([ev()], 'a', '2026-11-02', 'one'), []);
});

test('学期の時間割: 学期末まで毎週繰り返す予定になる', () => {
  const term = { id: 't1', name: '後期', from: '2026-09-22', to: '2027-01-31' }; // 9/22 は火曜
  const list = termEvents(term, [
    { day: 0, title: '統計学', start: '09:00', end: '10:30' },
    { day: 1, title: '英語', start: '13:00', end: '14:30' },
  ], newId);
  assert.deepEqual(list.map((e) => [e.title, e.date, e.kind, e.termId]), [
    ['統計学', '2026-09-28', 'school', 't1'], // 開始日以降で最初の月曜
    ['英語', '2026-09-22', 'school', 't1'],
  ]);
  const occ = dates(list, '2026-09-01', '2027-03-01');
  assert.equal(occ[0], '2026-09-22');
  assert.equal(occ.at(-1), '2027-01-26'); // 学期末を越えない
});

test('シフトの「先週をコピー」', () => {
  const events = [
    ev({ id: 's1', date: '2026-11-03', start: '09:00', end: '15:00', title: '早番' }),
    ev({ id: 's2', date: '2026-11-07', title: '遅番' }),
    ev({ id: 'c1', date: '2026-11-04', kind: 'school', title: '授業' }), // バイト以外は写さない
    ev({ id: 'r1', date: '2026-11-02', repeat: { freq: 'weekly' } }), // 繰り返しは写さない
    ev({ id: 's3', date: '2026-11-14', title: '遅番' }), // 今週にすでにある
  ];
  const added = copyWeek(events, '2026-11-02', '2026-11-09', 'work', newId);
  assert.deepEqual(added.map((e) => [e.title, e.date, e.start]), [['早番', '2026-11-10', '09:00']]);
  assert.deepEqual(copyWeek([...events, ...added], '2026-11-02', '2026-11-09', 'work', newId), []); // 2回押しても増えない
});

const training = (id, date, time, over = {}) => ({ id, date, time, status: 'planned', exerciseId: 'x', ...over });

test('重なりの検出: 時刻つきの予定トレーニングだけ', () => {
  const events = [ev({ repeat: { freq: 'weekly' } })]; // 毎週月曜 17〜22時
  const entries = [
    training('t1', '2026-11-09', '18:00'),
    training('t2', '2026-11-09', '16:00'), // 16〜17時: 接しているだけなら重ならない
    training('t3', '2026-11-09', '16:30'), // 16:30〜17:30: 重なる
    training('t4', '2026-11-16', '21:30', { status: 'done' }), // 実施済みは対象外
    { id: 't5', date: '2026-11-09', status: 'planned' }, // 時刻なし
    training('t6', '2026-11-10', '18:00'), // 火曜は予定なし
    training('t7', '2026-11-16', '16:00', { durationMin: 90 }),
  ];
  const c = findConflicts(entries, events, '2026-11-01', '2026-11-30');
  assert.deepEqual(c.map((x) => x.entry.id), ['t3', 't1', 't7']);
  assert.equal(c[0].occurrence.event.title, 'バイト');
});

test('空き時間と振り替え候補', () => {
  assert.deepEqual(freeStarts([[600, 720]], 60, 480, 840, 60).map(fromMin), ['08:00', '09:00', '12:00', '13:00']);
  assert.deepEqual(freeStarts([[600, 720]], 60, 480, 840, 30).map(fromMin), ['08:00', '08:30', '09:00', '12:00', '12:30', '13:00']);
  const events = [ev({ repeat: { freq: 'daily' }, start: '17:00', end: '22:00' })];
  const t = training('t1', '2026-11-09', '18:00');
  const other = training('t2', '2026-11-10', '16:00'); // 翌日の16時は別のトレーニングでふさがっている
  const opts = rescheduleOptions(t, events, [t, other], { dayStart: 360, dayEnd: 1380, step: 60 });
  assert.deepEqual(opts, [
    { date: '2026-11-09', time: '16:00' }, // 同じ日の前で一番近い
    { date: '2026-11-09', time: '22:00' }, // 同じ日の後で一番近い
    { date: '2026-11-10', time: '15:00' }, // 翌日: 18時に近い空き
    { date: '2026-11-11', time: '16:00' },
  ]);
});

test('プログラムの1回ぶん(同じ sessionKey)は、重なりも振り替えもまとめて扱う', () => {
  const events = [ev({ repeat: { freq: 'daily' }, start: '17:00', end: '22:00' })];
  const a = training('p1', '2026-11-09', '18:00', { sessionKey: 'prog:0:0' });
  const b = training('p2', '2026-11-09', '18:00', { sessionKey: 'prog:0:0' });
  const c = training('p3', '2026-11-10', '18:00', { sessionKey: 'prog:0:1' });
  const conflicts = findConflicts([a, b, c], events, '2026-11-01', '2026-11-30');
  assert.deepEqual(conflicts.map((x) => x.entry.id), ['p1', 'p3']); // p2 は p1 と同じ回なので出さない
  // 同じ回のもう1つの種目(p2)がその時間をふさいでいる、とは数えない
  const opts = rescheduleOptions(a, [], [a, b], { dayStart: 360, dayEnd: 1380, step: 60 });
  assert.ok(opts.some((o) => o.date === '2026-11-09' && o.time === '17:00'));
});

test('空き時間探しの境目: 予定とくっつくのはよい、1日の終わりちょうどまで、入らない日は空', () => {
  // 10〜12時が予定。9〜10時と12〜13時は、予定とくっつくが重ならないので空き
  assert.deepEqual(freeStarts([[600, 720]], 60, 540, 780, 60).map(fromMin), ['09:00', '12:00']);
  // 22〜23時(1日の終わりちょうど)に入る
  assert.deepEqual(freeStarts([], 60, 1320, 1380, 60).map(fromMin), ['22:00']);
  // 1日の長さより長いトレーニングは入らない
  assert.deepEqual(freeStarts([], 120, 1320, 1380, 60), []);
  // 1日の範囲の外の予定は関係ない。15分きざみ
  assert.deepEqual(freeStarts([[300, 400], [1400, 1440]], 45, 360 + 60, 360 + 120, 15).map(fromMin), ['07:00', '07:15']);
  // 予定がいくつもあれば、そのすき間だけ
  assert.deepEqual(freeStarts([[480, 600], [660, 780]], 60, 480, 900, 60).map(fromMin), ['10:00', '13:00', '14:00']);
  // 予定が隙間なく並んでいれば空きはない
  assert.deepEqual(freeStarts([[360, 900], [900, 1380]], 30, 360, 1380, 30), []);
});

test('振り替え候補は max 件まで。空きがない日は飛ばす', () => {
  const t = training('t1', '2026-11-09', '18:00');
  assert.equal(rescheduleOptions(t, [], [t], { dayStart: 360, dayEnd: 1380, step: 60, max: 2 }).length, 2);
  // 翌日だけ一日中ふさがっている → 翌日の候補はなく、その次の日から
  const block = ev({ date: '2026-11-10', start: '06:00', end: '23:00' });
  const opts = rescheduleOptions(t, [block], [t], { dayStart: 360, dayEnd: 1380, step: 60, max: 10 });
  assert.ok(!opts.some((o) => o.date === '2026-11-10'), JSON.stringify(opts));
  assert.ok(opts.some((o) => o.date === '2026-11-11'));
});
