import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MUSCLES, cleanMuscles } from '../js/muscles.js';

const guides = JSON.parse(readFileSync(new URL('../data/guides.json', import.meta.url), 'utf8'));
const INITIAL = ['ex_squat', 'ex_row', 'ex_pullup', 'ex_pushup', 'ex_shoulder', 'ex_plank', 'ex_run'];
const text = (v) => typeof v === 'string' && v.trim().length > 0;

test('初期の種目すべてに解説がある', () => {
  assert.deepEqual(Object.keys(guides).sort(), [...INITIAL].sort());
});

for (const id of INITIAL) {
  test(`${id} の解説が必要な項目をそろえている`, () => {
    const g = guides[id];
    assert.ok(text(g.title));
    assert.ok(g.muscles.main.length >= 1);
    for (const k of [...g.muscles.main, ...g.muscles.sub]) assert.ok(k in MUSCLES, `${k} は筋肉の一覧にない`);
    assert.deepEqual(cleanMuscles(g.muscles), g.muscles); // 重複やメイン・サブの重なりがない
    assert.ok(text(g.setup.equipment) && text(g.setup.start) && text(g.setup.width));
    assert.ok(g.steps.length >= 5 && g.steps.length <= 7 && g.steps.every(text));
    assert.ok(text(g.tempo) && text(g.breathing));
    assert.ok(g.tips.length >= 3 && g.tips.length <= 5 && g.tips.every(text));
    assert.ok(g.mistakes.length >= 3);
    for (const m of g.mistakes) assert.ok(text(m.mistake) && text(m.result) && text(m.fix));
    assert.ok(g.safety.stop.length >= 3 && g.safety.stop.every(text));
    assert.ok(g.safety.caution.length >= 2 && g.safety.caution.every(text));
    for (const lv of ['easier', 'basic', 'harder']) assert.ok(text(g.levels[lv].name) && text(g.levels[lv].desc));
    assert.ok(text(g.dosage.beginner) && text(g.dosage.intermediate) && text(g.dosage.rest));
  });
}

test('cleanMuscles', () => {
  assert.deepEqual(cleanMuscles(undefined), { main: [], sub: [] });
  assert.deepEqual(cleanMuscles({ main: ['abs', 'abs', 'x'], sub: ['abs', 'lats'] }), { main: ['abs'], sub: ['lats'] });
});
