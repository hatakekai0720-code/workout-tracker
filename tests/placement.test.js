import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeProgram, overlapWarning } from '../js/placement.js';
import { toMin } from '../js/schedule.js';
import { dayNumber } from '../js/calc.js';

const settings = { dayStart: '06:00', dayEnd: '23:00', timeStepMin: 60 };
const partsOf = new Map([['sq', 'legs'], ['bench', 'chest'], ['row', 'back'], ['plank', 'core'], ['run', undefined]]);
const session = (label, ids, minutes = 45) => ({ label, minutes, items: ids.map((exerciseId) => ({ exerciseId })) });
const week = (index, sessions, runs = []) => ({ index, sessions, runs });
const ev = (over) => ({ id: 'a', title: 'バイト', kind: 'work', date: '2026-11-16', start: '17:00', end: '22:00', repeat: null, exceptions: {}, ...over });
const place = (over) => placeProgram({ weeks: [], startDate: '2026-11-16', events: [], entries: [], settings, timeOfDay: 'night', partsOf, ...over });
const full = [session('全身A', ['sq', 'bench', 'row']), session('全身B', ['sq', 'bench', 'row']), session('全身C', ['sq', 'bench', 'row'])];

test('週の中に均等に散らし、希望の時間帯に置く', () => {
  const items = place({ weeks: [week(0, full), week(1, full)] });
  assert.deepEqual(items.map((i) => [i.date, i.time, i.label]), [
    ['2026-11-16', '19:00', '全身A'], ['2026-11-18', '19:00', '全身B'], ['2026-11-21', '19:00', '全身C'],
    ['2026-11-23', '19:00', '全身A'], ['2026-11-25', '19:00', '全身B'], ['2026-11-28', '19:00', '全身C'],
  ]);
  assert.ok(items.every((i) => i.warnings.length === 0 && i.durationMin === 45));
  assert.equal(place({ weeks: [week(0, full)], timeOfDay: 'morning' })[0].time, '07:00');
  assert.equal(place({ weeks: [week(0, full)], timeOfDay: 'noon' })[0].time, '12:00');
  assert.equal(place({ weeks: [week(0, full)], timeOfDay: 'any' })[0].time, '18:00');
});

test('予定(バイト・学校)と、その前後30分を避ける', () => {
  // 月曜 17〜22時にバイト → 夜の枠(18〜22時)は使えないので、時間帯の外の近い空きにする
  const one = place({ weeks: [week(0, [session('全身A', ['sq'])])], events: [ev({ repeat: { freq: 'daily' } })] });
  assert.equal(one[0].time, '15:00'); // 16:30 からはバイト前の余裕の時間。45分かかるので、1時間きざみでは 15:00 が最後
  assert.ok(one[0].warnings.some((w) => w.includes('希望の時間帯に空きがなく')));
  // バイトが月曜だけなら、月曜を避けて夜に置ける日を選ぶ
  const other = place({ weeks: [week(0, [session('全身A', ['sq'])])], events: [ev()] });
  assert.deepEqual([other[0].date, other[0].time, other[0].warnings.length], ['2026-11-17', '19:00', 0]);
  // 毎日 6〜23時がふさがっている週は、時刻を決めない
  const none = place({ weeks: [week(0, [session('全身A', ['sq'])])], events: [ev({ start: '06:00', end: '23:00', repeat: { freq: 'daily' } })] });
  assert.equal(none[0].time, null);
  assert.ok(none[0].warnings[0].includes('空き時間が見つからない'));
});

test('同じ部位は48時間以上空ける', () => {
  const hours = (a, b) => (dayNumber(b.date) * 1440 + toMin(b.time) - dayNumber(a.date) * 1440 - toMin(a.time)) / 60;
  for (const n of [2, 3]) {
    const items = place({ weeks: [week(0, full.slice(0, n)), week(1, full.slice(0, n))] });
    for (let i = 1; i < items.length; i++) assert.ok(hours(items[i - 1], items[i]) >= 48, `${items[i - 1].date} → ${items[i].date}`);
  }
  // 部位が違えば連日でもよい(上半身 → 下半身)。同じ部位どうしは48時間以上空く。
  const split = [session('上半身A', ['bench', 'row']), session('下半身A', ['sq']), session('上半身B', ['bench', 'row']), session('下半身B', ['sq'])];
  const items = place({ weeks: [week(0, split)] });
  assert.equal(new Set(items.map((i) => i.date)).size, 4); // 1日に2回は入れない
  const upper = items.filter((i) => i.label.startsWith('上半身'));
  const lower = items.filter((i) => i.label.startsWith('下半身'));
  assert.ok(hours(upper[0], upper[1]) >= 48 && hours(lower[0], lower[1]) >= 48);
  assert.ok(items.every((i) => i.warnings.length === 0));
});

test('すでにある記録の部位と時刻も見る', () => {
  // 開始日の前日(日曜の夜)に脚を鍛えている → 脚の入った回は月曜を避ける
  const entries = [{ date: '2026-11-15', time: '20:00', exerciseId: 'sq', status: 'done' }];
  const items = place({ weeks: [week(0, [session('全身A', ['sq'])])], entries });
  assert.equal(items[0].date, '2026-11-18'); // 72時間以上空く日
  // 時刻つきの記録がある時間は避ける
  const busy = [{ date: '2026-11-16', time: '19:00', durationMin: 60, exerciseId: 'plank', status: 'planned' }];
  const moved = place({ weeks: [week(0, [session('上半身', ['bench'])])], entries: busy });
  assert.deepEqual([moved[0].date, moved[0].time], ['2026-11-16', '18:00']);
});

