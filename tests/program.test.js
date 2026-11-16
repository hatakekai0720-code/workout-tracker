import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateProgram, describe, swapOptions, autoLevel, estimateMinutes } from '../js/program.js';
import { mergeCatalog } from '../js/guides.js';

const catalog = JSON.parse(readFileSync(new URL('../data/exercises.json', import.meta.url), 'utf8'));
const exercises = mergeCatalog([], catalog); // カタログの全種目が入った種目マスタ
const exById = new Map(exercises.map((x) => [x.id, x]));
const guideFor = (ex) => catalog[ex.guideId] || null;
const name = (id) => exById.get(id).name;
const ALL = ['pullup_bar', 'ab_wheel', 'kettlebell', 'dumbbell', 'bench', 'barbell', 'rack', 'machine'];

const ctx = (entries = []) => ({ exercises, guideFor, entries, weightStepKg: 2.5, today: '2026-11-16' });
const config = (over = {}) => ({
  goal: 'hypertrophy', focus: [], avoid: [], weeks: 8, perWeek: 3, minutes: 60, equipment: ['dumbbell', 'pullup_bar'], gymSessions: 0,
  level: 'intermediate', excluded: [], run: { perWeek: 0, km: 0 }, timeOfDay: 'any', seed: 1, ...over,
});
const done = (date, exerciseId, weightKg, reps, extra = {}) => ({
  id: `${exerciseId}-${date}`, date, exerciseId, status: 'done', plan: { weightKg, reps: reps[0], sets: reps.length },
  actual: { sets: reps.map((r) => ({ weightKg, reps: r })) }, ...extra,
});

test('同じ入力なら同じメニュー、種を変えると別のメニューになる', () => {
  const a = generateProgram(config(), ctx());
  const b = generateProgram(config(), ctx());
  assert.deepEqual(a, b);
  const others = [2, 3, 4, 5].map((seed) => generateProgram(config({ seed }), ctx()));
  assert.ok(others.some((o) => JSON.stringify(o.templates) !== JSON.stringify(a.templates)));
});

test('週の回数で分け方が変わる', () => {
  const labels = (perWeek) => generateProgram(config({ perWeek }), ctx()).templates.map((t) => t.label);
  assert.deepEqual(labels(1), ['全身A']);
  assert.deepEqual(labels(3), ['全身A', '全身B', '全身C']);
  assert.deepEqual(labels(4), ['上半身A', '下半身A', '上半身B', '下半身B']);
  assert.deepEqual(labels(6), ['押す日A', '引く日A', '脚の日A', '押す日B', '引く日B', '脚の日B']);
  assert.equal(generateProgram(config({ perWeek: 5 }), ctx()).templates.length, 5);
});

test('使える器具・レベル・除外した種目を守る', () => {
  for (const seed of [1, 2, 3]) {
    const excluded = ['ex_db_squat', 'ex_pushup'];
    const p = generateProgram(config({ seed, level: 'beginner', equipment: ['dumbbell'], excluded }), ctx());
    for (const t of p.templates) {
      for (const it of t.items) {
        const g = guideFor(exById.get(it.exerciseId));
        assert.ok(g.equipment.every((k) => k === 'dumbbell'), `${g.name} は器具が足りない`);
        assert.equal(g.level, 'beginner', `${g.name} は初級ではない`);
        assert.ok(!excluded.includes(it.exerciseId));
      }
      assert.equal(new Set(t.items.map((it) => it.exerciseId)).size, t.items.length); // 同じ回に同じ種目は入らない
    }
  }
});

test('器具なしでも作れる。できる種目がない部位は理由に書く', () => {
  const p = generateProgram(config({ equipment: [], level: 'beginner' }), ctx());
  assert.ok(p.templates.every((t) => t.items.length >= 3));
  assert.ok(p.templates.every((t) => t.items.every((it) => guideFor(exById.get(it.exerciseId)).equipment.length === 0)));
  assert.equal(p.volume.back, undefined); // 自重だけでは背中の種目がない
  assert.ok(p.reasons.some((r) => r.includes('背中は、今の器具とレベルでできる種目がない')));
});

test('ジムの回だけ、ジムの器具の種目が入る', () => {
  const p = generateProgram(config({ perWeek: 4, equipment: [], gymSessions: 2, goal: 'strength' }), ctx());
  assert.deepEqual(p.templates.map((t) => t.gym), [true, true, false, false]);
  const usesGym = (t) => t.items.some((it) => guideFor(exById.get(it.exerciseId)).equipment.length > 0);
  assert.ok(usesGym(p.templates[0]) && usesGym(p.templates[1]));
  assert.ok(!usesGym(p.templates[2]) && !usesGym(p.templates[3]));
});

