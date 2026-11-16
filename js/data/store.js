// データの読み書き。端末内の localStorage に JSON 1 個で保存する。
//
// entries の形:
//   筋トレ: plan { weightKg, reps, sets } / actual { sets: [{ weightKg, reps }] }
//           loadType が timed の種目では reps に「秒」を入れる。
//   ラン  : plan { distanceKm, durationSec|null } / actual { distanceKm, durationSec }
//   任意  : time 'HH:MM'(開始時刻)、durationMin(所要時間)
// events(バイト・学校などの予定)の形は js/schedule.js を参照。
// ペース・1RM などの計算で出せる値は保存しない。

import { SCHEMA_VERSION, migrate } from './migrate.js';
import { listAutoBackups, readAutoBackup, saveAutoBackup, needsDailyBackup, dropOldestAutoBackup } from './autobackup.js';

const KEY = 'workoutTracker.data';

export const BODY_PARTS = {
  chest: '胸',
  back: '背中',
  legs: '脚',
  shoulders: '肩',
  arms: '腕',
  core: '体幹',
};

function defaultState() {
  const ex = (id, name, kind, bodyPart, loadType) => ({ id, name, kind, bodyPart, loadType, archived: false });
  return {
    schemaVersion: SCHEMA_VERSION,
    profile: { heightCm: null, targetWeightKg: null },
    settings: { theme: 'auto', timerPresets: [60, 90, 120], timerCustomSec: null, weightStepKg: 2.5, lastBackupAt: null, ownedEquipment: null, timeStepMin: 60, dayStart: '06:00', dayEnd: '23:00', restSec: 90, autoReschedule: 'auto' },
    exercises: [
      ex('ex_squat', 'ダンベルスクワット', 'strength', 'legs', 'weighted'),
      ex('ex_row', 'ロウ', 'strength', 'back', 'weighted'),
      ex('ex_pullup', '懸垂', 'strength', 'back', 'bodyweight'),
      ex('ex_pushup', '腕立て伏せ', 'strength', 'chest', 'bodyweight'),
      ex('ex_shoulder', 'ショルダープレス', 'strength', 'shoulders', 'weighted'),
      ex('ex_plank', 'プランク', 'strength', 'core', 'timed'),
      ex('ex_run', 'ランニング', 'run', null, null),
    ],
    entries: [],
    bodyLogs: [],
    events: [],
    eventTemplates: [
      { id: 'tpl_early', title: '早番', kind: 'work', start: '09:00', end: '15:00' },
      { id: 'tpl_late', title: '遅番', kind: 'work', start: '17:00', end: '22:00' },
    ],
    terms: [],
    program: null, // 自動メニュー作成で保存したプログラム(1つだけ)。形は js/program.js を参照
  };
}

let state = null;

// 起動時に読み込む。返り値: { autoBackup: 取った自動バックアップの理由 | null, migratedFrom: 変換前の版 | null, tooNew }
//   1. 1日1回、読み込んだままの形で自動バックアップを取る
//   2. 古い版のデータなら、変換の前にもう1つ自動バックアップを取ってから、最新の形に変換して保存する
//   3. このアプリより新しい版のデータは、変換も版の書き換えもせずに読む(項目は足す形でしか変えないので、たいてい読める)
export function initStore({ nowMs = Date.now() } = {}) {
  const result = { autoBackup: null, migratedFrom: null, tooNew: false };
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.entries) && Array.isArray(parsed.exercises)) {
        if (needsDailyBackup(listAutoBackups(localStorage), nowMs) && saveAutoBackup(localStorage, raw, { nowMs, reason: 'daily' })) {
          result.autoBackup = 'daily';
        }
        const m = migrate(parsed);
        result.tooNew = m.tooNew;
        if (m.from < m.to) {
          if (result.autoBackup !== 'daily' && saveAutoBackup(localStorage, raw, { nowMs, reason: 'migrate' })) result.autoBackup = 'migrate';
          result.migratedFrom = m.from;
        }
        const base = defaultState();
        state = { ...base, ...m.data, settings: { ...base.settings, ...m.data.settings } };
        // 集計は日付の昇順を前提にしている
        state.bodyLogs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        if (result.migratedFrom !== null) save();
        return result;
      }
      throw new Error('unexpected shape');
    } catch {
      // 壊れたデータは上書きせず退避しておく
      localStorage.setItem(`${KEY}.corrupt.${Date.now()}`, raw);
    }
  }
  state = defaultState();
  return result;
}

