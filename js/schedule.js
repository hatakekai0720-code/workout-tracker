// スケジュール(バイト・学校などの予定)の計算。DOM や保存先には触れない。
//
// 予定の形:
//   { id, title, kind: 'school' | 'work' | 'other', date, start: 'HH:MM', end: 'HH:MM',
//     repeat: null | { freq, days: [0〜6(月〜日)], until: 'YYYY-MM-DD' | null, count: 数 | null },
//     exceptions: { 'YYYY-MM-DD': { skip: true } | { start, end } }, termId: 学期のid | null }
//   date は繰り返しの開始日(繰り返さない予定ではその日)。
import { dayNumber, addDays, weekStart } from './calc.js';

export const EVENT_KINDS = { school: '学校', work: 'バイト', other: 'その他' };
export const REPEAT_FREQS = {
  daily: '毎日',
  weekdays: '平日のみ',
  weekly: '毎週',
  biweekly: '隔週',
  monthlyDate: '毎月(同じ日付)',
  monthlyNth: '毎月(第何何曜日)',
};
export const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];
export const DEFAULT_TRAINING_MIN = 60; // 所要時間を入れていないトレーニングの長さ
const SEARCH_LIMIT_DAYS = 800;

const pad2 = (n) => String(n).padStart(2, '0');
export const toMin = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
export const fromMin = (n) => `${pad2(Math.floor(n / 60))}:${pad2(n % 60)}`;
export const weekdayOf = (date) => (dayNumber(date) + 3) % 7; // 0 = 月 … 6 = 日
// 時刻の選択肢('HH:MM')。step 分きざみで from〜to(分)。
export function timeOptions(step, from = 0, to = 1440) {
  const out = [];
  for (let m = from; m <= to; m += step) out.push(fromMin(m));
  return out;
}

const dayOfMonth = (date) => Number(date.slice(8, 10));
const nthOfMonth = (date) => Math.ceil(dayOfMonth(date) / 7); // その月の第何週目の曜日か

// 繰り返しの規則だけで見て、その日に当たるか(回数の上限と例外は見ない)
function ruleMatches(ev, date) {
  if (date < ev.date) return false;
  const r = ev.repeat;
  if (!r) return date === ev.date;
  if (r.until && date > r.until) return false;
  const wd = weekdayOf(date);
  const days = r.days?.length ? r.days : [weekdayOf(ev.date)];
  switch (r.freq) {
    case 'daily':
      return true;
    case 'weekdays':
      return wd <= 4;
    case 'weekly':
      return days.includes(wd);
    case 'biweekly':
      return days.includes(wd) && ((dayNumber(weekStart(date)) - dayNumber(weekStart(ev.date))) / 7) % 2 === 0;
    case 'monthlyDate':
      return dayOfMonth(date) === dayOfMonth(ev.date);
    case 'monthlyNth':
      return wd === weekdayOf(ev.date) && nthOfMonth(date) === nthOfMonth(ev.date);
    default:
      return false;
  }
}

// 予定 1 件の、from〜to の間の日付を順に返す。「休み」にした日も含む(回数に数えるため)。
function* occurrenceDates(ev, from, to) {
  const r = ev.repeat;
  if (!r) {
    if (ev.date >= from && ev.date <= to) yield ev.date;
    return;
  }
  const last = r.until && r.until < to ? r.until : to;
  if (r.count) {
    // 回数指定は最初から数える必要がある
    let n = 0;
    for (let d = ev.date, i = 0; d <= last && n < r.count && i < SEARCH_LIMIT_DAYS * 3; d = addDays(d, 1), i++) {
      if (!ruleMatches(ev, d)) continue;
      n++;
      if (d >= from) yield d;
    }
    return;
  }
  for (let d = from > ev.date ? from : ev.date; d <= last; d = addDays(d, 1)) if (ruleMatches(ev, d)) yield d;
}

