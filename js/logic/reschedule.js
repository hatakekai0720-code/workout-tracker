// サボった日(過去の未実施の予定)の振り替え。DOM や保存先には触れない。
//
// - プログラムの予定は、順番を保ったまま次の空き時間へずらす(バイト・学校の前後30分は避ける。
//   同じ部位は48時間以上空ける = 回復マップの「休ませる」の間は入れない)。前の回が押し出されたら、後ろの回も順に後ろへずらす。
// - 7日以上空いたら自動では動かさず、「再開プラン」(残りをまとめて今日へ平行移動し、最初の1週間を軽めにする)を勧める。
// - 手で入れた単発の予定は動かさない(「休んだ」「スキップ」を選ぶだけ)。
import { addDays, dayNumber } from './dates.js';
import { toMin, DEFAULT_TRAINING_MIN } from './schedule.js';
import { slotFor, busyOf, stamp, EVENT_BUFFER_MIN, MIN_GAP_H } from './placement.js';

export const RESTART_DAYS = 7; // これ以上空いたら自動では動かさない
export const RETURN_LIGHT = { weightPct: 0.9, setsMinus: 1 }; // 休んだあとの1回目
export const RESTART_LIGHT = { weightPct: 0.8, setsMinus: 1 }; // 再開プランの最初の1週間
const NOW_MARGIN_MIN = 30; // 今日に入れるときは、今から30分より後
const SEARCH_DAYS = 60;
const PREFER_DAYS = 7; // 時間帯・間隔の条件がそろう日を、この日数までは探す

const byWhen = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : toMin(a.time || '24:00') - toMin(b.time || '24:00'));
const overlaps = ([a1, a2], [b1, b2]) => a1 < b2 && b1 < a2;

