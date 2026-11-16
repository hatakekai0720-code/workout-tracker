// バックアップ JSON の検証。受け取ったものをそのまま信用せず、必要な項目だけ作り直す。
import { BODY_PARTS } from './store.js';
import { cleanMuscles } from './muscles.js';
import { CUSTOM_FIELDS, EQUIPMENT } from './guides.js';
import { GOALS, TIMES_OF_DAY, SLOT_KEYS } from './program.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const LOAD_TYPES = ['weighted', 'bodyweight', 'timed'];
const SCHEMA_VERSION = 1;
const MAX_TEXT = 4000;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const END_TIME = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/;
const EVENT_KINDS = ['school', 'work', 'other'];
const FREQS = ['daily', 'weekdays', 'weekly', 'biweekly', 'monthlyDate', 'monthlyNth'];

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
  if (typeof x.guideId === 'string' && ID.test(x.guideId)) base.guideId = x.guideId;
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
  const out = {
    id: e.id,
    date: e.date,
    exerciseId: e.exerciseId,
    status: e.status,
    plan,
    actual,
    memo: typeof e.memo === 'string' ? e.memo.slice(0, 1000) : '',
  };
  // 任意の項目: 開始時刻と所要時間
  if (typeof e.time === 'string' && TIME.test(e.time)) out.time = e.time;
  if (int(e.durationMin, 5) && e.durationMin <= 600) out.durationMin = e.durationMin;
  if (int(e.rpe, 1) && e.rpe <= 10) out.rpe = e.rpe; // きつさ(1〜10)
  // プログラムから登録した記録の印(どのプログラムの、どの回か)
  if (typeof e.programId === 'string' && ID.test(e.programId)) out.programId = e.programId;
  if (typeof e.sessionKey === 'string' && /^[A-Za-z0-9_:-]{1,80}$/.test(e.sessionKey)) out.sessionKey = e.sessionKey;
  if (typeof e.sessionLabel === 'string' && e.sessionLabel) out.sessionLabel = e.sessionLabel.slice(0, 30);
  return out;
}

// 予定の時間帯。開始 < 終了であること。
function timeRange(x, what) {
  if (typeof x.start !== 'string' || typeof x.end !== 'string' || !TIME.test(x.start) || !END_TIME.test(x.end) || x.start >= x.end) {
    fail(`${what}の時間が正しくありません`);
  }
  return { start: x.start, end: x.end };
}

const title = (x, what) => {
  if (typeof x.title !== 'string' || !x.title.trim() || x.title.length > 60) fail(`${what}の名前が正しくありません`);
  return x.title.trim();
};
const kind = (x) => (EVENT_KINDS.includes(x.kind) ? x.kind : 'other');

function event(x, seen, termIds) {
  if (!isObj(x) || !ID.test(x.id) || seen.has(x.id) || !DATE.test(x.date)) fail('予定のデータが正しくありません');
  seen.add(x.id);
  let repeat = null;
  if (x.repeat != null) {
    const r = x.repeat;
    if (!isObj(r) || !FREQS.includes(r.freq)) fail('予定の繰り返しが正しくありません');
    repeat = {
      freq: r.freq,
      days: [...new Set(Array.isArray(r.days) ? r.days : [])].filter((d) => int(d, 0) && d <= 6),
      until: typeof r.until === 'string' && DATE.test(r.until) ? r.until : null,
      count: int(r.count, 1) && r.count <= 1000 ? r.count : null,
    };
  }
  const exceptions = {};
  for (const [d, ex] of Object.entries(isObj(x.exceptions) ? x.exceptions : {})) {
    if (!DATE.test(d) || !isObj(ex)) fail('予定の例外が正しくありません');
    exceptions[d] = ex.skip === true ? { skip: true } : timeRange(ex, '予定の例外');
  }
  return {
    id: x.id,
    title: title(x, '予定'),
    kind: kind(x),
    date: x.date,
    ...timeRange(x, '予定'),
    repeat,
    exceptions,
    termId: typeof x.termId === 'string' && termIds.has(x.termId) ? x.termId : null,
  };
}

function template(x, seen) {
  if (!isObj(x) || !ID.test(x.id) || seen.has(x.id)) fail('予定のテンプレートが正しくありません');
  seen.add(x.id);
  return { id: x.id, title: title(x, 'テンプレート'), kind: kind(x), ...timeRange(x, 'テンプレート') };
}

function term(x, seen) {
  if (!isObj(x) || !ID.test(x.id) || seen.has(x.id) || !DATE.test(x.from) || !DATE.test(x.to) || x.from > x.to) fail('学期のデータが正しくありません');
  if (typeof x.name !== 'string' || !x.name.trim() || x.name.length > 40) fail('学期の名前が正しくありません');
  seen.add(x.id);
  return { id: x.id, name: x.name.trim(), from: x.from, to: x.to };
}

function bodyLog(l, seen) {
  if (!isObj(l) || !DATE.test(l.date) || seen.has(l.date) || !(num(l.weightKg) && l.weightKg > 0)) {
    fail('体重の記録が正しくありません');
  }
  seen.add(l.date);
  return { date: l.date, weightKg: l.weightKg, bodyFatPct: numOrNull(l.bodyFatPct) };
}

