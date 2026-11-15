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
    settings: { theme: 'auto', timerPresets: [60, 90, 120], timerCustomSec: null, weightStepKg: 2.5 },
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
        state = { ...defaultState(), ...parsed };
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
