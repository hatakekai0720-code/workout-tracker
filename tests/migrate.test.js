import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, versionOf, SCHEMA_VERSION, MIGRATIONS } from '../js/data/migrate.js';

test('今の版のデータはそのまま(変換しない)', () => {
  const data = { schemaVersion: SCHEMA_VERSION, entries: [{ id: 'e1' }], exercises: [] };
  const m = migrate(data);
  assert.deepEqual([m.from, m.to, m.tooNew], [SCHEMA_VERSION, SCHEMA_VERSION, false]);
  assert.deepEqual(m.data, data);
  assert.notEqual(m.data, data); // 受け取ったものとは別のオブジェクト
});

test('版の番号がない・おかしいデータは版1として扱う', () => {
  assert.equal(versionOf({}), 1);
  assert.equal(versionOf({ schemaVersion: '2' }), 1);
  assert.equal(versionOf({ schemaVersion: 0 }), 1);
  assert.equal(versionOf(null), 1);
  assert.equal(versionOf({ schemaVersion: 3 }), 3);
});

test('古い版から順番に変換し、受け取ったデータは変えない', () => {
  // 例: 版1→2 で bodyLogs の名前を変え、版2→3 で新しい項目を足す
  const steps = {
    1: (d) => {
      d.bodyLogs = d.weights;
      delete d.weights;
      return d;
    },
    2: (d) => ({ ...d, goals: [] }),
  };
  const old = { schemaVersion: 1, entries: [], exercises: [], weights: [{ date: '2026-11-01', weightKg: 60 }] };
  const before = structuredClone(old);
  const m = migrate(old, steps, 3);
  assert.deepEqual([m.from, m.to, m.tooNew], [1, 3, false]);
  assert.deepEqual(m.data, { schemaVersion: 3, entries: [], exercises: [], bodyLogs: [{ date: '2026-11-01', weightKg: 60 }], goals: [] });
  assert.deepEqual(old, before);
  // 途中の版からも変換できる
  assert.deepEqual(migrate({ schemaVersion: 2, entries: [] }, steps, 3).data, { schemaVersion: 3, entries: [], goals: [] });
});

test('アプリより新しい版のデータは変換しない', () => {
  const data = { schemaVersion: SCHEMA_VERSION + 1, entries: [] };
  const m = migrate(data);
  assert.equal(m.tooNew, true);
  assert.equal(m.data, data);
  assert.equal(m.from, SCHEMA_VERSION + 1);
});

test('変換が抜けていれば止める(版を上げたのに変換を書き忘れたとき)', () => {
  assert.throws(() => migrate({ schemaVersion: 1 }, { 1: (d) => d }, 3), /版2から版3/);
});

test('MIGRATIONS には、版1から今の版までの変換がすべてそろっている', () => {
  for (let v = 1; v < SCHEMA_VERSION; v++) assert.equal(typeof MIGRATIONS[v], 'function', `版${v}→${v + 1} の変換がありません`);
  assert.ok(Object.keys(MIGRATIONS).every((k) => Number(k) >= 1 && Number(k) < SCHEMA_VERSION), '今の版より先の変換があります');
});
