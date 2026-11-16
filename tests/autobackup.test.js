import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listAutoBackups, saveAutoBackup, readAutoBackup, needsDailyBackup, dropOldestAutoBackup, AUTO_BACKUP_MAX } from '../js/autobackup.js';
import { MemoryStorage } from './memory-storage.js';

const at = (d, h = 9) => new Date(2026, 10, d, h, 0).getTime(); // 2026年11月d日 h時

test('保存すると新しい順に並び、直近3つだけ残る', () => {
  const s = new MemoryStorage();
  s.setItem('workoutTracker.data', '{}'); // 本体のデータには触れない
  for (let d = 1; d <= 5; d++) assert.equal(saveAutoBackup(s, `data${d}`, { nowMs: at(d) }), true);
  const list = listAutoBackups(s);
  assert.equal(AUTO_BACKUP_MAX, 3);
  assert.deepEqual(list.map((b) => readAutoBackup(s, b.key)), ['data5', 'data4', 'data3']);
  assert.deepEqual(list.map((b) => b.reason), ['daily', 'daily', 'daily']);
  assert.equal(s.getItem('workoutTracker.data'), '{}');
  assert.equal(s.length, 4);
});

test('理由を残す。同じ時刻に2つ取っても重ならない', () => {
  const s = new MemoryStorage();
  saveAutoBackup(s, 'a', { nowMs: at(1), reason: 'daily' });
  saveAutoBackup(s, 'b', { nowMs: at(1), reason: 'migrate' });
  const list = listAutoBackups(s);
  assert.deepEqual(list.map((b) => [b.reason, readAutoBackup(s, b.key)]), [['migrate', 'b'], ['daily', 'a']]);
});

test('関係のないキーや、形のおかしいキーは数えない', () => {
  const s = new MemoryStorage();
  s.setItem('workoutTracker.data.corrupt.123', 'x');
  s.setItem('workoutTracker.autoBackup.abc.daily', 'x');
  s.setItem('workoutTracker.autoBackup.123.unknown', 'x');
  assert.deepEqual(listAutoBackups(s), []);
  assert.equal(readAutoBackup(s, 'workoutTracker.data'), null); // 自動バックアップ以外は読ませない
});

test('1日1回: その日の分がなければ取る', () => {
  const s = new MemoryStorage();
  assert.equal(needsDailyBackup(listAutoBackups(s), at(16, 8)), true);
  saveAutoBackup(s, 'x', { nowMs: at(16, 8) });
  assert.equal(needsDailyBackup(listAutoBackups(s), at(16, 23)), false); // 同じ日のあとで開いても取らない
  assert.equal(needsDailyBackup(listAutoBackups(s), at(17, 0)), true); // 日付が変われば取る
});

test('容量が足りないときは、古い自動バックアップから消して入れる', () => {
  const s = new MemoryStorage(200);
  const key = 'workoutTracker.autoBackup.'.length + 20; // キーの長さのおよそ
  const big = 'x'.repeat(200 / 2 - key);
  assert.equal(saveAutoBackup(s, big, { nowMs: at(1) }), true);
  assert.equal(saveAutoBackup(s, big, { nowMs: at(2) }), true); // 2つ目で満杯近く
  assert.equal(saveAutoBackup(s, big, { nowMs: at(3) }), true); // 入らないので、いちばん古い1日の分を消す
  assert.deepEqual(listAutoBackups(s).map((b) => b.at), [at(3), at(2)]);
  // どうしても入らないものは保存せず false(ほかのものも消し切る)
  assert.equal(saveAutoBackup(s, 'y'.repeat(500), { nowMs: at(4) }), false);
});

test('いちばん古いものを1つ消す', () => {
  const s = new MemoryStorage();
  assert.equal(dropOldestAutoBackup(s), false);
  saveAutoBackup(s, 'a', { nowMs: at(1) });
  saveAutoBackup(s, 'b', { nowMs: at(2) });
  assert.equal(dropOldestAutoBackup(s), true);
  assert.deepEqual(listAutoBackups(s).map((b) => readAutoBackup(s, b.key)), ['b']);
});