test('複数の関節を使う種目が先、単関節と体幹が後', () => {
  for (const perWeek of [2, 4, 6]) {
    for (const t of generateProgram(config({ perWeek, equipment: ALL }), ctx()).templates) {
      const kinds = t.items.map((it) => {
        const g = guideFor(exById.get(it.exerciseId));
        return g.pattern === 'core' ? 2 : g.compound ? 0 : 1;
      });
      assert.deepEqual(kinds, [...kinds].sort((a, b) => a - b), `${t.label}: ${t.items.map((it) => name(it.exerciseId)).join(' → ')}`);
    }
  }
});

test('1回の時間に収まる。短い時間では種目が減る', () => {
  for (const minutes of [30, 45, 60, 90]) {
    for (const goal of ['strength', 'hypertrophy', 'fitness']) {
      const p = generateProgram(config({ minutes, goal, equipment: ALL, perWeek: 3 }), ctx());
      for (const w of p.weeks) for (const s of w.sessions) assert.ok(s.minutes <= minutes + 2, `${goal} ${minutes}分: ${s.label} が ${s.minutes} 分`);
    }
  }
  const count = (minutes) => generateProgram(config({ minutes, equipment: ALL }), ctx()).templates.reduce((a, t) => a + t.items.length, 0);
  assert.ok(count(30) < count(90));
});

test('重点部位は週10〜20セット、それ以外は維持、鍛えない部位は入れない', () => {
  const p = generateProgram(config({ perWeek: 4, minutes: 60, equipment: ALL, focus: ['chest', 'back'], avoid: ['core'] }), ctx());
  assert.ok(p.volume.chest >= 10 && p.volume.chest <= 20, `胸 ${p.volume.chest}`);
  assert.ok(p.volume.back >= 10 && p.volume.back <= 20, `背中 ${p.volume.back}`);
  assert.ok(p.volume.legs <= 8 && p.volume.legs >= 2, `脚 ${p.volume.legs}`);
  assert.equal(p.volume.core, undefined);
  assert.ok(p.reasons.some((r) => r.includes('重点部位の週セット数')));
  assert.ok(p.reasons.some((r) => r.includes('体幹は「鍛えない」')));
  // 重点にしないときより、胸のセットが多い
  const plain = generateProgram(config({ perWeek: 4, minutes: 60, equipment: ALL }), ctx());
  assert.ok(p.volume.chest > plain.volume.chest);
});

test('目的ごとの回数と休憩', () => {
  const first = (goal, find) => {
    const p = generateProgram(config({ goal, equipment: ALL, perWeek: 3 }), ctx());
    return p.weeks[0].sessions.flatMap((s) => s.items).find((it) => find(exById.get(it.exerciseId), guideFor(exById.get(it.exerciseId))));
  };
  const heavy = (ex, g) => g.compound && ex.loadType === 'weighted';
  const s = first('strength', heavy);
  assert.deepEqual([s.reps, s.restSec], [5, 150]);
  const h = first('hypertrophy', heavy);
  assert.deepEqual([h.reps, h.restSec], [8, 90]);
  const f = first('fatloss', heavy);
  assert.deepEqual([f.reps, f.restSec], [12, 45]);
  // 筋力アップでも、自重の種目は 3〜6 回にしない
  const bw = first('strength', (ex) => ex.loadType === 'bodyweight');
  assert.ok(bw.reps >= 6);
  // プランクなどは秒
  const timed = first('hypertrophy', (ex) => ex.loadType === 'timed');
  if (timed) assert.equal(timed.unit, '秒');
});