// 保存する。端末の容量が足りないときは、古い自動バックアップから消して保存し直す(記録の保存を優先する)。
function save() {
  const json = JSON.stringify(state);
  for (;;) {
    try {
      localStorage.setItem(KEY, json);
      return;
    } catch (err) {
      if (!dropOldestAutoBackup(localStorage)) throw err;
    }
  }
}

// ---- 自動バックアップ(js/autobackup.js) ----

// 新しい順。[{ key, at, reason, counts: { entries, bodyLogs, events } | null }]
export function getAutoBackups() {
  return listAutoBackups(localStorage).map((b) => {
    let counts = null;
    try {
      const d = JSON.parse(readAutoBackup(localStorage, b.key));
      counts = { entries: d.entries?.length ?? 0, bodyLogs: d.bodyLogs?.length ?? 0, events: d.events?.length ?? 0 };
    } catch {
      // 読めないものは件数なしで出す(戻すときに検証で止まる)
    }
    return { ...b, counts };
  });
}

export const readAutoBackupText = (key) => readAutoBackup(localStorage, key);

// 今のデータを自動バックアップに1つ足す(復元の前など)
export const autoBackupNow = (reason) => saveAutoBackup(localStorage, JSON.stringify(state), { reason });

export const getState = () => state;
export const getExercise = (id) => state.exercises.find((x) => x.id === id);
export const getEntry = (id) => state.entries.find((e) => e.id === id);

export const makeId = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const newId = () => makeId('e');

export function upsertEntry(entry) {
  const saved = entry.id ? entry : { ...entry, id: newId() };
  const i = state.entries.findIndex((e) => e.id === saved.id);
  if (i >= 0) state.entries[i] = saved;
  else state.entries.push(saved);
  save();
  return saved.id;
}

export function deleteEntry(id) {
  state.entries = state.entries.filter((e) => e.id !== id);
  save();
}

// ---- プロフィール・体の記録 ----

export function setProfile(patch) {
  Object.assign(state.profile, patch);
  save();
}

export const getBodyLog = (date) => state.bodyLogs.find((l) => l.date === date);

// 1日1件。同じ日付は上書きし、日付の昇順を保つ。
export function upsertBodyLog(log) {
  state.bodyLogs = state.bodyLogs.filter((l) => l.date !== log.date);
  state.bodyLogs.push(log);
  state.bodyLogs.sort((a, b) => (a.date < b.date ? -1 : 1));
  save();
}

export function deleteBodyLog(date) {
  state.bodyLogs = state.bodyLogs.filter((l) => l.date !== date);
  save();
}

// ---- 設定・種目マスタ・バックアップ ----

export function setSettings(patch) {
  Object.assign(state.settings, patch);
  save();
}

export const exerciseInUse = (id) => state.entries.some((e) => e.exerciseId === id);

export function saveExercise(ex) {
  const i = state.exercises.findIndex((x) => x.id === ex.id);
  if (i >= 0) state.exercises[i] = ex;
  else state.exercises.push({ ...ex, id: `ex_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` });
  save();
}

// 記録のある種目は消さずに archived にすること(呼び出し側で判定する)
export function deleteExercise(id) {
  state.exercises = state.exercises.filter((x) => x.id !== id);
  save();
}

export function exportJson() {
  return JSON.stringify({ app: 'workout-tracker', exportedAt: new Date().toISOString(), ...state }, null, 2);
}

// 検証済みのバックアップ(backup.js の parseBackup の結果)で丸ごと置き換える
export function replaceState(next) {
  state = next;
  save();
}

// 種目マスタを丸ごと差し替える(カタログとの統合用)
export function setExercises(list) {
  state.exercises = list;
  save();
}

// ---- スケジュール(予定・テンプレート・学期) ----

export function setEvents(list) {
  state.events = list;
  save();
}

export function saveTemplate(tpl) {
  state.eventTemplates = [...state.eventTemplates.filter((t) => t.id !== tpl.id), tpl];
  save();
}

export function deleteTemplate(id) {
  state.eventTemplates = state.eventTemplates.filter((t) => t.id !== id);
  save();
}

