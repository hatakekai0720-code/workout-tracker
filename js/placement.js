// プログラムの日程への自動配置。DOM や保存先には触れない。
import { addDays, dayNumber } from './calc.js';
import { expandEvents, freeStarts, toMin, fromMin, DEFAULT_TRAINING_MIN } from './schedule.js';

// 希望の時間帯: [開始, 終了, いちばん置きたい時刻](分)
const WINDOWS = {
  morning: [360, 600, 420],
  noon: [660, 960, 720],
  night: [1080, 1320, 1140],
  any: [0, 1440, 1080],
};
export const EVENT_BUFFER_MIN = 30; // 予定(バイト・学校)の前後に空ける時間
const MIN_GAP_H = 48; // 同じ部位は最低これだけ空ける
const GOOD_GAP_H = 72;
const RUN_MIN_PER_KM = 7;
const OUTSIDE_PENALTY = 3; // 希望の時間帯に置けない日は、3日ずらすのと同じくらい避ける
const SEPARATE_PENALTY = 20; // ランを分ける設定のとき、筋トレと同じ日はほぼ選ばない

const ceil5 = (n) => Math.ceil(n / 5) * 5;
const stamp = (date, time) => dayNumber(date) * 1440 + toMin(time || '12:00'); // 通しの分
const overlaps = ([a1, a2], [b1, b2]) => a1 < b2 && b1 < a2;

// その日のふさがっている時間帯。予定は前後に buffer 分の余裕を足す。
function busyOf(date, events, fixed, buffer) {
  const busy = expandEvents(events, date, date).map((o) => [toMin(o.start) - buffer, toMin(o.end) + buffer]);
  for (const f of fixed) if (f.date === date && f.time) busy.push([toMin(f.time), toMin(f.time) + f.durationMin]);
  return busy;
}

// その日に duration 分のトレーニングを置ける時刻。希望の時間帯の中で、いちばん置きたい時刻に近い空きを選ぶ。
// 時間帯の中に空きがなければ、それ以外で近い空きを返す(inWindow: false)。空きがなければ null。
function slotFor(date, duration, timeOfDay, env) {
  const starts = freeStarts(busyOf(date, env.events, env.fixed, EVENT_BUFFER_MIN), duration, env.dayStart, env.dayEnd, env.step);
  if (!starts.length) return null;
  const [from, to, target] = WINDOWS[timeOfDay] || WINDOWS.any;
  const near = (list) => list.slice().sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b)[0];
  const inside = starts.filter((s) => s >= from && s + duration <= to);
  return inside.length ? { time: fromMin(near(inside)), inWindow: true } : { time: fromMin(near(starts)), inWindow: false };
}

