// カレンダータブ: 月・週・日の表示、選んだ日のメニューと予定、スケジュールの便利機能。
import { getState, getExercise, getEntry, upsertEntry, setEvents, moveSession, makeId, BODY_PARTS } from '../store.js';
import { toDateStr, monthGrid, formatDateJa, formatShortDate, describePlan, describeActual, addDays, weekStart } from '../calc.js';
import { computePRs, runCalories, PR_LABELS } from '../insights.js';
import {
  expandEvents,
  findConflicts,
  rescheduleOptions,
  copyWeek,
  editEvent,
  toMin,
  fromMin,
  timeOptions,
  EVENT_KINDS,
  DEFAULT_TRAINING_MIN,
} from '../schedule.js';
import { timelineHtml, attachResize, minuteAt } from './timeline.js';
import { openEntryForm } from './entry.js';
import { openEventForm } from './event.js';
import { openTermForm } from './term.js';
import { esc, toast } from '../util.js';

const MAX_DOTS = 4;
const CONFLICT_DAYS = 60; // 今日から何日先までの重なりを知らせるか
const VIEWS = { month: '月', week: '週', day: '日' };

// ほかの画面(ホームなど)から、次にカレンダーを開いたときに選ぶ日を指定する
let pendingDate = null;
export function focusCalendarDate(date) {
  pendingDate = date;
}

