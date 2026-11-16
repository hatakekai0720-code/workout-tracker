import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weeklyMuscleSets, heatColor, exercisesForMuscle, bestView, HEAT_LEGEND, recoveryStatus } from '../js/logic/musclemap.js';

const EX = [
  { id: 'push', kind: 'strength', archived: false, m: { main: ['chest', 'triceps'], sub: ['deltFront'] } },
  { id: 'dips', kind: 'strength', archived: false, m: { main: ['triceps'], sub: ['chest'] } },
  { id: 'bench', kind: 'strength', archived: false, m: { main: ['chest'], sub: ['triceps'] } },
  { id: 'old', kind: 'strength', archived: true, m: { main: ['chest'], sub: [] } },
  { id: 'run', kind: 'run', archived: false, m: { main: ['quads'], sub: ['abs'] } },
  { id: 'none', kind: 'strength', archived: false, m: { main: [], sub: [] } },
];
const musclesOf = (ex) => ex.m;
const lift = (date, id, reps, status = 'done') => ({ date, exerciseId: id, status, actual: status === 'done' ? { sets: reps.map((r) => ({ weightKg: 0, reps: r })) } : null });

test('weeklyMuscleSets: 今週の実施分だけを、メインとサブに分けて数える', () => {
  const entries = [
    lift('2026-11-08', 'push', [10, 10, 10]), // 先週(日曜)
    lift('2026-11-09', 'push', [10, 10, 0]), // 0回のセットは数えない → 2
    lift('2026-11-11', 'dips', [8, 8, 8]),
    lift('2026-11-12', 'push', [10], 'planned'),
    { date: '2026-11-13', exerciseId: 'run', status: 'done', actual: { distanceKm: 5, durationSec: 1800 } },
    lift('2026-11-14', 'none', [5, 5]),
    lift('2026-11-16', 'push', [10, 10, 10]), // 来週
  ];
  const w = weeklyMuscleSets(entries, EX, musclesOf, '2026-11-15');
  assert.deepEqual(w.chest, { main: 2, sub: 3, score: 3.5 });
  assert.deepEqual(w.triceps, { main: 5, sub: 0, score: 5 });
  assert.deepEqual(w.deltFront, { main: 0, sub: 2, score: 1 });
  assert.deepEqual(w.quads, { main: 3, sub: 0, score: 3 }); // ラン1回 = 3セット相当
  assert.deepEqual(w.abs, { main: 0, sub: 3, score: 1.5 });
  assert.equal(w.lats, undefined);
});