// weeks: プログラムの週ごとのメニュー(js/program.js の describe の結果)
// partsOf: 種目id → 部位。entries: 今ある記録(時刻つきのものは避け、最近鍛えた部位も見る)
// 返り値: [{ kind: 'session' | 'run', week, index, label, date, time | null, durationMin, warnings: [文] }]
// minDate: これより前の日には置かない(途中から入れ直すとき)。週がまるごと過ぎていれば、その週は飛ばす。
// skip: 置かない回の集合('週:s回' または '週:r回')。すでに実施した回を指定する。
// separateRun: true ならランは筋トレのある日に置かない(空いている日がないときだけ同じ日にして、注意を出す)。
export function placeProgram({ weeks, startDate, events, entries, settings, timeOfDay, partsOf, minDate = startDate, skip = new Set(), separateRun = false }) {
  const env = {
    events,
    dayStart: toMin(settings.dayStart),
    dayEnd: toMin(settings.dayEnd),
    step: settings.timeStepMin,
    fixed: entries.filter((e) => e.time).map((e) => ({ date: e.date, time: e.time, durationMin: e.durationMin || DEFAULT_TRAINING_MIN })),
  };
  // いつ、どの部位を鍛えたか(体幹は毎日でもよいので数えない)
  const trained = [];
  for (const e of entries) {
    const part = partsOf.get(e.exerciseId);
    if (part && part !== 'core') trained.push({ at: stamp(e.date, e.time), parts: new Set([part]) });
  }
  // 筋トレの記録がある日(ランを分けるときに避ける)
  const strengthDates = new Set(entries.filter((e) => partsOf.get(e.exerciseId)).map((e) => e.date));
  const gapHours = (at, parts) => {
    let min = Infinity;
    for (const t of trained) if ([...parts].some((p) => t.parts.has(p))) min = Math.min(min, Math.abs(at - t.at) / 60);
    return min;
  };

  const out = [];
  for (const wk of weeks) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(startDate, wk.index * 7 + i));
    const open = [0, 1, 2, 3, 4, 5, 6].filter((d) => days[d] >= minDate); // まだ過ぎていない日
    if (!open.length) continue;
    const sessionDays = new Set();
    wk.sessions.forEach((s, index) => {
      if (skip.has(`${wk.index}:s${index}`)) return;
      const ideal = Math.round((index * 7) / wk.sessions.length); // 週の中に均等に散らす
      const duration = ceil5(s.minutes);
      const parts = new Set(s.items.map((it) => partsOf.get(it.exerciseId)).filter((p) => p && p !== 'core'));
      let best = null;
      days.forEach((date, d) => {
        if (sessionDays.has(d) || date < minDate) return;
        const slot = slotFor(date, duration, timeOfDay, env);
        if (!slot) return;
        const gap = gapHours(stamp(date, slot.time), parts);
        const score = -Math.abs(d - ideal) - (gap < MIN_GAP_H ? 10 : gap < GOOD_GAP_H ? 1 : 0) - (slot.inWindow ? 0 : OUTSIDE_PENALTY);
        if (!best || score > best.score) best = { score, d, date, slot, gap };
      });
      const item = { kind: 'session', week: wk.index, index, label: s.label, durationMin: duration, warnings: [] };
      if (best) {
        Object.assign(item, { date: best.date, time: best.slot.time });
        if (best.gap < MIN_GAP_H) item.warnings.push('同じ部位との間隔が48時間未満です');
        if (!best.slot.inWindow) item.warnings.push('希望の時間帯に空きがなく、別の時間にしています');
        sessionDays.add(best.d);
        env.fixed.push({ date: item.date, time: item.time, durationMin: duration });
      } else {
        // その週に空き時間が1つもない: 均等な位置の日に、時刻なしで置く
        const d = open.filter((x) => !sessionDays.has(x)).sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal))[0] ?? open[0];
        Object.assign(item, { date: days[d], time: null });
        item.warnings.push('空き時間が見つからないため、時刻を決めていません');
        sessionDays.add(d);
      }
      trained.push({ at: stamp(item.date, item.time), parts });
      out.push(item);
    });

    // ランは、筋トレのない日を優先して均等に散らす(分ける設定なら、筋トレの日は強く避ける)
    const runDays = new Set();
    const sameDayPenalty = separateRun ? SEPARATE_PENALTY : 2.5;
    const hasStrength = (d) => sessionDays.has(d) || (separateRun && strengthDates.has(days[d]));
    wk.runs.forEach((km, index) => {
      if (skip.has(`${wk.index}:r${index}`)) return;
      const ideal = Math.floor(((index + 0.5) * 7) / wk.runs.length);
      const duration = ceil5(km * RUN_MIN_PER_KM + 10);
      let best = null;
      days.forEach((date, d) => {
        if (runDays.has(d) || date < minDate) return;
        const slot = slotFor(date, duration, timeOfDay, env);
        if (!slot) return;
        const score = -Math.abs(d - ideal) - (hasStrength(d) ? sameDayPenalty : 0) - (slot.inWindow ? 0 : OUTSIDE_PENALTY);
        if (!best || score > best.score) best = { score, d, date, slot };
      });
      const item = { kind: 'run', week: wk.index, index, label: `ランニング ${km}km`, km, durationMin: duration, warnings: [] };
      if (best) {
        Object.assign(item, { date: best.date, time: best.slot.time });
        if (!best.slot.inWindow) item.warnings.push('希望の時間帯に空きがなく、別の時間にしています');
        if (separateRun && hasStrength(best.d)) item.warnings.push('ほかに空いている日がないため、筋トレと同じ日にしています');
        runDays.add(best.d);
        env.fixed.push({ date: item.date, time: item.time, durationMin: duration });
      } else {
        const cost = (x) => Math.abs(x - ideal) + (hasStrength(x) ? sameDayPenalty : 0);
        const d = open.filter((x) => !runDays.has(x)).sort((a, b) => cost(a) - cost(b))[0] ?? open[0];
        Object.assign(item, { date: days[d], time: null });
        item.warnings.push('空き時間が見つからないため、時刻を決めていません');
        if (separateRun && hasStrength(d)) item.warnings.push('ほかに空いている日がないため、筋トレと同じ日にしています');
        runDays.add(d);
      }
      out.push(item);
    });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : toMin(a.time || '24:00') - toMin(b.time || '24:00')));
}

// 手で動かしたあとの確認。予定(バイト・学校)や、ほかの配置・時刻つきの記録と重なっていれば文を返す。
export function overlapWarning(item, items, events, entries) {
  if (!item.time) return null;
  const range = [toMin(item.time), toMin(item.time) + item.durationMin];
  const ev = expandEvents(events, item.date, item.date).find((o) => overlaps(range, [toMin(o.start), toMin(o.end)]));
  if (ev) return `「${ev.event.title}」(${ev.start}〜${ev.end})と重なっています`;
  const other = items.find((x) => x !== item && x.date === item.date && x.time && overlaps(range, [toMin(x.time), toMin(x.time) + x.durationMin]));
  if (other) return `「${other.label}」と重なっています`;
  const en = entries.find((e) => e.date === item.date && e.time && overlaps(range, [toMin(e.time), toMin(e.time) + (e.durationMin || DEFAULT_TRAINING_MIN)]));
  return en ? 'ほかのトレーニングと重なっています' : null;
}