// 保存したプログラム。形がおかしければ、プログラムだけ捨てる(記録の復元は続ける)。
function program(x, exById) {
  if (!isObj(x) || !isObj(x.config) || !Array.isArray(x.templates)) return null;
  const c = x.config;
  const parts = (list) => [...new Set(Array.isArray(list) ? list : [])].filter((p) => p in BODY_PARTS);
  const ok =
    ID.test(x.id) && c.goal in GOALS && int(c.weeks, 1) && c.weeks <= 52 && int(c.perWeek, 1) && c.perWeek <= 6 &&
    [30, 45, 60, 90].includes(c.minutes) && ['beginner', 'intermediate', 'advanced'].includes(c.level);
  if (!ok) return null;
  const templates = [];
  for (const t of x.templates) {
    if (!isObj(t) || typeof t.key !== 'string' || !ID.test(t.key) || typeof t.label !== 'string' || !Array.isArray(t.items)) return null;
    const items = [];
    for (const it of t.items) {
      if (!isObj(it) || !exById.has(it.exerciseId) || !SLOT_KEYS.includes(it.slot) || !int(it.sets, 1) || it.sets > 10) return null;
      items.push({ slot: it.slot, exerciseId: it.exerciseId, sets: it.sets });
    }
    templates.push({ key: t.key, label: t.label.slice(0, 20), gym: t.gym === true, items });
  }
  const run = isObj(c.run) ? c.run : {};
  return {
    id: x.id,
    name: typeof x.name === 'string' ? x.name.slice(0, 60) : 'プログラム',
    createdAt: typeof x.createdAt === 'string' && DATE.test(x.createdAt) ? x.createdAt : null,
    config: {
      goal: c.goal,
      focus: parts(c.focus),
      avoid: parts(c.avoid),
      weeks: c.weeks,
      perWeek: c.perWeek,
      minutes: c.minutes,
      equipment: [...new Set(Array.isArray(c.equipment) ? c.equipment : [])].filter((k) => k in EQUIPMENT),
      gymSessions: int(c.gymSessions, 0) ? Math.min(c.gymSessions, c.perWeek) : 0,
      level: c.level,
      excluded: [...new Set(Array.isArray(c.excluded) ? c.excluded : [])].filter((id) => exById.has(id)),
      run: { perWeek: int(run.perWeek, 0) ? Math.min(run.perWeek, 6) : 0, km: num(run.km) && run.km <= 100 ? run.km : 0 },
      timeOfDay: c.timeOfDay in TIMES_OF_DAY ? c.timeOfDay : 'any',
      ...(c.separateRun === true ? { separateRun: true } : {}), // 任意。ランを筋トレと別の日にする
      seed: int(c.seed, 0) ? c.seed : 0,
    },
    templates,
    // 日程に入れたときの開始日
    schedule: isObj(x.schedule) && typeof x.schedule.startDate === 'string' && DATE.test(x.schedule.startDate) ? { startDate: x.schedule.startDate } : null,
  };
}

const DEFAULT_TEMPLATES = [
  { id: 'tpl_early', title: '早番', kind: 'work', start: '09:00', end: '15:00' },
  { id: 'tpl_late', title: '遅番', kind: 'work', start: '17:00', end: '22:00' },
];

// 活動できる時間帯。不正なら既定の 6:00〜23:00。
function dayRange(s) {
  const ok = typeof s.dayStart === 'string' && typeof s.dayEnd === 'string' && TIME.test(s.dayStart) && END_TIME.test(s.dayEnd) && s.dayStart < s.dayEnd;
  return ok ? { dayStart: s.dayStart, dayEnd: s.dayEnd } : { dayStart: '06:00', dayEnd: '23:00' };
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

    // スケジュール。項目がない古いバックアップでは空になる(テンプレートは初期の2件)。
    const termSeen = new Set();
    const terms = (Array.isArray(raw.terms) ? raw.terms : []).map((x) => term(x, termSeen));
    const eventSeen = new Set();
    const events = (Array.isArray(raw.events) ? raw.events : []).map((x) => event(x, eventSeen, termSeen));
    const tplSeen = new Set();
    const eventTemplates = Array.isArray(raw.eventTemplates) ? raw.eventTemplates.map((x) => template(x, tplSeen)) : DEFAULT_TEMPLATES;

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
          timeStepMin: [60, 30, 15].includes(s.timeStepMin) ? s.timeStepMin : 60,
          ...dayRange(s),
          // 持っている器具(絞り込みを使っていなければ null)
          ownedEquipment: Array.isArray(s.ownedEquipment) ? [...new Set(s.ownedEquipment)].filter((k) => k in EQUIPMENT) : null,
        },
        exercises,
        entries,
        bodyLogs,
        events,
        eventTemplates,
        terms,
        program: program(raw.program, exById),
      },
    };
  } catch (err) {
    if (err instanceof Invalid) return { error: err.message };
    throw err;
  }
}