// 過去の未実施の予定を、1回ぶんずつにまとめる。
// プログラムの回(同じ sessionKey・同じ日)は program: true。1種目でも実施していれば「一部だけ」(partial)として、動かさない側に入れる。
// 返り値: [{ key, sessionKey, date, time, label, entryIds, program, partial, isRun }](日付順)
export function findMissed(entries, today, programId, partsOf = new Map()) {
  const groups = new Map();
  const doneKeys = new Set(entries.filter((e) => e.status === 'done' && e.sessionKey).map((e) => `${e.sessionKey}|${e.date}`));
  for (const e of entries) {
    if (e.status !== 'planned' || !(e.date < today)) continue;
    const prog = !!programId && e.programId === programId && !!e.sessionKey;
    const key = prog ? `${e.sessionKey}|${e.date}` : `d|${e.date}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key, sessionKey: prog ? e.sessionKey : null, date: e.date, time: e.time || null, label: e.sessionLabel || null,
        entryIds: [], program: prog && !doneKeys.has(key), partial: doneKeys.has(key), isRun: true,
      });
    }
    const g = groups.get(key);
    g.entryIds.push(e.id);
    if (partsOf.get(e.exerciseId) !== undefined) g.isRun = false;
  }
  return [...groups.values()].sort(byWhen);
}

// いちばん古い未実施の回から今日までの日数(プログラムの回だけを見る)
export function daysSinceMissed(missed, today) {
  const first = missed.find((m) => m.program);
  return first ? dayNumber(today) - dayNumber(first.date) : 0;
}

// 振り替えの計画。返り値: { moves: [{ key, sessionKey, label, isRun, fromDate, fromTime, fromDuration, toDate, toTime, durationMin, warnings }] }
// held: 動かさない過去の回の key(元に戻した・「今回はしない」を選んだもの)
// shiftDays: 再開プランのとき、残りの回をまとめてずらす日数
// partsOf: 種目id → 部位(筋トレだけ)。separateRun: ランを筋トレと別の日にする設定
export function planReschedule({ entries, events, settings, programId, partsOf, today, nowMin, timeOfDay = 'any', held = new Set(), shiftDays = 0, separateRun = false }) {
  if (!programId) return { moves: [] };
  const doneKeys = new Set(entries.filter((e) => e.status === 'done' && e.sessionKey).map((e) => `${e.sessionKey}|${e.date}`));
  const groups = new Map();
  for (const e of entries) {
    if (e.programId !== programId || !e.sessionKey || e.status !== 'planned') continue;
    const key = `${e.sessionKey}|${e.date}`;
    if (doneKeys.has(key) || (e.date < today && held.has(key))) continue;
    if (!groups.has(key)) {
      groups.set(key, { key, sessionKey: e.sessionKey, date: e.date, time: e.time || null, durationMin: e.durationMin || null, label: e.sessionLabel || '', ids: new Set(), parts: new Set() });
    }
    const g = groups.get(key);
    g.ids.add(e.id);
    const p = partsOf.get(e.exerciseId);
    if (p && p !== 'core') g.parts.add(p);
    if (p) g.strength = true;
  }
  const sessions = [...groups.values()].sort(byWhen);
  const inChain = new Set(sessions.flatMap((s) => [...s.ids]));

  const env = {
    events,
    dayStart: toMin(settings.dayStart),
    dayEnd: toMin(settings.dayEnd),
    step: settings.timeStepMin,
    fixed: entries
      .filter((e) => e.time && !inChain.has(e.id) && e.date >= today && e.status !== 'skipped')
      .map((e) => ({ date: e.date, time: e.time, durationMin: e.durationMin || DEFAULT_TRAINING_MIN })),
  };
  env.fixed.push({ date: today, time: '00:00', durationMin: Math.min(1440, nowMin + NOW_MARGIN_MIN) });

  // いつ、どの部位を鍛えた(鍛える予定)か。過去の未実施の予定は数えない。
  const trained = [];
  const strengthDates = new Set();
  for (const e of entries) {
    if (inChain.has(e.id)) continue;
    const p = partsOf.get(e.exerciseId);
    if (!p || !(e.status === 'done' || (e.status === 'planned' && e.date >= today))) continue;
    if (e.date >= today) strengthDates.add(e.date);
    if (p !== 'core') trained.push({ at: stamp(e.date, e.time), parts: new Set([p]) });
  }
  const gapHours = (at, parts) => {
    let min = Infinity;
    for (const t of trained) if ([...parts].some((p) => t.parts.has(p))) min = Math.min(min, Math.abs(at - t.at) / 60);
    return min;
  };
  const timeFree = (date, time, dur) => {
    const r = [toMin(time), toMin(time) + dur];
    if (r[1] > env.dayEnd || r[0] < env.dayStart) return false;
    return !busyOf(date, env.events, env.fixed, EVENT_BUFFER_MIN).some((b) => overlaps(r, b));
  };

  const moves = [];
  const place = (s, { earliest, okDay }) => {
    const dur = s.durationMin || DEFAULT_TRAINING_MIN;
    const own = addDays(s.date, shiftDays);
    let at = null;
    const gapOk = (date, time) => okDay(date) && gapHours(stamp(date, time), s.parts) >= MIN_GAP_H;
    if (own >= earliest) {
      // 動かす必要がなければそのまま(再開プランでずらした回は、その時刻が空いているかも確かめる)
      if (shiftDays === 0 && gapOk(own, s.time)) at = { date: own, time: s.time, warnings: [] };
      else if (shiftDays > 0 && s.time && timeFree(own, s.time, dur) && gapOk(own, s.time)) at = { date: own, time: s.time, warnings: [] };
    }
    if (!at) {
      const start = own > earliest ? own : earliest;
      let pick = null;
      let fallback = null;
      let loose = null;
      for (let i = 0; i <= SEARCH_DAYS; i++) {
        const date = addDays(start, i);
        const slot = slotFor(date, dur, timeOfDay, env);
        if (!slot) continue;
        const ok = gapOk(date, slot.time);
        const cand = { date, time: slot.time, inWindow: slot.inWindow, ok };
        if (ok && slot.inWindow) {
          pick = cand;
          break;
        }
        if (ok && !fallback) fallback = cand;
        if (!loose) loose = cand;
        if (i >= PREFER_DAYS && fallback) break;
      }
      const c = pick || fallback || loose;
      if (c) {
        at = { date: c.date, time: c.time, warnings: [] };
        if (!c.ok) at.warnings.push(s.strength ? '同じ部位との間隔が48時間未満です' : 'ほかに空いている日がないため、筋トレと同じ日にしています');
        if (!c.inWindow) at.warnings.push('希望の時間帯に空きがなく、別の時間にしています');
      } else {
        at = { date: start, time: null, warnings: ['空き時間が見つからないため、時刻を決めていません'] };
      }
    }
    if (at.date !== s.date || (at.time || null) !== (s.time || null)) {
      moves.push({
        key: s.key, sessionKey: s.sessionKey, label: s.label, isRun: !s.strength,
        fromDate: s.date, fromTime: s.time, fromDuration: s.durationMin,
        toDate: at.date, toTime: at.time, durationMin: at.time ? dur : null, warnings: at.warnings,
      });
    }
    if (at.time) env.fixed.push({ date: at.date, time: at.time, durationMin: dur });
    return at;
  };

  // 筋トレの回: 順番を保ち、前の回の翌日より前には置かない
  let prev = null;
  for (const s of sessions.filter((x) => x.strength)) {
    const earliest = prev && addDays(prev, 1) > today ? addDays(prev, 1) : today;
    const at = place(s, { earliest, okDay: () => true });
    trained.push({ at: stamp(at.date, at.time), parts: s.parts });
    strengthDates.add(at.date);
    prev = at.date;
  }
  // ランの回: 1日1回まで。分ける設定なら筋トレの日を避ける
  prev = null;
  for (const s of sessions.filter((x) => !x.strength)) {
    const earliest = prev && addDays(prev, 1) > today ? addDays(prev, 1) : today;
    const at = place(s, { earliest, okDay: (d) => !separateRun || !strengthDates.has(d) });
    prev = at.date;
  }
  return { moves: moves.sort((a, b) => byWhen({ date: a.toDate, time: a.toTime }, { date: b.toDate, time: b.toTime })) };
}

// 再開プランでずらす日数: いちばん古い未実施の回を今日にそろえる
export const restartShift = (missed, today) => Math.max(0, daysSinceMissed(missed, today));

// 予定を軽くする(休んだあと・再開プラン)。重さは刻みに合わせて切り下げ、セットは減らしても2セットは残す。
export function lightenPlan(ex, plan, { weightPct, setsMinus }, weightStepKg = 2.5) {
  if (ex.kind === 'run') return { ...plan, distanceKm: Math.max(0.5, Math.round(plan.distanceKm * weightPct * 10) / 10), durationSec: null };
  const out = { ...plan, sets: Math.max(Math.min(2, plan.sets), plan.sets - setsMinus) };
  if (plan.weightKg > 0) {
    const step = weightStepKg > 0 ? weightStepKg : 2.5;
    out.weightKg = Math.round(Math.floor((plan.weightKg * weightPct) / step + 1e-9) * step * 100) / 100;
  }
  return out;
}

// 次の1回ぶん(今日以降でいちばん早い、未実施の予定)。プログラムの回なら同じ回の種目、そうでなければその日の予定。
export function nextSessionEntries(entries, today) {
  const upcoming = entries.filter((e) => e.status === 'planned' && e.date >= today).sort(byWhen);
  if (!upcoming.length) return [];
  const first = upcoming[0];
  return upcoming.filter((e) => e.date === first.date && (first.sessionKey ? e.sessionKey === first.sessionKey : !e.sessionKey));
}

// 再開プランで軽くする予定(移動後の日付が今日から1週間以内の回)
export function restartWindow(moves, today) {
  const last = addDays(today, RESTART_DAYS - 1);
  return new Set(moves.filter((m) => m.toDate >= today && m.toDate <= last).map((m) => `${m.sessionKey}|${m.toDate}`));
}