test('ランは筋トレのない日を優先して散らす', () => {
  const items = place({ weeks: [week(0, full, [3, 3])] });
  const runs = items.filter((i) => i.kind === 'run');
  const sessions = items.filter((i) => i.kind === 'session');
  assert.equal(runs.length, 2);
  assert.ok(runs.every((r) => !sessions.some((s) => s.date === r.date)), runs.map((r) => r.date).join(','));
  assert.notEqual(runs[0].date, runs[1].date);
  assert.deepEqual([runs[0].label, runs[0].km, runs[0].durationMin], ['ランニング 3km', 3, 35]);
  // 筋トレが週6回なら、同じ日の別の時間に入る
  const six = Array.from({ length: 6 }, (_, i) => session(`回${i}`, [i % 2 ? 'sq' : 'bench']));
  const crowded = place({ weeks: [week(0, six, [3, 3])] });
  const r = crowded.filter((i) => i.kind === 'run');
  assert.ok(r.every((x) => x.time));
  for (const x of r) {
    const same = crowded.find((s) => s.kind === 'session' && s.date === x.date);
    if (same) assert.ok(toMin(x.time) >= toMin(same.time) + same.durationMin || toMin(x.time) + x.durationMin <= toMin(same.time));
  }
});

test('時間の単位と活動できる時間帯を守る', () => {
  const items = placeProgram({ weeks: [week(0, [session('全身A', ['sq'], 50)])], startDate: '2026-11-16', events: [ev({ start: '18:00', end: '19:15' })], entries: [],
    settings: { dayStart: '08:00', dayEnd: '21:00', timeStepMin: 15 }, timeOfDay: 'night', partsOf });
  // 19:15 に終わる予定 + 30分の余裕 → 19:45 から置ける。50分 → 20:35 終了で、21:00 までに収まる
  assert.deepEqual([items[0].date, items[0].time, items[0].durationMin], ['2026-11-16', '19:45', 50]);
  const early = placeProgram({ weeks: [week(0, [session('全身A', ['sq'], 50)])], startDate: '2026-11-16', events: [], entries: [],
    settings: { dayStart: '08:00', dayEnd: '21:00', timeStepMin: 15 }, timeOfDay: 'morning', partsOf });
  assert.equal(early[0].time, '08:00'); // 朝の枠は6時からだが、活動できるのは8時から
});

test('overlapWarning: 手で動かした先が重なっていれば知らせる', () => {
  const items = [
    { label: '全身A', date: '2026-11-16', time: '19:00', durationMin: 45 },
    { label: 'ランニング 3km', date: '2026-11-16', time: '19:30', durationMin: 35 },
    { label: '全身B', date: '2026-11-18', time: '18:00', durationMin: 45 },
    { label: '全身C', date: '2026-11-20', time: null, durationMin: 45 },
  ];
  assert.equal(overlapWarning(items[0], items, [], []), '「ランニング 3km」と重なっています');
  assert.equal(overlapWarning(items[2], items, [ev({ date: '2026-11-18' })], []), '「バイト」(17:00〜22:00)と重なっています');
  assert.equal(overlapWarning(items[2], items, [], [{ date: '2026-11-18', time: '18:30' }]), 'ほかのトレーニングと重なっています');
  assert.equal(overlapWarning(items[2], items, [], []), null);
  assert.equal(overlapWarning(items[3], items, [ev({ date: '2026-11-20', start: '06:00', end: '23:00' })], []), null); // 時刻なしは対象外
});

test('希望の時間帯に置けない日より、少しずらしてでも置ける日を選ぶ', () => {
  // 火曜始まり。水曜の夜はバイト。ラン2回の理想は水曜と日曜だが、水曜は夜に置けないので近い日の夜にする
  const items = place({ weeks: [week(0, [], [3, 3])], startDate: '2026-11-17', events: [ev({ date: '2026-11-18' })] });
  assert.ok(items.every((i) => i.warnings.length === 0), JSON.stringify(items.map((i) => [i.date, i.time, i.warnings])));
  assert.ok(items.every((i) => i.time === '19:00' && i.date !== '2026-11-18'));
});

test('途中から入れ直す: 実施済みの回と、過ぎた日・過ぎた週には置かない', () => {
  const weeks = [week(0, full, [3]), week(1, full, [3]), week(2, full, [3])];
  // 11/16 開始のプログラムを、11/25(第2週の水曜)に入れ直す。第2週の1回目は実施済み。
  const items = place({ weeks, minDate: '2026-11-25', skip: new Set(['1:s0']) });
  assert.ok(items.every((i) => i.date >= '2026-11-25'), items.map((i) => i.date).join(','));
  assert.ok(!items.some((i) => i.week === 0)); // 第1週はまるごと過ぎているので置かない
  const w1 = items.filter((i) => i.week === 1);
  assert.deepEqual(w1.filter((i) => i.kind === 'session').map((i) => i.index), [1, 2]); // 実施済みの1回目は置かない
  assert.ok(w1.every((i) => i.date <= '2026-11-29'));
  assert.equal(items.filter((i) => i.week === 2).length, 4);
  // 何も指定しなければ、これまでどおり全部置く
  assert.equal(place({ weeks }).length, 12);
});
