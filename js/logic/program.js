// 自動メニュー作成(プログラム)。ルールだけで組み立てる。DOM や保存先には触れない。
//
// 入力 config:
//   { goal, focus: [部位], avoid: [部位], weeks, perWeek, minutes, equipment: [器具], gymSessions,
//     level, excluded: [種目id], run: { perWeek, km }, timeOfDay, seed }
// 文脈 ctx: { exercises: 種目マスタ, guideFor: 種目 → カタログの情報, entries: 記録, weightStepKg, today }
import { dayNumber, weekStart } from './dates.js';
import { epley1RM } from './training.js';

export const GOALS = { hypertrophy: '筋肥大', strength: '筋力アップ', fatloss: '減量', fitness: '体力づくり' };
export const TIMES_OF_DAY = { morning: '朝', noon: '昼', night: '夜', any: 'こだわらない' };
export const PART_LABELS = { chest: '胸', back: '背中', legs: '脚', shoulders: '肩', arms: '腕', core: '体幹' };
const LEVEL_RANK = { beginner: 0, intermediate: 1, advanced: 2 };
export const ALL_EQUIPMENT = ['pullup_bar', 'ab_wheel', 'kettlebell', 'dumbbell', 'bench', 'barbell', 'rack', 'machine'];

// 筋肉マップの筋肉 → 重点部位に使う部位
export const MUSCLE_PART = {
  chest: 'chest',
  deltFront: 'shoulders', deltSide: 'shoulders', deltRear: 'shoulders',
  biceps: 'arms', triceps: 'arms', forearms: 'arms',
  abs: 'core', obliques: 'core',
  traps: 'back', lats: 'back', erectors: 'back',
  glutes: 'legs', quads: 'legs', hamstrings: 'legs', calves: 'legs',
};

// 目的ごとの回数・セット・休憩。compound = 複数の関節を使う種目。
const SCHEMES = {
  strength: { compound: { reps: [3, 6], sets: 4, rest: 150 }, other: { reps: [6, 10], sets: 3, rest: 90 }, text: '重い重さで 3〜6 回、休憩は長め(2〜3分)' },
  hypertrophy: { compound: { reps: [8, 12], sets: 3, rest: 90 }, other: { reps: [8, 12], sets: 3, rest: 60 }, text: '8〜12 回、休憩 60〜90 秒' },
  fatloss: { compound: { reps: [12, 15], sets: 3, rest: 45 }, other: { reps: [12, 15], sets: 3, rest: 45 }, text: '12〜15 回、休憩は短め(45 秒)で動き続ける' },
  fitness: { compound: { reps: [12, 20], sets: 3, rest: 45 }, other: { reps: [12, 20], sets: 3, rest: 30 }, text: '12〜20 回、休憩は短め(30〜45 秒)' },
};
const FOCUS_WEEKLY = [10, 20]; // 重点部位の週セット数
const KEEP_WEEKLY_MAX = 12; // それ以外(維持)の上限
const MAX_SETS = 5;
const WORK_SEC = 40; // 1セットの動作時間の見積もり
const SWITCH_SEC = 60; // 種目の入れ替えにかかる時間
const WARMUP_SEC = 300;
const BLOCK = 4; // 3週かけて負荷を上げ、4週目を軽めの週にする

// ---- メニューの型(どの部位を、どの順で入れるか) ----

// 枠: 部位と条件。muscle はメインで効く筋肉の指定。
const SLOTS = {
  squat: { part: 'legs', pattern: 'squat', compound: true },
  hinge: { part: 'legs', pattern: 'hinge', compound: true },
  legIso: { part: 'legs', compound: false },
  chest: { part: 'chest', compound: true },
  chestIso: { part: 'chest', compound: false },
  backV: { part: 'back', compound: true, muscle: 'lats' },
  backH: { part: 'back', compound: true, muscle: 'traps' },
  backIso: { part: 'back', compound: false },
  shoulders: { part: 'shoulders', compound: true },
  sideDelt: { part: 'shoulders', compound: false, muscle: 'deltSide' },
  rearDelt: { part: 'shoulders', compound: false, muscle: 'deltRear' },
  biceps: { part: 'arms', muscle: 'biceps' },
  triceps: { part: 'arms', muscle: 'triceps' },
  core: { part: 'core' },
};

