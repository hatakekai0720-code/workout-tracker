// バックアップ JSON の検証。受け取ったものをそのまま信用せず、必要な項目だけ作り直す。
import { BODY_PARTS } from './store.js';
import { cleanMuscles } from './muscles.js';
import { CUSTOM_FIELDS } from './guides.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const LOAD_TYPES = ['weighted', 'bodyweight', 'timed'];
const SCHEMA_VERSION = 1;
const MAX_TEXT = 4000;

class Invalid extends Error {}
const fail = (msg) => {
  throw new Invalid(msg);
};
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, min = 0) => typeof v === 'number' && Number.isFinite(v) && v >= min;
const int = (v, min = 0) => Number.isInteger(v) && v >= min;
const numOrNull = (v) => (num(v, 0) && v > 0 ? v : null);

function exercise(x, seen) {
  if (!isObj(x) || !ID.test(x.id) || seen.has(x.id)) fail('種目のデータが正しくありません');
  if (typeof x.name !== 'string' || !x.name.trim() || x.name.length > 40) fail('種目名が正しくありません');
  seen.add(x.id);
  const base = { id: x.id, name: x.name.trim(), archived: x.archived === true };
  // 任意の項目: 効く筋肉、自分用メモ、自分で書いた解説
  if (isObj(x.muscles)) base.muscles = cleanMuscles(x.muscles);
  if (typeof x.note === 'string' && x.note) base.note = x.note.slice(0, MAX_TEXT);
  if (isObj(x.customGuide)) {
    const custom = {};
    for (const [key] of CUSTOM_FIELDS) {
      if (typeof x.customGuide[key] === 'string' && x.customGuide[key]) custom[key] = x.customGuide[key].slice(0, MAX_TEXT);
    }
    if (Object.keys(custom).length) base.customGuide = custom;
  }
  if (x.kind === 'run') return { ...base, kind: 'run', bodyPart: null, loadType: null };
  if (x.kind !== 'strength' || !(x.bodyPart in BODY_PARTS) || !LOAD_TYPES.includes(x.loadType)) {
    fail(`種目「${base.name}」の設定が正しくありません`);
  }
  return { ...base, kind: 'strength', bodyPart: x.bodyPart, loadType: x.loadType };
}

function entry(e, exById, seen) {
  if (!isObj(e) || !ID.test(e.id) || seen.has(e.id) || !DATE.test(e.date)) fail('記録のデータが正しくありません');
  seen.add(e.id);
  const ex = exById.get(e.exerciseId);
  if (!ex) fail('種目マスタにない種目の記録が含まれています');
  if (e.status !== 'planned' && e.status !== 'done') fail('記録の状態が正しくありません');
  const done = e.status === 'done';
  const bad = () => fail(`${e.date} の「${ex.name}」の記録が正しくありません`);
  let plan;
  let actual = null;
  if (ex.kind === 'run') {
    const run = (r, needTime) => {
      if (!isObj(r) || !(num(r.distanceKm) && r.distanceKm > 0)) bad();
      const dur = r.durationSec == null ? null : r.durationSec;
      if (dur !== null && !(num(dur) && dur > 0)) bad();
      if (needTime && dur === null) bad();
      return { distanceKm: r.distanceKm, durationSec: dur };
    };
    plan = run(e.plan, false);
    if (done) actual = run(e.actual, true);
  } else {
    const p = e.plan;
    if (!isObj(p) || !num(p.weightKg) || !int(p.reps, 1) || !int(p.sets, 1)) bad();
    plan = { weightKg: p.weightKg, reps: p.reps, sets: p.sets };
    if (done) {
      const sets = e.actual?.sets;
      if (!Array.isArray(sets) || !sets.length) bad();
      actual = {
        sets: sets.map((s) => {
          if (!isObj(s) || !num(s.weightKg) || !int(s.reps, 0)) bad();
          return { weightKg: s.weightKg, reps: s.reps };
        }),
      };
    }
  }
  return {
    id: e.id,
    date: e.date,
    exerciseId: e.exerciseId,
    status: e.status,
    plan,
    actual,
    memo: typeof e.memo === 'string' ? e.memo.slice(0, 1000) : '',
  };
}

function bodyLog(l, seen) {
  if (!isObj(l) || !DATE.test(l.date) || seen.has(l.date) || !(num(l.weightKg) && l.weightKg > 0)) {
    fail('体重の記録が正しくありません');
  }
  seen.add(l.date);
  return { date: l.date, weightKg: l.weightKg, bodyFatPct: numOrNull(l.bodyFatPct) };
}

// 成功なら { state }、失敗なら { error }(利用者に見せる文)。
export function parseBackup(text, today) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: 'JSON として読み込めませんでした。バックアップのファイルか確認してください' };
  }
  try {
    if (!isObj(raw) || !Array.isArray(raw.exercises) || !Array.isArray(raw.entries)) {
      fail('このアプリのバックアップではないようです');
    }
    if (!int(raw.schemaVersion, 1)) fail('バックアップの形式を判別できません');
    if (raw.schemaVersion > SCHEMA_VERSION) fail('新しいバージョンで作られたバックアップです。アプリを更新してください');

    const exIds = new Set();
    const exercises = raw.exercises.map((x) => exercise(x, exIds));
    if (!exercises.some((x) => !x.archived)) fail('使える種目が1つもありません');
    const exById = new Map(exercises.map((x) => [x.id, x]));
    const entryIds = new Set();
    const entries = raw.entries.map((e) => entry(e, exById, entryIds));
    const logDates = new Set();
    const bodyLogs = (Array.isArray(raw.bodyLogs) ? raw.bodyLogs : [])
      .map((l) => bodyLog(l, logDates))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    const p = isObj(raw.profile) ? raw.profile : {};
    const s = isObj(raw.settings) ? raw.settings : {};
    return {
      state: {
        schemaVersion: SCHEMA_VERSION,
        profile: { heightCm: numOrNull(p.heightCm), targetWeightKg: numOrNull(p.targetWeightKg) },
        settings: {
          theme: ['auto', 'light', 'dark'].includes(s.theme) ? s.theme : 'auto',
          timerPresets: [60, 90, 120],
          timerCustomSec: int(s.timerCustomSec, 5) && s.timerCustomSec <= 3600 ? s.timerCustomSec : null,
          weightStepKg: num(s.weightStepKg) && s.weightStepKg > 0 ? s.weightStepKg : 2.5,
          lastBackupAt: today, // 読み込んだファイル自体が最新のバックアップ
        },
        exercises,
        entries,
        bodyLogs,
      },
    };
  } catch (err) {
    if (err instanceof Invalid) return { error: err.message };
    throw err;
  }
}
