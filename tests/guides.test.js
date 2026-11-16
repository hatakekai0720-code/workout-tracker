import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MUSCLES, cleanMuscles } from '../js/logic/muscles.js';
import { mergeCatalog, CATEGORIES, EQUIPMENT, PLACES, LEVELS } from '../js/data/guides.js';
import { BODY_PARTS } from '../js/data/store.js';

const catalog = JSON.parse(readFileSync(new URL('../data/exercises.json', import.meta.url), 'utf8'));
const text = (v) => typeof v === 'string' && v.trim().length > 0;

// 器具カテゴリごとの、そろっているべき種目
const EXPECTED = {
  bodyweight: ['腕立て伏せ', 'ワイドプッシュアップ', 'ダイヤモンドプッシュアップ', 'パイクプッシュアップ', 'ベンチディップス', '自重スクワット',
    'ブルガリアンスクワット', 'ランジ', 'ヒップリフト', 'カーフレイズ', 'プランク', 'サイドプランク', 'クランチ', 'レッグレイズ', 'バーピー'],
  small: ['懸垂', 'チンアップ', 'ハンギングレッグレイズ', '腹筋ローラー', 'ケトルベルスイング'],
  dumbbell: ['ダンベルスクワット', 'ゴブレットスクワット', 'ダンベルルーマニアンデッドリフト', 'ダンベルランジ', 'ダンベルベンチプレス', 'ダンベルフライ',
    'ワンハンドロウ', 'ダンベルショルダープレス', 'サイドレイズ', 'リアレイズ', 'アームカール', 'ハンマーカール', 'フレンチプレス', 'キックバック', 'ダンベルシュラッグ'],
  barbell: ['バーベルスクワット', 'ベンチプレス', 'デッドリフト', 'ベントオーバーロウ', 'オーバーヘッドプレス', 'ルーマニアンデッドリフト', 'ヒップスラスト'],
  machine: ['ラットプルダウン', 'ケーブルシーテッドロウ', 'チェストプレス', 'ペックフライ', 'レッグプレス', 'レッグエクステンション', 'レッグカール', 'ケーブルプッシュダウン'],
  run: ['ランニング'],
};

for (const [category, names] of Object.entries(EXPECTED)) {
  test(`${CATEGORIES[category]} の種目がそろっている`, () => {
    const have = Object.values(catalog).filter((g) => g.category === category).map((g) => g.name);
    assert.deepEqual(have, names);
  });
}