export const SLOT_KEYS = Object.keys(SLOTS);

const TEMPLATES = {
  fullA: { label: '全身A', slots: ['squat', 'chest', 'backH', 'shoulders', 'core', 'biceps', 'triceps'] },
  fullB: { label: '全身B', slots: ['hinge', 'backV', 'chest', 'sideDelt', 'core', 'triceps', 'biceps'] },
  fullC: { label: '全身C', slots: ['squat', 'backH', 'shoulders', 'chest', 'core', 'legIso'] },
  upperA: { label: '上半身A', slots: ['chest', 'backH', 'shoulders', 'backV', 'triceps', 'biceps'] },
  upperB: { label: '上半身B', slots: ['backV', 'chest', 'sideDelt', 'backH', 'biceps', 'triceps', 'chestIso'] },
  lowerA: { label: '下半身A', slots: ['squat', 'hinge', 'legIso', 'core'] },
  lowerB: { label: '下半身B', slots: ['hinge', 'squat', 'legIso', 'core'] },
  pushA: { label: '押す日A', slots: ['chest', 'shoulders', 'chestIso', 'sideDelt', 'triceps'] },
  pushB: { label: '押す日B', slots: ['shoulders', 'chest', 'sideDelt', 'triceps', 'chestIso'] },
  pullA: { label: '引く日A', slots: ['backV', 'backH', 'rearDelt', 'biceps', 'backIso'] },
  pullB: { label: '引く日B', slots: ['backH', 'backV', 'biceps', 'rearDelt', 'backIso'] },
  legsA: { label: '脚の日A', slots: ['squat', 'hinge', 'legIso', 'core'] },
  legsB: { label: '脚の日B', slots: ['hinge', 'squat', 'legIso', 'core'] },
};

// 週の回数 → 分け方
const SPLITS = {
  1: { keys: ['fullA'], text: '週1回なので、毎回全身を鍛えます' },
  2: { keys: ['fullA', 'fullB'], text: '週2回なので、毎回全身を鍛えます(種目を変えた2種類)' },
  3: { keys: ['fullA', 'fullB', 'fullC'], text: '週3回なので、毎回全身を鍛えます(種目を変えた3種類)' },
  4: { keys: ['upperA', 'lowerA', 'upperB', 'lowerB'], text: '週4回なので、上半身と下半身に分けて2回ずつ鍛えます' },
  5: { keys: ['pushA', 'pullA', 'legsA', 'upperB', 'lowerB'], text: '週5回なので、押す・引く・脚の3日に、上半身・下半身の2日を足します' },
  6: { keys: ['pushA', 'pullA', 'legsA', 'pushB', 'pullB', 'legsB'], text: '週6回なので、押す・引く・脚を2周します' },
};

// 脚を「鍛えない」にしたときは、脚の日・下半身の日を上半身の日に置き換える
const SPLITS_NO_LEGS = {
  4: { keys: ['pushA', 'pullA', 'pushB', 'pullB'], text: '週4回で脚を鍛えないので、押す日と引く日を2回ずつにします' },
  5: { keys: ['pushA', 'pullA', 'upperA', 'pushB', 'pullB'], text: '週5回で脚を鍛えないので、押す日・引く日を2回ずつと、上半身の日を1回にします' },
  6: { keys: ['pushA', 'pullA', 'upperA', 'pushB', 'pullB', 'upperB'], text: '週6回で脚を鍛えないので、押す日・引く日・上半身の日を2周します' },
};
const splitFor = (config) => (config.avoid.includes('legs') && SPLITS_NO_LEGS[config.perWeek]) || SPLITS[config.perWeek];

// ---- 小さな道具 ----