// from〜to の間の予定を、1回ずつに展開する(日付・開始時刻の順)。
// 各回: { event, date, start, end, changed: この回だけ時間を変えたか }
export function expandEvents(events, from, to) {
  const out = [];
  for (const ev of events) {
    for (const date of occurrenceDates(ev, from, to)) {
      const ex = ev.exceptions?.[date];
      if (ex?.skip) continue;
      out.push({ event: ev, date, start: ex?.start || ev.start, end: ex?.end || ev.end, changed: !!ex });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : toMin(a.start) - toMin(b.start)));
}

// 最初の回の日付(繰り返しの曜日が開始日とずれている場合がある)
export function firstOccurrence(ev) {
  for (const d of occurrenceDates(ev, ev.date, addDays(ev.date, SEARCH_LIMIT_DAYS))) return d;
  return null;
}

// date より前に何回あったか(回数指定の繰り返しを途中で分けるときに使う)
function countBefore(ev, date) {
  let n = 0;
  for (const d of occurrenceDates({ ...ev, repeat: { ...ev.repeat, count: null } }, ev.date, addDays(date, -1))) if (d) n++;
  return n;
}

const pickExceptions = (ev, keep) => Object.fromEntries(Object.entries(ev.exceptions || {}).filter(([d]) => keep(d)));

// 予定の編集。scope: 'one'(この回だけ) | 'future'(これ以降すべて) | 'all'(すべて)。
// changes は { title, kind, date, start, end, repeat } の一部。新しい予定の配列を返す。
// 「この回だけ」で変えられるのは時間だけ。
export function editEvent(events, id, date, scope, changes, newId) {
  const ev = events.find((e) => e.id === id);
  if (!ev) return events;
  const replace = (...list) => events.flatMap((e) => (e.id === id ? list : [e]));
  if (!ev.repeat || scope === 'all' || (scope === 'future' && date <= firstOccurrence(ev))) {
    return replace({ ...ev, ...changes });
  }
  if (scope === 'one') {
    return replace({ ...ev, exceptions: { ...ev.exceptions, [date]: { start: changes.start || ev.start, end: changes.end || ev.end } } });
  }
  // これ以降すべて: 元の繰り返しを前日で終わらせ、その日から新しい繰り返しを始める
  const repeat = { ...(changes.repeat || ev.repeat) };
  if (ev.repeat.count && repeat.count === ev.repeat.count) repeat.count = Math.max(ev.repeat.count - countBefore(ev, date), 1);
  const before = { ...ev, repeat: { ...ev.repeat, until: addDays(date, -1), count: null }, exceptions: pickExceptions(ev, (d) => d < date) };
  const after = { ...ev, ...changes, id: newId(), date, repeat, exceptions: pickExceptions(ev, (d) => d >= date) };
  return replace(before, after);
}

// 予定の削除。「この回だけ」は、その日を休みにする。
export function deleteEvent(events, id, date, scope) {
  const ev = events.find((e) => e.id === id);
  if (!ev) return events;
  const replace = (...list) => events.flatMap((e) => (e.id === id ? list : [e]));
  if (!ev.repeat || scope === 'all' || (scope === 'future' && date <= firstOccurrence(ev))) return replace();
  if (scope === 'one') return replace({ ...ev, exceptions: { ...ev.exceptions, [date]: { skip: true } } });
  return replace({ ...ev, repeat: { ...ev.repeat, until: addDays(date, -1), count: null }, exceptions: pickExceptions(ev, (d) => d < date) });
}

// ---- 学期の時間割・シフトのコピー ----

// 学期の時間割(rows: [{ day: 0〜6, title, start, end }])から、学期末まで毎週繰り返す予定を作る
export function termEvents(term, rows, newId) {
  const out = [];
  for (const row of rows) {
    const date = addDays(term.from, (row.day - weekdayOf(term.from) + 7) % 7); // 学期の開始日以降で最初のその曜日
    if (date > term.to) continue;
    out.push({
      id: newId(),
      title: row.title,
      kind: 'school',
      date,
      start: row.start,
      end: row.end,
      repeat: { freq: 'weekly', days: [row.day], until: term.to, count: null },
      exceptions: {},
      termId: term.id,
    });
  }
  return out;
}