test('heatColor: 0 は色なし、多いほど濃く、上限で止まる', () => {
  assert.equal(heatColor(0), null);
  assert.equal(heatColor(undefined), null);
  const lum = (hex) => [1, 3, 5].reduce((a, i) => a + parseInt(hex.slice(i, i + 2), 16), 0);
  assert.ok(lum(heatColor(1)) > lum(heatColor(5)) && lum(heatColor(5)) > lum(heatColor(10)));
  assert.equal(heatColor(10), '#b3261e');
  assert.equal(heatColor(40), heatColor(10));
  assert.equal(HEAT_LEGEND.to, '#b3261e');
  assert.match(heatColor(3), /^#[0-9a-f]{6}$/);
});

test('exercisesForMuscle: メインとサブに分け、できる種目を先に並べる', () => {
  const all = exercisesForMuscle(EX, musclesOf, 'chest');
  assert.deepEqual(all.main.map((x) => x.id), ['push', 'bench']); // 非表示の old は出さない
  assert.deepEqual(all.sub.map((x) => x.id), ['dips']);
  // ベンチがなくて bench ができない場合は後ろへ
  const t = exercisesForMuscle(EX, musclesOf, 'triceps', (x) => x.id !== 'push');
  assert.deepEqual(t.main.map((x) => x.id), ['dips', 'push']);
  assert.deepEqual(t.sub.map((x) => x.id), ['bench']);
  assert.deepEqual(exercisesForMuscle(EX, musclesOf, 'calves'), { main: [], sub: [] });
});

test('bestView: 光る筋肉が多い側から見せる', () => {
  assert.equal(bestView({ main: ['lats'], sub: ['biceps', 'forearms'] }), 'front'); // 2 対 2 は前
  assert.equal(bestView({ main: ['lats', 'traps'], sub: ['biceps'] }), 'back');
  assert.equal(bestView({ main: ['chest'], sub: ['triceps'] }), 'front');
  assert.equal(bestView({ main: ['glutes', 'hamstrings'], sub: ['erectors', 'abs'] }), 'back');
  assert.equal(bestView({ main: [], sub: [] }), 'front');
});

test('recoveryStatus: 最後にメインで鍛えてからの時間で3段階に分ける', () => {
  const now = new Date(2026, 10, 16, 12, 0).getTime(); // 11/16 正午
  const entries = [
    lift('2026-11-15', 'push', [10]), // 24時間前 → 胸・三頭は休ませる
    { ...lift('2026-11-14', 'dips', [8]), time: '08:00' }, // 52時間前だが、三頭は push のほうが新しい
    { ...lift('2026-11-14', 'bench', [8]), time: '06:00' }, // 胸は push のほうが新しい
    { date: '2026-11-13', exerciseId: 'run', status: 'done', actual: { distanceKm: 5, durationSec: 1800 } }, // 72時間前 → 回復済み
    lift('2026-11-01', 'none', [5]),
    lift('2026-11-16', 'push', [10], 'planned'), // 予定は数えない
  ];
  const r = recoveryStatus(entries, EX, musclesOf, now);
  assert.deepEqual([r.chest.status, Math.round(r.chest.hours)], ['rest', 24]);
  assert.equal(r.triceps.status, 'rest');
  assert.deepEqual([r.quads.status, Math.round(r.quads.hours)], ['ready', 72]);
  assert.equal(r.deltFront, undefined); // サブで効いただけの筋肉は数えない
  // 52時間前だけなら「もう少し」
  assert.equal(recoveryStatus([entries[1]], EX, musclesOf, now).triceps.status, 'soon');
  // 1週間より前は色を付けない
  assert.deepEqual(recoveryStatus([lift('2026-11-08', 'push', [10])], EX, musclesOf, now), {});
});

test('recoveryStatus: 境目(ちょうど48時間・72時間・7日)と、数えない記録', () => {
  const now = new Date(2026, 10, 16, 12, 0).getTime(); // 11/16 正午
  const one = (date, time, id = 'bench', status = 'done') => recoveryStatus([{ ...lift(date, id, [8], status), ...(time ? { time } : {}) }], EX, musclesOf, now);
  assert.equal(one('2026-11-14', '12:01').chest.status, 'rest'); // 47時間59分 → 休ませる
  assert.equal(one('2026-11-14', null).chest.status, 'soon'); // 時刻なしは正午 → ちょうど48時間で「もう少し」
  assert.equal(one('2026-11-13', '12:01').chest.status, 'soon'); // 71時間59分
  assert.equal(one('2026-11-13', '12:00').chest.status, 'ready'); // ちょうど72時間で回復済み
  assert.equal(one('2026-11-09', '12:00').chest.status, 'ready'); // ちょうど7日はまだ出す
  assert.deepEqual(one('2026-11-09', '11:59'), {}); // 7日を過ぎたら出さない
  assert.deepEqual(one('2026-11-16', '13:00'), {}); // これからの時刻の記録は数えない
  assert.deepEqual(one('2026-11-16', '08:00', 'bench', 'planned'), {}); // 予定は数えない
  assert.deepEqual(one('2026-11-16', '08:00', 'gone'), {}); // 種目マスタにない記録は数えない
  assert.deepEqual(one('2026-11-16', '08:00', 'none'), {}); // 効く筋肉が決まっていない種目
  assert.ok(Math.abs(one('2026-11-16', '09:30').chest.hours - 2.5) < 1e-9);
});