// 種(seed)から決まる乱数。「作り直す」で種を変えると、別の候補になる。
function random(seed) {
  let a = (seed >>> 0) + 0x9e3779b9;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const roundTo = (n, step) => Math.round(n / step) * step;
const floorTo = (n, step) => Math.floor(n / step + 1e-9) * step;

function schemeFor(config, ex, g) {
  const s = SCHEMES[config.goal];
  // 筋力アップでも、重りを使わない種目は少ない回数にできないので 6〜10 回にする
  const heavy = g.compound && ex.loadType === 'weighted';
  return config.goal === 'strength' && !heavy ? s.other : g.compound ? s.compound : s.other;
}

const itemSeconds = (sets, rest, ex, reps) => sets * ((ex.loadType === 'timed' ? reps : WORK_SEC) + rest) + SWITCH_SEC;

// 1回のメニューにかかる時間(分)。準備運動の5分を含む。
export function estimateMinutes(items, exById) {
  const sec = items.reduce((a, it) => a + itemSeconds(it.sets, it.restSec, exById.get(it.exerciseId), it.reps), WARMUP_SEC);
  return Math.round(sec / 60);
}

// 記録のある週数からレベルを判定する(12週未満は初級、1年未満は中級)
export function autoLevel(entries, exercises) {
  const strength = new Set(exercises.filter((x) => x.kind === 'strength').map((x) => x.id));
  const weeks = new Set(entries.filter((e) => e.status === 'done' && strength.has(e.exerciseId)).map((e) => weekStart(e.date)));
  return { level: weeks.size < 12 ? 'beginner' : weeks.size < 52 ? 'intermediate' : 'advanced', weeks: weeks.size };
}

// ---- 種目選び ----

// 枠に入れられる種目。条件を少しずつゆるめて、最初に見つかった段階の候補を返す。
function candidates(slot, gym, config, ctx) {
  const equip = new Set(gym ? ALL_EQUIPMENT : config.equipment);
  const base = ctx.exercises.filter((ex) => {
    const g = ctx.guideFor(ex);
    return (
      g && !ex.archived && ex.kind === 'strength' && !config.excluded.includes(ex.id) &&
      LEVEL_RANK[g.level] <= LEVEL_RANK[config.level] && g.equipment.every((k) => equip.has(k))
    );
  });
  const partOk = (ex, g) => (slot.pattern === 'hinge' && g.pattern === 'hinge' && g.compound ? true : ex.bodyPart === slot.part);
  const muscleOk = (g) => !slot.muscle || g.muscles.main.includes(slot.muscle);
  const tests = [
    (ex, g) => partOk(ex, g) && (slot.compound === undefined || g.compound === slot.compound) && (!slot.pattern || g.pattern === slot.pattern) && muscleOk(g),
    // 動きの種類が決まっている枠(しゃがむ・お尻を引く)は、単関節でも同じ動きの種目を先に探す
    (ex, g) => !!slot.pattern && ex.bodyPart === slot.part && g.pattern === slot.pattern,
    (ex, g) => ex.bodyPart === slot.part && (slot.compound === undefined || g.compound === slot.compound) && muscleOk(g),
    (ex, g) => ex.bodyPart === slot.part && (muscleOk(g) || g.muscles.sub.includes(slot.muscle)),
    (ex) => ex.bodyPart === slot.part && !slot.muscle, // 筋肉の指定がある枠(二頭・三頭など)は、別の筋肉の種目で埋めない
  ];
  for (const test of tests) {
    const list = base.filter((ex) => test(ex, ctx.guideFor(ex)));
    if (list.length) return list;
  }
  return [];
}

function pick(list, used, inSession, config, ctx, rand, recorded, gym) {
  let best = null;
  for (const ex of list) {
    if (inSession.has(ex.id)) continue;
    const g = ctx.guideFor(ex);
    let score = rand() * 1.5;
    if (recorded.has(ex.id)) score += 2; // やったことのある種目を優先
    if (ex.loadType === 'weighted' && (config.goal === 'strength' || config.goal === 'hypertrophy')) score += 1; // 重さを足していける種目
    if (g.level === config.level) score += 0.5;
    if (gym && g.equipment.some((k) => !config.equipment.includes(k))) score += 1.5; // ジムの回は、ジムにしかない器具の種目を優先
    if (used.has(ex.id)) score -= 3; // 同じ週の別の日と重ならないように
    if (!best || score > best.score) best = { ex, score };
  }
  return best?.ex || null;
}

// ---- メニューの型を埋める ----

// templates: [{ key, label, gym, items: [{ slot, exerciseId, sets }] }]
function buildTemplates(config, ctx, notes) {
  const rand = random(config.seed || 0);
  const recorded = new Set(ctx.entries.filter((e) => e.status === 'done').map((e) => e.exerciseId));
  const exById = new Map(ctx.exercises.map((x) => [x.id, x]));
  const used = new Set();
  const budget = config.minutes * 60;
  const short = config.minutes <= 30;
  const focus = new Set(config.focus);
  const avoid = new Set(config.avoid);
  const missing = new Set();

  const newItem = (slotKey, ex) => {
    const g = ctx.guideFor(ex);
    const s = schemeFor(config, ex, g);
    let sets = s.sets - (short ? 1 : 0) + (focus.has(ex.bodyPart) ? 1 : 0);
    sets = Math.min(Math.max(sets, 2), MAX_SETS);
    return { slot: slotKey, exerciseId: ex.id, sets };
  };
  const seconds = (items) =>
    items.reduce((a, it) => {
      const ex = exById.get(it.exerciseId);
      const s = schemeFor(config, ex, ctx.guideFor(ex));
      return a + itemSeconds(it.sets, s.rest, ex, ex.loadType === 'timed' ? 45 : 0);
    }, WARMUP_SEC);

  let templates = splitFor(config).keys.map((key, index) => {
    const def = TEMPLATES[key];
    const gym = index < config.gymSessions;
    const slotKeys = def.slots.filter((k) => !avoid.has(SLOTS[k].part));
    // 時間が足りないときに残す順: 重点部位 → 複数の関節を使う種目 → それ以外
    const rank = (k) => (focus.has(SLOTS[k].part) ? 0 : SLOTS[k].compound ? 1 : 2);
    const byPriority = slotKeys.map((k, i) => ({ k, i })).sort((a, b) => rank(a.k) - rank(b.k) || a.i - b.i);
    const chosen = [];
    const inSession = new Set();
    for (const { k, i } of byPriority) {
      const ex = pick(candidates(SLOTS[k], gym, config, ctx), used, inSession, config, ctx, rand, recorded, gym);
      if (!ex) {
        missing.add(SLOTS[k].part);
        continue;
      }
      const item = { ...newItem(k, ex), order: i };
      if (seconds([...chosen, item]) > budget) {
        // 入りきらないなら、セットを 2 まで減らして入るか試す
        item.sets = 2;
        if (seconds([...chosen, item]) > budget) continue;
      }
      chosen.push(item);
      inSession.add(ex.id);
    }
    chosen.forEach((it) => used.add(it.exerciseId));
    return { key, label: def.label, gym, items: chosen };
  });

  // 短い時間用にセットを減らした分は、時間が余っていれば目安のセット数まで戻す(重点部位から)
  const targetSets = (it) => {
    const ex = exById.get(it.exerciseId);
    return Math.min(schemeFor(config, ex, ctx.guideFor(ex)).sets + (focus.has(ex.bodyPart) ? 1 : 0), MAX_SETS);
  };
  for (const t of templates) {
    for (let guard = 0; guard < 30; guard++) {
      const it = t.items
        .filter((x) => x.sets < targetSets(x))
        .sort((a, b) => Number(focus.has(exById.get(b.exerciseId).bodyPart)) - Number(focus.has(exById.get(a.exerciseId).bodyPart)) || a.sets - b.sets)[0];
      if (!it) break;
      it.sets++;
      if (seconds(t.items) > budget) {
        it.sets--;
        break;
      }
    }
  }
  // 「鍛えない」の指定や器具の都合で種目が1つも入らなかった回は省く
  const empty = templates.filter((t) => !t.items.length).length;
  if (empty) {
    templates = templates.filter((t) => t.items.length);
    notes.push(`入れられる種目のない回が ${empty} 回あったので省きました(週 ${templates.length} 回になります)`);
  }

  // 行う順: 複数の関節を使う種目 → 単関節 → 体幹
  const orderOf = (it) => {
    const g = ctx.guideFor(exById.get(it.exerciseId));
    return (g.pattern === 'core' ? 2 : g.compound ? 0 : 1) * 100 + it.order;
  };
  templates.forEach((t) => t.items.sort((a, b) => orderOf(a) - orderOf(b)));

  // 部位ごとの週セット数を、目安の範囲に寄せる
  const weekly = () => {
    const out = {};
    for (const t of templates) for (const it of t.items) out[exById.get(it.exerciseId).bodyPart] = (out[exById.get(it.exerciseId).bodyPart] || 0) + it.sets;
    return out;
  };
  const itemsOf = (part) => templates.flatMap((t) => t.items.filter((it) => exById.get(it.exerciseId).bodyPart === part).map((it) => ({ t, it })));
  for (const part of Object.keys(PART_LABELS)) {
    const list = itemsOf(part);
    if (!list.length) continue;
    const [lo, hi] = focus.has(part) ? FOCUS_WEEKLY : [0, focus.size ? KEEP_WEEKLY_MAX : FOCUS_WEEKLY[1]];
    // 足りなければ、時間に収まる範囲でセットを足す
    for (let guard = 0; weekly()[part] < lo && guard < 40; guard++) {
      const target = list.filter(({ it }) => it.sets < MAX_SETS).sort((a, b) => a.it.sets - b.it.sets)[0];
      if (!target) break;
      target.it.sets++;
      if (seconds(target.t.items) > budget) {
        target.it.sets--;
        break;
      }
    }
    // 多すぎれば減らす
    for (let guard = 0; weekly()[part] > hi && guard < 40; guard++) {
      const target = list.filter(({ it }) => it.sets > 2).sort((a, b) => b.it.sets - a.it.sets)[0];
      if (!target) break;
      target.it.sets--;
    }
    // 2セットずつにしてもまだ多ければ、単関節の種目から外す(各回に1種目は残す)
    for (let guard = 0; weekly()[part] > hi && guard < 20; guard++) {
      const removable = itemsOf(part)
        .filter(({ t }) => t.items.filter((x) => exById.get(x.exerciseId).bodyPart === part).length > 1)
        .sort((a, b) => Number(ctx.guideFor(exById.get(a.it.exerciseId)).compound) - Number(ctx.guideFor(exById.get(b.it.exerciseId)).compound))[0];
      if (!removable) break;
      removable.t.items.splice(removable.t.items.indexOf(removable.it), 1);
    }
  }

  templates.forEach((t) => t.items.forEach((it) => delete it.order));
  for (const part of missing) {
    if (!itemsOf(part).length) notes.push(`${PART_LABELS[part]}は、今の器具とレベルでできる種目がないため入れていません`);
  }
  return templates;
}

// ---- 週ごとの負荷 ----

// 記録から最初の重量を決める。記録がなければ null(初回に自分で決める)。
function startWeight(ex, reps, ctx) {
  const done = ctx.entries
    .filter((e) => e.status === 'done' && e.exerciseId === ex.id && e.actual?.sets?.length)
    .sort((a, b) => (a.date > b.date ? -1 : 1));
  if (!done.length) return { weight: null, basis: null };
  const recent = done.filter((e) => dayNumber(ctx.today) - dayNumber(e.date) <= 56);
  const pool = recent.length ? recent : done.slice(0, 1);
  const oneRm = Math.max(...pool.flatMap((e) => e.actual.sets.filter((s) => s.reps > 0).map((s) => epley1RM(s.weightKg, s.reps))), 0);
  if (!(oneRm > 0)) return { weight: 0, basis: null };
  // 推定1RMから、その回数を余裕をもってこなせる重さ(9割)にする。前回のきつさ(RPE)で少し調整する。
  const rpe = done[0].rpe;
  const adjust = rpe >= 9 ? 0.95 : rpe && rpe <= 6 ? 1.05 : 1;
  const weight = Math.max(floorTo((oneRm / (1 + reps / 30)) * 0.9 * adjust, ctx.weightStepKg), 0);
  return { weight, basis: rpe ? `RPE ${rpe}` : '記録' };
}

// templates から、週ごとのメニューを作る。
// weeks: [{ index, deload, sessions: [{ key, label, gym, minutes, items: [{ exerciseId, sets, reps, unit, weightKg, restSec }] }], runs: [km] }]
export function buildWeeks(templates, config, ctx) {
  const exById = new Map(ctx.exercises.map((x) => [x.id, x]));
  const step = ctx.weightStepKg;
  const starts = new Map();
  const weeks = [];
  let progressed = 0; // 軽めの週を除いた、ここまでの週数
  let runKm = config.run.km;
  for (let w = 0; w < config.weeks; w++) {
    const deload = config.weeks >= BLOCK && (w + 1) % BLOCK === 0;
    const block = Math.floor(w / BLOCK);
    const k = Math.min(w % BLOCK, 2); // ブロックの中で何週目か(0〜2)
    const sessions = templates.map((t) => {
      const items = t.items.map((it) => {
        const ex = exById.get(it.exerciseId);
        const g = ctx.guideFor(ex);
        const s = schemeFor(config, ex, g);
        const [lo, hi] = s.reps;
        const heavy = config.goal === 'strength' && g.compound && ex.loadType === 'weighted';
        let reps;
        let unit = '回';
        if (ex.loadType === 'timed') {
          unit = '秒';
          reps = (config.level === 'beginner' ? 20 : 30) + k * 10 + block * 5;
        } else if (heavy) reps = 5;
        else reps = Math.round(lo + ((hi - lo) * k) / 2) + (ex.loadType === 'bodyweight' ? block : 0);
        let sets = it.sets;
        let weightKg = null;
        if (ex.loadType === 'weighted') {
          if (!starts.has(ex.id)) starts.set(ex.id, startWeight(ex, heavy ? 5 : lo, ctx));
          const base = starts.get(ex.id).weight;
          // 筋力アップの主要種目は毎週、それ以外は4週ごとに重さを足す
          if (base !== null) weightKg = base + step * (heavy ? progressed : block);
        }
        if (deload) {
          sets = Math.max(2, Math.round(sets * 0.6));
          reps = ex.loadType === 'timed' ? reps - 10 : heavy ? 5 : lo;
          if (weightKg !== null) weightKg = roundTo(weightKg * 0.9, step);
        }
        return { exerciseId: ex.id, sets, reps, unit, weightKg, restSec: s.rest };
      });
      return { key: t.key, label: t.label, gym: t.gym, minutes: estimateMinutes(items, exById), items };
    });
    const runs = [];
    if (config.run.perWeek > 0 && config.run.km > 0) {
      // 距離は週に5%ずつ伸ばす。軽めの週は少し短くし、その翌週は元の距離に戻すだけにする(週の伸びを+10%以内に保つ)
      if (!deload && w > 0 && !weeks[w - 1].deload) runKm *= 1.05;
      const km = deload ? runKm * 0.92 : runKm;
      for (let i = 0; i < config.run.perWeek; i++) runs.push(Math.round(km * 10) / 10);
    }
    weeks.push({ index: w, deload, sessions, runs });
    if (!deload) progressed++;
  }
  return { weeks, starts };
}

// ---- 入口 ----

// メニューを作る。返り値: { templates, weeks, volume: { 部位: 週セット数 }, reasons: [説明の文] }
export function generateProgram(config, ctx) {
  const notes = [];
  const templates = buildTemplates(config, ctx, notes);
  return { templates, ...describe(templates, config, ctx, notes) };
}

// 種目を入れ替えたあとなど、templates から週ごとのメニューと説明を作り直す
export function describe(templates, config, ctx, notes = []) {
  const exById = new Map(ctx.exercises.map((x) => [x.id, x]));
  const { weeks, starts } = buildWeeks(templates, config, ctx);
  const volume = {};
  for (const t of templates) for (const it of t.items) volume[exById.get(it.exerciseId).bodyPart] = (volume[exById.get(it.exerciseId).bodyPart] || 0) + it.sets;

  const reasons = [splitFor(config).text, `目的が「${GOALS[config.goal]}」なので、${SCHEMES[config.goal].text}にしています`];
  reasons.push('各回とも、複数の関節を使う種目を先に、単関節の種目と体幹を後に並べています');
  const parts = (list) => list.map((p) => `${PART_LABELS[p]} ${volume[p] || 0}`).join('、');
  if (config.focus.length) {
    reasons.push(`重点部位の週セット数: ${parts(config.focus)}(目安は ${FOCUS_WEEKLY[0]}〜${FOCUS_WEEKLY[1]})`);
    const low = config.focus.filter((p) => (volume[p] || 0) < FOCUS_WEEKLY[0]);
    if (low.length) reasons.push(`${low.map((p) => PART_LABELS[p]).join('・')}は、回数か1回の時間を増やすと目安に届きます`);
    const rest = Object.keys(PART_LABELS).filter((p) => !config.focus.includes(p) && !config.avoid.includes(p) && volume[p]);
    if (rest.length) reasons.push(`それ以外は維持できる量にしています: ${parts(rest)}`);
  } else reasons.push(`部位ごとの週セット数: ${parts(Object.keys(PART_LABELS).filter((p) => volume[p]))}`);
  if (config.avoid.length) reasons.push(`${config.avoid.map((p) => PART_LABELS[p]).join('・')}は「鍛えない」に指定されているので入れていません`);
  const longest = Math.max(0, ...weeks[0].sessions.map((s) => s.minutes));
  reasons.push(`1回 ${config.minutes} 分に収まる種目数にしています(見積もりは最長 ${longest} 分。準備運動5分を含む)`);
  const brief = weeks[0].sessions.filter((x) => x.minutes < config.minutes * 0.5);
  if (config.focus.length && brief.length) {
    reasons.push(`${brief.map((x) => x.label).join('・')}は、重点以外を維持の量に抑えているため短めです(約${Math.min(...brief.map((x) => x.minutes))}分〜)。時間を使い切りたいときは、重点部位を増やしてください`);
  }
  const deloads = weeks.filter((w) => w.deload).map((w) => w.index + 1);
  reasons.push(
    deloads.length
      ? `3週かけて回数と重さを上げ、${deloads.join('・')}週目は軽めの週(セットを4割減、重さを1割減)にして回復させます`
      : '期間が短いので、軽めの週は入れずに少しずつ回数を上げます',
  );
  const withRecord = [...starts.values()].filter((s) => s.weight !== null).length;
  const without = [...starts.values()].filter((s) => s.weight === null).length;
  if (withRecord) reasons.push(`重さは、これまでの記録(推定1RM${[...starts.values()].some((s) => s.basis?.startsWith('RPE')) ? 'と前回のきつさ' : ''})から、余裕をもってこなせる値にしています`);
  if (without) reasons.push(`記録のない ${without} 種目は重さが空欄です。初回に「あと2〜3回できる」重さを探してください`);
  if (config.gymSessions > 0) reasons.push(`週 ${config.gymSessions} 回はジムの器具を使うメニューにしています(「ジム」の印の回)`);
  if (weeks[0].runs.length) reasons.push(`ランニングは週 ${config.run.perWeek} 回・1回 ${config.run.km}km から始め、週に5%ずつ伸ばします${config.separateRun ? '。日程に入れるときは筋トレと別の日にします' : ''}`);
  reasons.push('同じ部位が続かない順に並べています。日程に入れるときは、同じ部位を48〜72時間空けます');
  return { weeks, volume, reasons: [...reasons, ...notes] };
}

// 入れ替えの候補: 同じ枠に入れられる、その回でまだ使っていない種目
export function swapOptions(templates, tIndex, iIndex, config, ctx) {
  const t = templates[tIndex];
  const current = t.items[iIndex];
  const inSession = new Set(t.items.map((it) => it.exerciseId));
  const slot = SLOTS[current.slot];
  // 条件をゆるめた候補も含めて、同じ部位の種目を出す
  const strict = candidates(slot, t.gym, config, ctx);
  const loose = candidates({ part: slot.part }, t.gym, config, ctx);
  const seen = new Set();
  return [...strict, ...loose].filter((ex) => !inSession.has(ex.id) && !seen.has(ex.id) && seen.add(ex.id));
}
