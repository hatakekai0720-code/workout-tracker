// 自動メニュー作成: 日程に入れる画面(空き時間への自動配置と、手での調整)。
import { getState, getExercise, setProgram, addEntries, removeProgramEntries } from '../../data/store.js';
import { toDateStr, addDays, formatDateJa, formatShortDate } from '../../logic/dates.js';
import { placeProgram, overlapWarning, EVENT_BUFFER_MIN } from '../../logic/placement.js';
import { timeOptions, toMin, fromMin } from '../../logic/schedule.js';
import { TIMES_OF_DAY, describe } from '../../logic/program.js';
import { esc, toast } from '../../ui/util.js';
import { ui, context } from './state.js';

// ---- 日程に入れる画面 ----

export const plannedCount = (programId) => getState().entries.filter((e) => e.programId === programId && e.status === 'planned').length;

// このプログラムで、すでに実施した回の sessionKey
const doneSessionKeys = (programId) => new Set(getState().entries.filter((e) => e.programId === programId && e.status === 'done').map((e) => e.sessionKey));

// 空き時間に自動で配置する。入れ直すときは、前に登録した未実施の予定はないものとして計算し、
// 実施済みの回と、もう過ぎた日には置かない。
export function computePlacement() {
  const s = getState();
  const program = s.program;
  const today = toDateStr(new Date());
  const { weeks } = describe(program.templates, program.config, context());
  ui.cur.place.weeks = weeks;
  ui.cur.place.items = placeProgram({
    weeks,
    startDate: ui.cur.place.startDate,
    minDate: ui.cur.place.startDate < today ? today : ui.cur.place.startDate,
    skip: new Set([...doneSessionKeys(program.id)].map((key) => key.slice(program.id.length + 1))), // 'id:週:s回' → '週:s回'
    events: s.events,
    entries: s.entries.filter((e) => !(e.programId === program.id && e.status === 'planned')),
    settings: s.settings,
    timeOfDay: program.config.timeOfDay,
    separateRun: program.config.separateRun === true,
    partsOf: new Map(s.exercises.map((x) => [x.id, x.bodyPart])),
  });
}

