import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initStore, getState, setSettings, upsertEntry, getAutoBackups, readAutoBackupText, autoBackupNow, replaceState } from '../js/data/store.js';
import { listAutoBackups } from '../js/data/autobackup.js';
import { SCHEMA_VERSION } from '../js/data/migrate.js';
import { MemoryStorage } from './memory-storage.js';

const KEY = 'workoutTracker.data';
const at = (d, h = 9) => new Date(2026, 10, d, h, 0).getTime();
const saved = (over = {}) => ({
  schemaVersion: 1,
  profile: { heightCm: 170, targetWeightKg: null },
  settings: { theme: 'dark' },
  exercises: [{ id: 'ex_run', name: 'ランニング', kind: 'run', bodyPart: null, loadType: null, archived: false }],
  entries: [{ id: 'e1', date: '2026-11-10', exerciseId: 'ex_run', status: 'planned', plan: { distanceKm: 3, durationSec: null }, actual: null }],
  bodyLogs: [{ date: '2026-11-11', weightKg: 60 }, { date: '2026-11-10', weightKg: 61 }],
  ...over,
});
const fresh = (data, quota) => {
  globalThis.localStorage = new MemoryStorage(quota);
  if (data !== undefined) localStorage.setItem(KEY, typeof data === 'string' ? data : JSON.stringify(data));
};

test('はじめて開いたとき: 最初のデータで始め、自動バックアップは取らない(守るデータがない)', () => {
  fresh();
  const r = initStore({ nowMs: at(16) });
  assert.deepEqual(r, { autoBackup: null, migratedFrom: null, tooNew: false });
  assert.equal(getState().schemaVersion, SCHEMA_VERSION);
  assert.ok(getState().exercises.length > 0);
  assert.equal(getAutoBackups().length, 0);
});

test('保存データを読み、足りない設定は最初の値で埋め、体の記録を日付順にする', () => {
  fresh(saved());
  initStore({ nowMs: at(16) });
  const s = getState();
  assert.equal(s.settings.theme, 'dark');
  assert.equal(s.settings.timeStepMin, 60); // 古いデータにない設定
  assert.deepEqual(s.events, []); // 古いデータにない項目
  assert.deepEqual(s.bodyLogs.map((l) => l.date), ['2026-11-10', '2026-11-11']);
});

test('起動時の自動バックアップ: 1日1回、読み込んだままの形で取る', () => {
  const data = saved();
  fresh(data);
  assert.equal(initStore({ nowMs: at(16, 8) }).autoBackup, 'daily');
  const [b] = getAutoBackups();
  assert.deepEqual([b.reason, b.counts], ['daily', { entries: 1, bodyLogs: 2, events: 0 }]);
  assert.deepEqual(JSON.parse(readAutoBackupText(b.key)), data); // 並べ替え前の、保存されていたままの形
  // 同じ日にもう一度開いても増えない
  assert.equal(initStore({ nowMs: at(16, 22) }).autoBackup, null);
  assert.equal(getAutoBackups().length, 1);
  // 4日続けて開くと、直近3日分が残る
  for (const d of [17, 18, 19]) initStore({ nowMs: at(d) });
  assert.deepEqual(listAutoBackups(localStorage).map((x) => new Date(x.at).getDate()), [19, 18, 17]);
});

test('記録の変更は自動バックアップに影響しない(本体だけ書き換わる)', () => {
  fresh(saved());
  initStore({ nowMs: at(16) });
  setSettings({ theme: 'light' });
  assert.equal(JSON.parse(localStorage.getItem(KEY)).settings.theme, 'light');
  assert.equal(JSON.parse(readAutoBackupText(getAutoBackups()[0].key)).settings.theme, 'dark');
});

test('壊れたデータは消さずに退避し、最初のデータで始める', () => {
  fresh('{ broken');
  const r = initStore({ nowMs: at(16) });
  assert.equal(r.autoBackup, null);
  const stash = [...localStorage.map.keys()].find((k) => k.startsWith(`${KEY}.corrupt.`));
  assert.equal(localStorage.getItem(stash), '{ broken');
  assert.equal(getState().entries.length, 0);
});

