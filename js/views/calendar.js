// 月カレンダーと、選んだ日のメニュー一覧。
import { getState, getExercise, BODY_PARTS } from '../store.js';
import { toDateStr, monthGrid, formatDateJa, describePlan, describeActual } from '../calc.js';
import { openEntryForm } from './entry.js';
import { esc } from '../util.js';

const MAX_DOTS = 4;

export function mountCalendar(root) {
  const now = new Date();
  const ui = { year: now.getFullYear(), month: now.getMonth(), selected: toDateStr(now) };

  function shiftMonth(delta) {
    const d = new Date(ui.year, ui.month + delta, 1);
    ui.year = d.getFullYear();
    ui.month = d.getMonth();
  }

  function dots(entries) {
    const shown = entries.slice(0, MAX_DOTS).map((e) => {
      const kind = getExercise(e.exerciseId)?.kind === 'run' ? 'run' : 'strength';
      return `<i class="dot ${kind} ${e.status}"></i>`;
    });
    if (entries.length > MAX_DOTS) shown.push('<i class="dot-more">+</i>');
    return shown.join('');
  }

  function dayList(entries) {
    if (!entries.length) return '<p class="empty">メニューはまだありません</p>';
    return `<ul class="entry-list">${entries
      .map((e) => {
        const ex = getExercise(e.exerciseId);
        const done = e.status === 'done';
        const summary = done ? describeActual(ex, e.actual) : describePlan(ex, e.plan);
        const tag = ex.bodyPart ? `<span class="tag">${BODY_PARTS[ex.bodyPart]}</span>` : '';
        return `<li><button type="button" class="entry ${e.status}" data-action="edit" data-id="${e.id}">
          <span class="entry-mark">${done ? '✓' : ''}</span>
          <span class="entry-main">
            <span class="entry-name">${esc(ex.name)}${tag}</span>
            <span class="entry-sub">${done ? '' : '予定 '}${esc(summary)}</span>
          </span>
          <span class="chev">›</span>
        </button></li>`;
      })
      .join('')}</ul>`;
  }

  function render() {
    const today = toDateStr(new Date());
    const byDate = new Map();
    for (const e of getState().entries) {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date).push(e);
    }
    const cells = monthGrid(ui.year, ui.month)
      .flat()
      .map((c) => {
        const cls = ['day'];
        if (!c.inMonth) cls.push('out');
        if (c.date === today) cls.push('today');
        if (c.date === ui.selected) cls.push('selected');
        return `<button type="button" class="${cls.join(' ')}" data-action="select" data-date="${c.date}">
          <span class="day-num">${c.day}</span>
          <span class="dots">${dots(byDate.get(c.date) || [])}</span>
        </button>`;
      })
      .join('');

    root.innerHTML = `
      <header class="cal-head">
        <button type="button" class="icon-btn" data-action="prev" aria-label="前の月">‹</button>
        <h1>${ui.year}年${ui.month + 1}月</h1>
        <button type="button" class="icon-btn" data-action="next" aria-label="次の月">›</button>
        <button type="button" class="btn-ghost" data-action="today">今日</button>
      </header>
      <div class="weekdays">${['月', '火', '水', '木', '金', '土', '日'].map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="grid">${cells}</div>
      <div class="legend">
        <span><i class="dot strength planned"></i>筋トレ予定</span>
        <span><i class="dot strength done"></i>実施済み</span>
        <span><i class="dot run planned"></i>ラン予定</span>
        <span><i class="dot run done"></i>実施済み</span>
      </div>
      <section class="day-panel">
        <h2>${formatDateJa(ui.selected)}</h2>
        ${dayList(byDate.get(ui.selected) || [])}
        <button type="button" class="btn-primary wide" data-action="add">＋ メニューを追加</button>
      </section>`;
  }

  root.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-action]');
    if (!t) return;
    switch (t.dataset.action) {
      case 'prev':
        shiftMonth(-1);
        break;
      case 'next':
        shiftMonth(1);
        break;
      case 'today': {
        const d = new Date();
        ui.year = d.getFullYear();
        ui.month = d.getMonth();
        ui.selected = toDateStr(d);
        break;
      }
      case 'select': {
        ui.selected = t.dataset.date;
        const [y, m] = ui.selected.split('-').map(Number);
        ui.year = y;
        ui.month = m - 1;
        break;
      }
      case 'add':
        openEntryForm({ date: ui.selected, onChange: render });
        return;
      case 'edit':
        openEntryForm({ date: ui.selected, entryId: t.dataset.id, onChange: render });
        return;
    }
    render();
  });

  return { render };
}
