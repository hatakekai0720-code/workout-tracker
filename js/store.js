// データの読み書き。端末内の localStorage に JSON 1 個で保存する。
//
// entries の形:
//   筋トレ: plan { weightKg, reps, sets } / actual { sets: [{ weightKg, reps }] }
//           loadType が timed の種目では reps に「秒」を入れる。
//   ラン  : plan { distanceKm, durationSec|null } / actual { distanceKm, durationSec }
// ペース・1RM などの計算で出せる値は保存しない。

const KEY = 'workoutTracker.data';
const SCHEMA_VERSION = 1;

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
    settings: { theme: 'auto', timerPresets: [60, 90, 120], timerCustomSec: null, weightStepKg: 2.5, lastBackupAt: null, ownedEquipment: null },
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
  };
}

let state = null;

export function initStore() {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.entries) && Array.isArray(parsed.exercises)) {
        const base = defaultState();
        state = { ...base, ...parsed, settings: { ...base.settings, ...parsed.settings } };
        // 集計は日付の昇順を前提にしている
        state.bodyLogs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        return;
      }
      throw new Error('unexpected shape');
    } catch {
      // 壊れたデータは上書きせず退避しておく
      localStorage.setItem(`${KEY}.corrupt.${Date.now()}`, raw);
    }
  }
  state = defaultState();
}

function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export const getState = () => state;
export const getExercise = (id) => state.exercises.find((x) => x.id === id);
export const getEntry = (id) => state.entries.find((e) => e.id === id);

const newId = () => `e_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

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