test('アプリより新しい版のデータは、版を書き換えずにそのまま読む', () => {
  fresh(saved({ schemaVersion: SCHEMA_VERSION + 1, future: [1] }));
  const r = initStore({ nowMs: at(16) });
  assert.equal(r.tooNew, true);
  assert.equal(r.migratedFrom, null);
  assert.equal(getState().schemaVersion, SCHEMA_VERSION + 1);
  assert.deepEqual(getState().future, [1]); // 知らない項目も消さない
  assert.equal(getAutoBackups()[0].reason, 'daily');
});

test('容量が足りないときは、古い自動バックアップを消して記録の保存を優先する', () => {
  fresh(saved());
  initStore({ nowMs: at(15) });
  initStore({ nowMs: at(16) });
  assert.equal(getAutoBackups().length, 2);
  setSettings({}); // 本体を今の形で保存し直しておく(最初のデータで埋めた分だけ大きくなる)
  // 今の使用量に、記録を1件足した分の半分くらいしか空きがない状態にする
  const used = [...localStorage.map].reduce((a, [k, v]) => a + k.length + v.length, 0);
  const entry = { date: '2026-11-17', exerciseId: 'ex_run', status: 'planned', plan: { distanceKm: 5, durationSec: null }, actual: null, memo: 'x'.repeat(300) };
  const grow = JSON.stringify(entry).length + 30;
  localStorage.quota = used + Math.floor(grow / 2);
  upsertEntry(entry);
  assert.equal(JSON.parse(localStorage.getItem(KEY)).entries.length, 2); // 保存できている
  assert.equal(getAutoBackups().length, 1); // いちばん古い15日の分だけ消した
  assert.equal(new Date(getAutoBackups()[0].at).getDate(), 16);
});

test('復元の前に、今のデータを自動バックアップに残せる', () => {
  fresh(saved());
  initStore({ nowMs: at(16) });
  upsertEntry({ date: '2026-11-18', exerciseId: 'ex_run', status: 'planned', plan: { distanceKm: 5, durationSec: null }, actual: null, memo: '' });
  assert.equal(autoBackupNow('restore'), true);
  const [b] = getAutoBackups();
  assert.deepEqual([b.reason, b.counts.entries], ['restore', 2]);
  replaceState({ ...getState(), entries: [] });
  assert.equal(JSON.parse(readAutoBackupText(b.key)).entries.length, 2);
});

test('applyWorkoutSaves: 予定を実施済みにし、途中で入れ替えた種目は元の予定を写して足す', async () => {
  const { applyWorkoutSaves } = await import('../js/data/store.js');
  fresh(saved({
    exercises: [
      { id: 'a', name: 'A', kind: 'strength', bodyPart: 'chest', loadType: 'weighted', archived: false },
      { id: 'b', name: 'B', kind: 'strength', bodyPart: 'chest', loadType: 'weighted', archived: false },
    ],
    entries: [{ id: 'e1', date: '2026-11-16', time: '18:00', exerciseId: 'a', status: 'planned', plan: { weightKg: 20, reps: 10, sets: 3 }, actual: null, memo: 'm', programId: 'p1', sessionKey: 'p1:0:s0' }],
  }));
  initStore({ nowMs: at(16) });
  const ids = applyWorkoutSaves([
    { entryId: 'e1', exerciseId: 'a', patch: { status: 'done', actual: { sets: [{ weightKg: 20, reps: 10, rir: 2 }] }, doneAt: 'x', plan: { weightKg: 20, reps: 10, sets: 1 } } },
    { entryId: null, originEntryId: 'e1', exerciseId: 'b', patch: { status: 'done', exerciseId: 'b', swappedFrom: 'a', plan: { weightKg: 10, reps: 10, sets: 2 }, actual: { sets: [{ weightKg: 10, reps: 10 }] }, doneAt: 'x' } },
    { entryId: 'gone', exerciseId: 'a', patch: { status: 'done' } },
  ]);
  const s = getState();
  assert.equal(ids.size, 2);
  assert.equal(s.entries[0].status, 'done');
  const added = s.entries[1];
  assert.equal(added.exerciseId, 'b');
  assert.equal(added.sessionKey, 'p1:0:s0');
  assert.equal(added.time, '18:00');
  assert.equal(added.date, '2026-11-16');
  assert.equal(added.memo, '');
  assert.notEqual(added.id, 'e1');
  assert.deepEqual(JSON.parse(localStorage.getItem(KEY)).entries.length, 2);
});