export function placeHtml() {
  const s = getState();
  const program = s.program;
  const { items, weeks, startDate } = ui.cur.place;
  const others = s.entries.filter((e) => !(e.programId === program.id && e.status === 'planned'));
  const step = s.settings.timeStepMin;
  const times = (value) => {
    const list = timeOptions(step, toMin(s.settings.dayStart), toMin(s.settings.dayEnd) - step);
    if (value && !list.includes(value)) list.push(value);
    list.sort();
    return `<option value="">未定</option>${list.map((t) => `<option ${t === value ? 'selected' : ''}>${t}</option>`).join('')}`;
  };
  const existing = plannedCount(program.id);
  const doneCount = doneSessionKeys(program.id).size;
  const warnCount = items.filter((it) => it.warnings.length || overlapWarning(it, items, s.events, others)).length;
  const row = (it, i) => {
    const warnings = [...it.warnings];
    const overlap = overlapWarning(it, items, s.events, others);
    if (overlap) warnings.push(overlap);
    return `<li class="place-item ${it.kind}">
      <div class="prog-main">
        <span class="entry-name">${esc(it.label)}</span>
        <span class="entry-sub">${formatDateJa(it.date)}${it.time ? ` ${it.time}〜${fromMin(toMin(it.time) + it.durationMin)}` : ' 時間未定'} ・ 約${it.durationMin}分</span>
        ${warnings.map((w) => `<span class="place-warn">⚠ ${esc(w)}</span>`).join('')}
      </div>
      <div class="place-edit">
        <input type="date" data-place="${i}" data-key="date" value="${it.date}" min="${toDateStr(new Date())}" aria-label="${esc(it.label)}の日付">
        <select data-place="${i}" data-key="time" aria-label="${esc(it.label)}の開始時刻">${times(it.time || '')}</select>
      </div>
    </li>`;
  };
  return `<div class="sheet">
    <header class="sheet-head">
      <button type="button" class="btn-ghost" data-action="close">閉じる</button>
      <h2>日程に入れる</h2>
      <button type="button" class="btn-primary" data-action="apply">登録</button>
    </header>
    <div class="sheet-body">
      <p class="prev"><b>${esc(program.name)}</b>希望の時間帯: ${TIMES_OF_DAY[program.config.timeOfDay]}</p>
      <label class="field"><span>始める日(第1週の初日)</span><input type="date" data-field="startDate" value="${startDate}"></label>
      <p class="hint after">予定(学校・バイトなど)とその前後${EVENT_BUFFER_MIN}分を避け、同じ部位は48時間以上空けて${program.config.separateRun ? '、ランは筋トレのない日にして' : ''}、空いている時間に置いています。日付と時刻は、下でひとつずつ変えられます。</p>
      ${existing ? `<p class="hint">前に登録した未実施の予定 ${existing}件は、登録し直すと置き換わります(実施済みの記録は残ります)。</p>` : ''}
      ${doneCount ? `<p class="hint">実施済みの ${doneCount}回はそのまま残し、まだ実施していない回だけを、今日以降に配置しています。</p>` : ''}
      ${items.length ? '' : '<p class="empty">配置する回がありません(すべて実施済みか、期間が過ぎています)</p>'}
      ${warnCount ? `<p class="place-warn">⚠ 確認が必要な回が ${warnCount}件あります</p>` : ''}
      ${weeks
        .map((w) => {
          const from = addDays(startDate, w.index * 7);
          const list = items.map((it, i) => ({ it, i })).filter(({ it }) => it.week === w.index);
          if (!list.length) return '';
          return `<section class="group"><h3>第${w.index + 1}週${w.deload ? '<span class="tag deload">軽めの週</span>' : ''}<small>${formatShortDate(from)}〜${formatShortDate(addDays(from, 6))}</small></h3>
            <ul class="prog-list">${list.map(({ it, i }) => row(it, i)).join('')}</ul></section>`;
        })
        .join('')}
      <button type="button" class="btn-ghost wide" data-action="replace-auto">自動で配置し直す</button>
      <button type="button" class="btn-primary wide" data-action="apply">カレンダーに登録(${items.length}回ぶん)</button>
    </div>
  </div>`;
}

// 配置した内容を、カレンダーの予定(トレーニング)として登録する
export function applyPlacement() {
  const s = getState();
  const program = s.program;
  const { items, weeks, startDate } = ui.cur.place;
  const run = s.exercises.find((x) => x.kind === 'run' && !x.archived);
  const list = [];
  for (const it of items) {
    const base = {
      date: it.date,
      status: 'planned',
      actual: null,
      memo: '',
      programId: program.id,
      sessionKey: `${program.id}:${it.week}:${it.kind === 'run' ? 'r' : 's'}${it.index}`,
      sessionLabel: it.label,
      ...(it.time ? { time: it.time, durationMin: it.durationMin } : {}),
    };
    if (it.kind === 'run') {
      if (run) list.push({ ...base, exerciseId: run.id, plan: { distanceKm: it.km, durationSec: null } });
      continue;
    }
    for (const x of weeks[it.week].sessions[it.index].items) {
      const unknown = getExercise(x.exerciseId).loadType === 'weighted' && x.weightKg === null;
      list.push({ ...base, exerciseId: x.exerciseId, plan: { weightKg: x.weightKg ?? 0, reps: x.reps, sets: x.sets, ...(x.restSec > 0 ? { restSec: x.restSec } : {}) }, memo: unknown ? '重さは初回に決める' : '' });
    }
  }
  if (!list.length) return toast('配置する回がありません');
  removeProgramEntries(program.id);
  addEntries(list);
  setProgram({ ...program, schedule: { startDate } });
  toast(`${items.length}回ぶんをカレンダーに登録しました`);
  ui.close();
}

export function startPlacing() {
  ui.cur.mode = 'place';
  const program = getState().program;
  const tomorrow = addDays(toDateStr(new Date()), 1);
  const previous = program.schedule?.startDate;
  const keep = previous && (doneSessionKeys(program.id).size > 0 || previous > toDateStr(new Date()));
  ui.cur.place = { startDate: keep ? previous : tomorrow, items: [], weeks: [] };
  computePlacement();
  ui.render(false);
}