test('週ごとに負荷を上げ、4週ごとに軽めの週を入れる', () => {
  const entries = [done('2026-11-10', 'ex_db_squat', 20, [10, 10, 10])];
  const p = generateProgram(config({ weeks: 8, equipment: ['dumbbell'], excluded: ['ex_goblet_squat', 'ex_db_lunge', 'ex_bw_squat', 'ex_lunge', 'ex_bulgarian_squat', 'ex_burpee'] }), ctx(entries));
  assert.deepEqual(p.weeks.map((w) => w.deload), [false, false, false, true, false, false, false, true]);
  const squat = p.weeks.map((w) => w.sessions.flatMap((s) => s.items).find((it) => it.exerciseId === 'ex_db_squat'));
  assert.ok(squat.every(Boolean), 'ダンベルスクワットが毎週入っている');
  assert.deepEqual(squat.slice(0, 3).map((it) => it.reps), [8, 10, 12]); // 3週かけて回数を上げる
  assert.ok(squat[3].sets < squat[2].sets && squat[3].weightKg < squat[2].weightKg && squat[3].reps === 8); // 軽めの週
  assert.equal(squat[4].weightKg, squat[0].weightKg + 2.5); // 次のブロックで重さを足す
  assert.equal(squat[4].reps, 8);
  // 4週未満なら軽めの週なし
  assert.ok(generateProgram(config({ weeks: 3 }), ctx()).weeks.every((w) => !w.deload));
  assert.ok(generateProgram(config({ weeks: 3 }), ctx()).reasons.some((r) => r.includes('期間が短いので')));
});

test('筋力アップの主要種目は、毎週重さを足す', () => {
  const entries = [done('2026-11-10', 'ex_bb_squat', 60, [5, 5, 5])];
  const p = generateProgram(config({ goal: 'strength', weeks: 4, perWeek: 3, equipment: ALL, excluded: exercises.filter((x) => x.bodyPart === 'legs' && x.id !== 'ex_bb_squat' && guideFor(x).pattern === 'squat').map((x) => x.id) }), ctx(entries));
  const w = p.weeks.map((wk) => wk.sessions.flatMap((s) => s.items).find((it) => it.exerciseId === 'ex_bb_squat').weightKg);
  assert.equal(w[1], w[0] + 2.5);
  assert.equal(w[2], w[0] + 5);
  assert.ok(w[3] < w[2]); // 4週目は軽め
});

test('最初の重さは記録から。RPE が高ければ控えめ、記録がなければ空欄', () => {
  const only = { equipment: ['dumbbell'], excluded: ['ex_goblet_squat', 'ex_db_lunge', 'ex_bw_squat', 'ex_lunge', 'ex_bulgarian_squat', 'ex_burpee'] };
  const start = (entries) => generateProgram(config(only), ctx(entries)).weeks[0].sessions.flatMap((s) => s.items).find((it) => it.exerciseId === 'ex_db_squat').weightKg;
  // 20kg×10回 → 推定1RM 26.7kg → 8回なら 21kg → 9割で 18.9 → 2.5kg きざみで切り捨て 17.5
  assert.equal(start([done('2026-11-10', 'ex_db_squat', 20, [10, 10, 10])]), 17.5);
  assert.equal(start([done('2026-11-10', 'ex_db_squat', 20, [10, 10, 10], { rpe: 10 })]), 17.5);
  assert.equal(start([done('2026-11-10', 'ex_db_squat', 30, [10, 10, 10], { rpe: 9 })]), 25); // 28.4 × 0.95 = 26.9 → 25
  assert.equal(start([done('2026-11-10', 'ex_db_squat', 30, [10, 10, 10])]), 27.5);
  assert.equal(start([done('2026-11-10', 'ex_db_squat', 30, [10, 10, 10], { rpe: 5 })]), 27.5); // 28.4 × 1.05 = 29.8 → 27.5
  assert.equal(start([]), null);
  const p = generateProgram(config(only), ctx([]));
  assert.ok(p.reasons.some((r) => r.includes('重さが空欄')));
});

test('ランニングを入れると、週ごとに少しずつ伸びる(+10%以内)', () => {
  const p = generateProgram(config({ run: { perWeek: 2, km: 3 }, weeks: 8 }), ctx());
  assert.deepEqual(p.weeks[0].runs, [3, 3]);
  for (let i = 1; i < 8; i++) {
    const [a, b] = [p.weeks[i - 1].runs[0], p.weeks[i].runs[0]];
    assert.ok(b <= a * 1.1 + 0.05, `${i + 1}週目: ${a} → ${b}`);
  }
  assert.ok(p.weeks[3].runs[0] < p.weeks[2].runs[0]); // 軽めの週は短く
  assert.deepEqual(generateProgram(config(), ctx()).weeks[0].runs, []);
});