export function addTerm(term, events) {
  state.terms = [...state.terms, term];
  state.events = [...state.events, ...events];
  save();
}

// 学期を消すと、その学期の時間割から作った予定も消える
export function deleteTerm(id) {
  state.terms = state.terms.filter((t) => t.id !== id);
  state.events = state.events.filter((e) => e.termId !== id);
  save();
}

// ---- プログラム(自動メニュー作成) ----

export function setProgram(program) {
  state.program = program;
  save();
}

// 複数の記録をまとめて追加する(プログラムを日程に入れるとき)
export function addEntries(list) {
  for (const e of list) state.entries.push({ ...e, id: newId() });
  save();
}

// プログラムから登録した記録のうち、まだ実施していない分を消す。消した件数を返す。
export function removeProgramEntries(programId) {
  const before = state.entries.length;
  state.entries = state.entries.filter((e) => !(e.programId === programId && e.status === 'planned'));
  save();
  return before - state.entries.length;
}

// トレーニング中モードの結果を書き込む(js/logic/workout.js の finishWorkout の saves)。
// entryId のあるものは更新し、ないもの(途中で入れ替えた種目)は元の予定の日時・プログラムの印を写して足す。
// 返り値: 書き込んだ記録の id の集合
export function applyWorkoutSaves(saves) {
  const ids = new Set();
  for (const s of saves) {
    if (s.entryId) {
      const e = state.entries.find((x) => x.id === s.entryId);
      if (!e) continue;
      Object.assign(e, s.patch);
      ids.add(e.id);
      continue;
    }
    const origin = state.entries.find((x) => x.id === s.originEntryId);
    const { id, actual, rpe, memo, swappedFrom, doneAt, ...keep } = origin || {};
    const added = { ...keep, date: origin?.date, memo: '', ...s.patch, exerciseId: s.exerciseId, id: newId() };
    state.entries.push(added);
    ids.add(added.id);
  }
  save();
  return ids;
}

// ---- 振り替え(js/logic/reschedule.js) ----

// 1回ぶんずつ日時を動かす。moves: [{ sessionKey, fromDate, toDate, toTime, durationMin }](元に戻すときは from/to を入れ替えて渡す)
export function applySessionMoves(moves) {
  for (const m of moves) {
    for (const e of state.entries) {
      if (e.sessionKey !== m.sessionKey || e.date !== m.fromDate || e.status !== 'planned') continue;
      e.date = m.toDate;
      if (m.toTime) {
        e.time = m.toTime;
        if (m.durationMin) e.durationMin = m.durationMin;
      } else {
        delete e.time;
        delete e.durationMin;
      }
    }
  }
  save();
}

// 未実施の予定を「休んだ(sick)」「スキップ(skip)」にする
export function markSkipped(ids, reason) {
  const set = new Set(ids);
  for (const e of state.entries) {
    if (!set.has(e.id) || e.status !== 'planned') continue;
    e.status = 'skipped';
    e.skipReason = reason;
  }
  save();
}

// 予定を軽くする。元の予定は basePlan に残す(すでに軽くしてあれば、元の予定は最初のまま)。
// changes: [{ id, plan }]。返り値: 変えた記録の id
export function adjustPlans(changes, reason) {
  const ids = [];
  for (const c of changes) {
    const e = state.entries.find((x) => x.id === c.id);
    if (!e || e.status !== 'planned') continue;
    e.basePlan ??= e.plan;
    e.plan = c.plan;
    e.adjustReason = reason;
    ids.push(e.id);
  }
  save();
  return ids;
}

// 軽くした予定を元に戻す
export function restorePlans(ids) {
  const set = new Set(ids);
  for (const e of state.entries) {
    if (!set.has(e.id) || !e.basePlan) continue;
    e.plan = e.basePlan;
    delete e.basePlan;
    delete e.adjustReason;
  }
  save();
}

// プログラムの1回ぶん(同じ sessionKey で同じ日の記録)を、まとめて別の日時に動かす
export function moveSession(sessionKey, fromDate, date, time) {
  for (const e of state.entries) {
    if (e.sessionKey !== sessionKey || e.date !== fromDate || e.status !== 'planned') continue;
    e.date = date;
    if (time) e.time = time;
    else {
      delete e.time;
      delete e.durationMin;
    }
  }
  save();
}