for (const [slug, g] of Object.entries(catalog)) {
  test(`${slug}(${g.name}) の解説が必要な項目をそろえている`, () => {
    assert.match(slug, /^[a-z0-9_]+$/);
    assert.ok(text(g.name));
    // 種目マスタに入れる情報
    if (g.kind === 'run') assert.ok(g.bodyPart === null && g.loadType === null);
    else {
      assert.equal(g.kind, 'strength');
      assert.ok(g.bodyPart in BODY_PARTS);
      assert.ok(['weighted', 'bodyweight', 'timed'].includes(g.loadType));
    }
    // 器具・場所・難易度・代わりの種目
    assert.ok(g.category in CATEGORIES);
    for (const k of g.equipment) assert.ok(k in EQUIPMENT, `${k} は器具の一覧にない`);
    if (g.category === 'bodyweight') assert.deepEqual(g.equipment, []);
    else if (g.category !== 'run') assert.ok(g.equipment.length >= 1, '器具が必要な種目には equipment を入れる');
    assert.ok(g.place in PLACES && g.level in LEVELS);
    assert.ok(g.alternatives.length >= 1);
    for (const a of g.alternatives) {
      assert.ok(text(a.name));
      assert.notEqual(a.id, slug);
      // id つきの代替種目は、必ずカタログにあって名前も一致する(id なしは一覧にない種目で、名前だけ表示する)
      if (a.id) assert.equal(a.name, catalog[a.id]?.name, `代わりの種目 ${a.id} がカタログにない、または名前が違う`);
    }
    // 解説の本文
    assert.ok(g.muscles.main.length >= 1);
    for (const k of [...g.muscles.main, ...g.muscles.sub]) assert.ok(k in MUSCLES, `${k} は筋肉の一覧にない`);
    assert.deepEqual(cleanMuscles(g.muscles), g.muscles);
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

test('筋トレ50種目とランニングがそろっている', () => {
  const all = Object.values(catalog);
  assert.equal(all.filter((g) => g.kind === 'strength').length, 50);
  assert.equal(all.filter((g) => g.kind === 'run').length, 1);
  assert.deepEqual(Object.keys(EXPECTED), Object.keys(CATEGORIES)); // すべてのカテゴリを確かめている
});

test('種目名が重複していない', () => {
  const names = Object.values(catalog).map((g) => g.name);
  assert.equal(new Set(names).size, names.length);
});

// ---- 種目マスタとの統合 ----

const seed = () => [
  { id: 'ex_squat', name: 'ダンベルスクワット', kind: 'strength', bodyPart: 'legs', loadType: 'weighted', archived: false },
  { id: 'ex_row', name: 'ロウ', kind: 'strength', bodyPart: 'back', loadType: 'weighted', archived: false },
  { id: 'ex_pullup', name: '懸垂', kind: 'strength', bodyPart: 'back', loadType: 'bodyweight', archived: false },
  { id: 'ex_pushup', name: '腕立て伏せ', kind: 'strength', bodyPart: 'chest', loadType: 'bodyweight', archived: false },
  { id: 'ex_shoulder', name: 'ショルダープレス', kind: 'strength', bodyPart: 'shoulders', loadType: 'weighted', archived: false },
  { id: 'ex_plank', name: 'プランク', kind: 'strength', bodyPart: 'core', loadType: 'timed', archived: false },
  { id: 'ex_run', name: 'ランニング', kind: 'run', bodyPart: null, loadType: null, archived: false },
];

test('mergeCatalog: 以前からの種目は id を変えずに結びつけ、足りない種目を追加する', () => {
  const merged = mergeCatalog(seed(), catalog);
  const byId = Object.fromEntries(merged.map((x) => [x.id, x]));
  // id はそのまま(記録が引き継がれる)。名前はカタログにそろえる
  assert.equal(byId.ex_row.guideId, 'one_hand_row');
  assert.equal(byId.ex_row.name, 'ワンハンドロウ');
  assert.equal(byId.ex_shoulder.name, 'ダンベルショルダープレス');
  assert.equal(byId.ex_squat.guideId, 'db_squat');
  assert.equal(byId.ex_run.guideId, 'running');
  // カタログの全種目が1つずつ結びついている
  const linked = merged.map((x) => x.guideId).filter(Boolean);
  assert.deepEqual([...linked].sort(), Object.keys(catalog).sort());
  assert.equal(merged.length, Object.keys(catalog).length);
  assert.equal(new Set(merged.map((x) => x.id)).size, merged.length);
  const lunge = merged.find((x) => x.guideId === 'lunge');
  assert.deepEqual(lunge, { id: 'ex_lunge', name: 'ランジ', kind: 'strength', bodyPart: 'legs', loadType: 'bodyweight', guideId: 'lunge', archived: false });
});

test('mergeCatalog: 2回目は何も変えない', () => {
  const once = mergeCatalog(seed(), catalog);
  assert.equal(mergeCatalog(once, catalog), once);
});

test('mergeCatalog: 自分で変えた名前・メモ・自分で追加した種目は残す', () => {
  const mine = seed();
  mine[0] = { ...mine[0], name: 'スクワット', loadType: 'bodyweight', note: '膝を外に' }; // 自重に変えて使っていた
  mine[1] = { ...mine[1], name: 'ダンベルロー(右から)', archived: true };
  mine.push({ id: 'ex_abc123', name: 'アームカール(自作)', kind: 'strength', bodyPart: 'arms', loadType: 'weighted', archived: false, customGuide: { tips: 'ゆっくり' } });
  const merged = mergeCatalog(mine, catalog);
  const byId = Object.fromEntries(merged.map((x) => [x.id, x]));
  assert.equal(byId.ex_squat.name, 'スクワット');
  assert.equal(byId.ex_squat.guideId, 'bw_squat'); // 自重スクワットの解説に結びつく
  assert.equal(byId.ex_squat.note, '膝を外に');
  assert.equal(byId.ex_row.name, 'ダンベルロー(右から)');
  assert.equal(byId.ex_row.archived, true);
  assert.deepEqual(byId.ex_abc123, mine.at(-1));
  // 自重スクワットは重複して追加されず、ダンベルスクワットが新しく入る
  assert.equal(merged.filter((x) => x.guideId === 'bw_squat').length, 1);
  assert.equal(merged.find((x) => x.guideId === 'db_squat').id, 'ex_db_squat');
});

test('cleanMuscles', () => {
  assert.deepEqual(cleanMuscles(undefined), { main: [], sub: [] });
  assert.deepEqual(cleanMuscles({ main: ['abs', 'abs', 'x'], sub: ['abs', 'lats'] }), { main: ['abs'], sub: ['lats'] });
});

test('マネキンに、すべての筋肉のパーツがある', async () => {
  const { PARTS, silhouette } = await import('../js/mannequin/model.js');
  const have = new Set(PARTS.map((p) => p.muscle).filter(Boolean));
  for (const key of Object.keys(MUSCLES)) assert.ok(have.has(key), `${key} のパーツがない`);
  for (const key of have) assert.ok(key in MUSCLES, `${key} は筋肉の一覧にない`);
  // 左右対称: x を反転したパーツが必ずある
  for (const p of PARTS) {
    assert.ok(PARTS.some((q) => q.muscle === p.muscle && Math.abs(q.pos[0] + p.pos[0]) < 1e-9 && Math.abs(q.pos[1] - p.pos[1]) < 1e-9));
  }
  // 回転のないパーツは、そのままの楕円になる
  const head = PARTS[0];
  const s = silhouette(head);
  assert.ok(Math.abs(Math.max(s.rx, s.ry) - head.scale[1]) < 1e-9 && Math.abs(Math.min(s.rx, s.ry) - head.scale[0]) < 1e-9);
});