test('種目の入れ替え候補は、同じ部位で使える種目だけ', () => {
  const c = config({ equipment: ['dumbbell'], level: 'beginner' });
  const p = generateProgram(c, ctx());
  const t = p.templates[0];
  const i = t.items.findIndex((it) => exById.get(it.exerciseId).bodyPart === 'legs');
  const options = swapOptions(p.templates, 0, i, c, ctx());
  assert.ok(options.length >= 2);
  for (const ex of options) {
    assert.equal(ex.bodyPart, 'legs');
    assert.ok(guideFor(ex).equipment.every((k) => k === 'dumbbell'));
    assert.ok(!t.items.some((it) => it.exerciseId === ex.id));
  }
  // 入れ替えたあとに作り直すと、週のメニューにも反映される
  t.items[i].exerciseId = options[0].id;
  const again = describe(p.templates, c, ctx());
  assert.ok(again.weeks.every((w) => w.sessions[0].items[i].exerciseId === options[0].id));
});

test('autoLevel: 記録のある週数で判定する', () => {
  assert.deepEqual(autoLevel([], exercises), { level: 'beginner', weeks: 0 });
  const weekly = (n) => Array.from({ length: n }, (_, i) => done(`2025-${String(1 + Math.floor(i / 4)).padStart(2, '0')}-${String(1 + (i % 4) * 7).padStart(2, '0')}`, 'ex_pushup', 0, [10]));
  assert.equal(autoLevel(weekly(11), exercises).level, 'beginner');
  assert.equal(autoLevel(weekly(20), exercises).level, 'intermediate');
});

test('estimateMinutes: セット数と休憩から時間を見積もる', () => {
  // 3セット ×(40秒 + 60秒) + 入れ替え60秒 = 6分。準備運動5分を足して 11 分
  assert.equal(estimateMinutes([{ exerciseId: 'ex_pushup', sets: 3, reps: 10, restSec: 60 }], exById), 11);
});

test('脚を「鍛えない」にすると、脚の日を上半身の日に置き換える', () => {
  const p = generateProgram(config({ perWeek: 6, avoid: ['legs'], equipment: ALL }), ctx());
  assert.deepEqual(p.templates.map((t) => t.label), ['押す日A', '引く日A', '上半身A', '押す日B', '引く日B', '上半身B']);
  assert.equal(p.volume.legs, undefined);
  assert.ok(p.templates.every((t) => t.items.length >= 3));
  assert.ok(p.reasons[0].includes('脚を鍛えない'));
});

test('ジムの回は、ジムにしかない器具の種目を優先する', () => {
  let gymOnly = 0;
  let total = 0;
  for (const seed of [1, 2, 3, 4]) {
    const p = generateProgram(config({ seed, perWeek: 3, equipment: ['dumbbell'], gymSessions: 3 }), ctx());
    for (const t of p.templates) for (const it of t.items) {
      total++;
      if (guideFor(exById.get(it.exerciseId)).equipment.some((k) => k !== 'dumbbell')) gymOnly++;
    }
  }
  assert.ok(gymOnly / total > 0.5, `ジムの器具の種目が ${gymOnly}/${total}`);
});

test('入れられる種目のない回は省いて、理由に書く', () => {
  // 上半身と体幹をすべて鍛えない + 週4回(上半身の日が空になる)
  const p = generateProgram(config({ perWeek: 4, avoid: ['chest', 'back', 'shoulders', 'arms'], equipment: ALL }), ctx());
  assert.deepEqual(p.templates.map((t) => t.label), ['下半身A', '下半身B']);
  assert.ok(p.reasons.some((r) => r.includes('省きました(週 2 回になります)')));
  assert.equal(p.weeks[0].sessions.length, 2);
});

test('初級でお尻を引く動きの種目が限られるときは、スクワットを重ねずにヒップリフトなどを入れる', () => {
  for (const seed of [1, 2, 3]) {
    const p = generateProgram(config({ seed, perWeek: 4, level: 'beginner', equipment: ['dumbbell'] }), ctx());
    for (const t of p.templates.filter((x) => x.label.startsWith('下半身'))) {
      const patterns = t.items.map((it) => guideFor(exById.get(it.exerciseId)).pattern);
      assert.ok(patterns.includes('squat') && patterns.includes('hinge'), `${t.label}: ${t.items.map((it) => name(it.exerciseId)).join(' / ')}`);
    }
  }
});

test('重点以外の日が短くなるときは、理由に書く', () => {
  const p = generateProgram(config({ perWeek: 4, minutes: 60, focus: ['chest'], equipment: ['dumbbell'], level: 'beginner' }), ctx());
  assert.ok(p.reasons.some((r) => r.includes('維持の量に抑えているため短め')), p.reasons.join(' / '));
});