export function mountCalendar(root) {
  const now = new Date();
  const ui = { view: 'month', year: now.getFullYear(), month: now.getMonth(), selected: toDateStr(now), moving: null };

  const settings = () => getState().settings;
  const nameOf = (e) => getExercise(e.exerciseId)?.name || '?';

  function selectDate(date) {
    ui.selected = date;
    const [y, m] = date.split('-').map(Number);
    ui.year = y;
    ui.month = m - 1;
  }

  // 前へ・次へ。月表示は1か月、週表示は1週間、日表示は1日動く。
  function shift(dir) {
    if (ui.view === 'month') {
      const d = new Date(ui.year, ui.month + dir, 1);
      ui.year = d.getFullYear();
      ui.month = d.getMonth();
    } else selectDate(addDays(ui.selected, ui.view === 'week' ? 7 * dir : dir));
  }

  function dots(entries) {
    const shown = entries.slice(0, MAX_DOTS).map((e) => {
      const kind = getExercise(e.exerciseId)?.kind === 'run' ? 'run' : 'strength';
      return `<i class="dot ${kind} ${e.status}"></i>`;
    });
    if (entries.length > MAX_DOTS) shown.push('<i class="dot-more">+</i>');
    return shown.join('');
  }

  function entryList(entries, prByEntry) {
    if (!entries.length) return '<p class="empty">メニューはまだありません</p>';
    const sorted = [...entries].sort((a, b) => (a.time || '99') < (b.time || '99') ? -1 : (a.time || '99') > (b.time || '99') ? 1 : 0);
    let lastKey = null;
    return `<ul class="entry-list">${sorted
      .map((e) => {
        const ex = getExercise(e.exerciseId);
        const done = e.status === 'done';
        let summary = done ? describeActual(ex, e.actual) : describePlan(ex, e.plan).replace(/^0kg × /, ''); // 重さ未定の予定は「0kg」と出さない
        if (done && ex.kind === 'run') {
          const kcal = runCalories(getState().bodyLogs, e.date, e.actual.distanceKm);
          if (kcal != null) summary += ` ・ 約${Math.round(kcal)}kcal`;
        }
        const pr = prByEntry.get(e.id);
        const tag = ex.bodyPart ? `<span class="tag">${BODY_PARTS[ex.bodyPart]}</span>` : '';
        const range = e.time ? `${e.time}〜${fromMin(toMin(e.time) + (e.durationMin || DEFAULT_TRAINING_MIN))}` : '';
        // プログラムの1回ぶん(同じ sessionKey)の先頭に、見出しと「日時を変える」を付ける
        let head = '';
        const key = e.sessionKey ? `${e.sessionKey}|${e.time || ''}` : null;
        if (key && key !== lastKey) head = sessionHead(e, range, sorted.filter((x) => x.sessionKey === e.sessionKey && (x.time || '') === (e.time || '')));
        lastKey = key;
        return `${head}<li><button type="button" class="entry ${e.status} ${key ? 'in-session' : ''}" data-action="edit" data-id="${e.id}">
          <span class="entry-mark">${done ? '✓' : ''}</span>
          <span class="entry-main">
            <span class="entry-name">${esc(ex.name)}${tag}</span>
            <span class="entry-sub">${range && !key ? `${range} ・ ` : ''}${done ? '' : '予定 '}${esc(summary)}</span>
            ${e.memo && !done ? `<span class="entry-sub">${esc(e.memo)}</span>` : ''}
            ${pr ? `<span class="entry-pr">🏆 自己ベスト ${pr.join('・')}</span>` : ''}
          </span>
          <span class="chev">›</span>
        </button></li>`;
      })
      .join('')}</ul>`;
  }

  // プログラムの1回ぶんの見出し。未実施の種目が残っていれば、まとめて日時を変えられる。
  function sessionHead(e, range, group) {
    const movable = group.some((x) => x.status === 'planned');
    const moving = ui.moving === e.sessionKey;
    const s = settings();
    const times = timeOptions(s.timeStepMin, toMin(s.dayStart), toMin(s.dayEnd) - s.timeStepMin);
    if (e.time && !times.includes(e.time)) times.push(e.time);
    times.sort();
    return `<li class="session-head">
      <span class="entry-main"><span class="entry-name">${esc(e.sessionLabel || 'プログラム')}<span class="tag">プログラム</span></span>
        <span class="entry-sub">${range || '時間未定'} ・ ${group.length}種目</span></span>
      ${movable ? `<button type="button" class="btn-ghost" data-action="move-session" data-key="${e.sessionKey}">${moving ? 'やめる' : '日時を変える'}</button>` : ''}
      ${
        moving
          ? `<div class="session-move">
              <input type="date" data-move="date" value="${e.date}" aria-label="移す日付">
              <select data-move="time" aria-label="移す時刻"><option value="">未定</option>${times.map((t) => `<option ${t === e.time ? 'selected' : ''}>${t}</option>`).join('')}</select>
              <button type="button" class="btn-primary" data-action="apply-move" data-key="${e.sessionKey}" data-from="${e.date}">移す</button>
            </div>`
          : ''
      }
    </li>`;
  }

  function eventList(occurrences) {
    if (!occurrences.length) return '<p class="empty">予定はありません</p>';
    return `<ul class="entry-list">${occurrences
      .map(
        (o) => `<li><button type="button" class="entry" data-action="edit-event" data-id="${o.event.id}" data-date="${o.date}">
          <span class="ev-swatch ${o.event.kind}"></span>
          <span class="entry-main">
            <span class="entry-name">${esc(o.event.title)}<span class="tag">${EVENT_KINDS[o.event.kind]}</span></span>
            <span class="entry-sub">${o.start}〜${o.end}${o.event.repeat ? ' ・ 繰り返し' : ''}${o.changed ? ' ・ この回だけ時間変更' : ''}</span>
          </span>
          <span class="chev">›</span>
        </button></li>`,
      )
      .join('')}</ul>`;
  }

  // トレーニングと予定の重なり。振り替え候補をボタンで出す。
  function conflictHtml(today) {
    const { entries, events } = getState();
    const conflicts = findConflicts(entries, events, today, addDays(today, CONFLICT_DAYS));
    if (!conflicts.length) return '';
    const s = settings();
    const items = conflicts
      .map(({ entry, occurrence: o }) => {
        const options = rescheduleOptions(entry, events, entries, { dayStart: toMin(s.dayStart), dayEnd: toMin(s.dayEnd), step: s.timeStepMin });
        return `<li>
          <span><b>${formatDateJa(entry.date)} ${entry.time}</b> ${esc(entry.sessionKey ? entry.sessionLabel || 'プログラム' : nameOf(entry))}</span>
          <span class="entry-sub">「${esc(o.event.title)}」(${o.start}〜${o.end})と重なっています</span>
          <span class="chip-picker">${
            options.length
              ? options
                  .map(
                    (c) => `<button type="button" class="chip link" data-action="move-entry" data-id="${entry.id}" data-date="${c.date}" data-time="${c.time}">
                      ${c.date === entry.date ? '同じ日' : formatShortDate(c.date)} ${c.time} に移す</button>`,
                  )
                  .join('')
              : '<span class="entry-sub">近い日に空き時間が見つかりません。メニューを開いて日時を変えてください</span>'
          }</span></li>`;
      })
      .join('');
    return `<section class="card conflict" data-conflicts>
      <h2>⚠ 予定と重なっています<small>${conflicts.length}件</small></h2>
      <ul class="conflict-list">${items}</ul>
    </section>`;
  }

  function monthHtml(today, byDate) {
    const grid = monthGrid(ui.year, ui.month).flat();
    const eventDates = new Set(expandEvents(getState().events, grid[0].date, grid.at(-1).date).map((o) => o.date));
    const cells = grid
      .map((c) => {
        const cls = ['day'];
        if (!c.inMonth) cls.push('out');
        if (c.date === today) cls.push('today');
        if (c.date === ui.selected) cls.push('selected');
        return `<button type="button" class="${cls.join(' ')}" data-action="select" data-date="${c.date}">
          <span class="day-num">${c.day}</span>
          <span class="dots">${dots(byDate.get(c.date) || [])}</span>
          ${eventDates.has(c.date) ? '<i class="ev-mark" title="予定あり"></i>' : ''}
        </button>`;
      })
      .join('');
    return `<div class="weekdays">${['月', '火', '水', '木', '金', '土', '日'].map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="grid">${cells}</div>
      <div class="legend">
        <span><i class="dot strength planned"></i>筋トレ予定</span>
        <span><i class="dot strength done"></i>実施済み</span>
        <span><i class="dot run planned"></i>ラン予定</span>
        <span><i class="dot run done"></i>実施済み</span>
        <span><i class="ev-mark"></i>予定あり</span>
      </div>`;
  }

  function timelineSection(today) {
    const s = settings();
    const first = ui.view === 'week' ? weekStart(ui.selected) : ui.selected;
    const dates = Array.from({ length: ui.view === 'week' ? 7 : 1 }, (_, i) => addDays(first, i));
    const { entries, events } = getState();
    return `${timelineHtml({
      dates,
      today,
      selected: ui.selected,
      occurrences: expandEvents(events, dates[0], dates.at(-1)),
      entries: entries.filter((e) => e.date >= dates[0] && e.date <= dates.at(-1)),
      dayStart: s.dayStart,
      dayEnd: s.dayEnd,
      nameOf,
    })}
      <div class="legend">
        <span><i class="ev-swatch school"></i>学校</span><span><i class="ev-swatch work"></i>バイト</span>
        <span><i class="ev-swatch other"></i>その他</span><span><i class="ev-swatch training"></i>トレーニング</span>
      </div>
      <p class="hint after">空いている所をタップすると予定を追加できます。予定の上下の端をドラッグすると時間を変えられます。</p>`;
  }

  function title() {
    if (ui.view === 'month') return `${ui.year}年${ui.month + 1}月`;
    if (ui.view === 'day') return formatDateJa(ui.selected);
    const from = weekStart(ui.selected);
    return `${formatShortDate(from)}〜${formatShortDate(addDays(from, 6))}`;
  }

  function render() {
    const today = toDateStr(new Date());
    if (pendingDate) {
      selectDate(pendingDate);
      pendingDate = null;
    }
    const { entries, events, exercises } = getState();
    const byDate = new Map();
    for (const e of entries) {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date).push(e);
    }
    const prByEntry = new Map();
    for (const u of computePRs(entries, exercises).updates) {
      if (!prByEntry.has(u.entryId)) prByEntry.set(u.entryId, []);
      prByEntry.get(u.entryId).push(PR_LABELS[u.type]);
    }
    const unit = { month: '月', week: '週', day: '日' }[ui.view];
    const week = weekStart(ui.selected);

    root.innerHTML = `
      ${conflictHtml(today)}
      <section class="card cal">
        <header class="cal-head">
          <button type="button" class="title-btn" data-action="prev" aria-label="前の${unit}">‹</button>
          <h1>${title()}</h1>
          <button type="button" class="title-btn" data-action="next" aria-label="次の${unit}">›</button>
          <button type="button" class="title-btn text" data-action="today">今日</button>
        </header>
        <div class="segmented fill view-switch" role="group" aria-label="表示">
          ${Object.entries(VIEWS)
            .map(([k, v]) => `<button type="button" data-action="view" data-key="${k}" aria-pressed="${k === ui.view}">${v}</button>`)
            .join('')}
        </div>
        ${ui.view === 'month' ? monthHtml(today, byDate) : timelineSection(today)}
      </section>
      <section class="card day-panel">
        <h2>${formatDateJa(ui.selected)}</h2>
        <h3>トレーニング</h3>
        ${entryList(byDate.get(ui.selected) || [], prByEntry)}
        <button type="button" class="btn-primary wide" data-action="add">＋ メニューを追加</button>
        <h3>予定(学校・バイトなど)</h3>
        ${eventList(expandEvents(events, ui.selected, ui.selected))}
        <button type="button" class="btn-ghost wide" data-action="add-event">＋ 予定を追加</button>
      </section>
      <section class="card">
        <h2>予定の便利機能</h2>
        <button type="button" class="btn-ghost wide first" data-action="term">時間割をまとめて登録(学期ごと)</button>
        <button type="button" class="btn-ghost wide" data-action="copy-week">先週のバイトをこの週にコピー</button>
        <p class="hint after">コピー先: ${formatShortDate(week)}〜${formatShortDate(addDays(week, 6))} の週(上で選んでいる日の週)。繰り返しにしていないバイトの予定だけを写します。</p>
      </section>`;
  }

  // 予定を変えたあとに呼ぶ。重なりができていたら知らせる。
  function afterScheduleChange() {
    render();
    const box = root.querySelector('[data-conflicts]');
    if (box) {
      toast('トレーニングと重なる予定があります');
      box.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  const resize = attachResize(root, {
    getStep: () => settings().timeStepMin,
    getRange: () => [toMin(settings().dayStart), toMin(settings().dayEnd)],
    onResize(id, date, start, end) {
      const { events } = getState();
      const ev = events.find((e) => e.id === id);
      // 繰り返しの予定を伸縮したときは、その回だけを変える
      setEvents(editEvent(events, id, date, 'one', { start, end }, () => makeId('ev')));
      toast(ev.repeat ? `この回だけ ${start}〜${end} に変更しました` : `${start}〜${end} に変更しました`);
      afterScheduleChange();
    },
  });

  root.addEventListener('click', (ev) => {
    if (resize.justDragged()) return; // 伸縮の直後のタップは無視する
    const t = ev.target.closest('[data-action]');
    if (!t) {
      // タイムラインの空いている所 → その時刻で予定を追加
      const col = ev.target.closest('.tl-col');
      if (col && ev.target === col) {
        const s = settings();
        const start = minuteAt(col, ev.clientY, s.dayStart, s.timeStepMin);
        const end = Math.min(start + 60, 1440);
        selectDate(col.dataset.date);
        openEventForm({ date: col.dataset.date, preset: { start: fromMin(start), end: fromMin(end) }, onChange: afterScheduleChange });
      }
      return;
    }
    switch (t.dataset.action) {
      case 'prev':
        shift(-1);
        break;
      case 'next':
        shift(1);
        break;
      case 'today':
        selectDate(toDateStr(new Date()));
        break;
      case 'view':
        ui.view = t.dataset.key;
        selectDate(ui.selected); // 月表示に戻ったとき、選んでいる日の月を出す
        break;
      case 'select':
        selectDate(t.dataset.date);
        break;
      case 'add':
        openEntryForm({ date: ui.selected, onChange: afterScheduleChange });
        return;
      case 'edit': {
        const entry = getEntry(t.dataset.id);
        selectDate(entry.date);
        openEntryForm({ date: entry.date, entryId: entry.id, onChange: afterScheduleChange });
        return;
      }
      case 'add-event':
        openEventForm({ date: ui.selected, onChange: afterScheduleChange });
        return;
      case 'edit-event':
        openEventForm({ date: t.dataset.date, eventId: t.dataset.id, onChange: afterScheduleChange });
        return;
      case 'term':
        openTermForm({ onChange: afterScheduleChange });
        return;
      case 'copy-week': {
        const to = weekStart(ui.selected);
        const added = copyWeek(getState().events, addDays(to, -7), to, 'work', () => makeId('ev'));
        if (!added.length) {
          toast('コピーできるバイトの予定が先週にありません(またはコピー済みです)');
          return;
        }
        setEvents([...getState().events, ...added]);
        toast(`バイトの予定を${added.length}件コピーしました`);
        afterScheduleChange();
        return;
      }
      case 'move-entry': {
        const entry = getEntry(t.dataset.id);
        // プログラムの1回ぶんは、まとめて動かす
        if (entry.sessionKey) moveSession(entry.sessionKey, entry.date, t.dataset.date, t.dataset.time);
        else upsertEntry({ ...entry, date: t.dataset.date, time: t.dataset.time });
        toast(`${formatDateJa(t.dataset.date)} ${t.dataset.time} に移しました`);
        break;
      }
      case 'move-session':
        ui.moving = ui.moving === t.dataset.key ? null : t.dataset.key;
        break;
      case 'apply-move': {
        const box = t.closest('.session-move');
        const date = box.querySelector('[data-move="date"]').value;
        const time = box.querySelector('[data-move="time"]').value;
        if (!date) return;
        moveSession(t.dataset.key, t.dataset.from, date, time);
        ui.moving = null;
        selectDate(date);
        toast(`${formatDateJa(date)}${time ? ` ${time}` : ''} に移しました`);
        afterScheduleChange();
        return;
      }
    }
    render();
  });

  return { render };
}