// fromWeek(月曜の日付)の週にある、繰り返しでない kind の予定を toWeek の週へ写す。
// すでに同じ予定がある分は作らない。追加する予定の配列を返す。
export function copyWeek(events, fromWeek, toWeek, kind, newId) {
  const shift = dayNumber(toWeek) - dayNumber(fromWeek);
  const same = (a, b) => a.title === b.title && a.date === b.date && a.start === b.start && a.end === b.end;
  const out = [];
  for (const ev of events) {
    if (ev.repeat || ev.kind !== kind || ev.date < fromWeek || ev.date > addDays(fromWeek, 6)) continue;
    const copy = { ...ev, id: newId(), date: addDays(ev.date, shift), exceptions: {}, termId: null };
    if (![...events, ...out].some((e) => !e.repeat && same(e, copy))) out.push(copy);
  }
  return out;
}

// ---- トレーニングとの重なり ----

const entryRange = (e) => {
  const s = toMin(e.time);
  return [s, s + (e.durationMin || DEFAULT_TRAINING_MIN)];
};
const overlaps = ([a1, a2], [b1, b2]) => a1 < b2 && b1 < a2;

// 時刻つきの「予定」のトレーニングのうち、from〜to の間で予定と重なっているもの。
// 返り値: [{ entry, occurrence }](1つのトレーニングにつき最初に重なった予定だけ)
export function findConflicts(entries, events, from, to) {
  const occ = expandEvents(events, from, to);
  const out = [];
  for (const e of entries) {
    if (!e.time || e.status !== 'planned' || e.date < from || e.date > to) continue;
    const hit = occ.find((o) => o.date === e.date && overlaps(entryRange(e), [toMin(o.start), toMin(o.end)]));
    if (hit) out.push({ entry: e, occurrence: hit });
  }
  return out.sort((a, b) => (a.entry.date < b.entry.date ? -1 : a.entry.date > b.entry.date ? 1 : toMin(a.entry.time) - toMin(b.entry.time)));
}

// その日のふさがっている時間帯(予定と、時刻つきのトレーニング)。[開始分, 終了分] の配列。
export function busyRanges(date, events, entries, exceptEntryId = null) {
  const busy = expandEvents(events, date, date).map((o) => [toMin(o.start), toMin(o.end)]);
  for (const e of entries) if (e.date === date && e.time && e.id !== exceptEntryId) busy.push(entryRange(e));
  return busy;
}

// 空いている開始時刻(分)の一覧。dayStart〜dayEnd の間で、step 分きざみ。
export function freeStarts(busy, duration, dayStart, dayEnd, step) {
  const out = [];
  for (let s = dayStart; s + duration <= dayEnd; s += step) if (!busy.some((b) => overlaps([s, s + duration], b))) out.push(s);
  return out;
}

// 重なったトレーニングの振り替え候補(最大 max 件)。
// 同じ日の前後で一番近い空き時間と、翌日以降の同じ時刻に近い空き時間。
export function rescheduleOptions(entry, events, entries, { dayStart, dayEnd, step, days = 3, max = 4 }) {
  const want = toMin(entry.time);
  const duration = entry.durationMin || DEFAULT_TRAINING_MIN;
  const nearest = (list, pick) => list.filter(pick).sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0];
  const out = [];
  const add = (date, min) => min !== undefined && out.push({ date, time: fromMin(min) });
  const today = freeStarts(busyRanges(entry.date, events, entries, entry.id), duration, dayStart, dayEnd, step);
  add(entry.date, nearest(today, (s) => s < want));
  add(entry.date, nearest(today, (s) => s > want));
  for (let i = 1; i <= days; i++) {
    const date = addDays(entry.date, i);
    add(date, nearest(freeStarts(busyRanges(date, events, entries, entry.id), duration, dayStart, dayEnd, step), () => true));
  }
  return out.slice(0, max);
}
