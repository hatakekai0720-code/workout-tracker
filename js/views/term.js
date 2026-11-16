// 学期の時間割をまとめて登録するダイアログ。
import { getState, addTerm, deleteTerm, makeId } from '../data/store.js';
import { toDateStr, addDays, formatShortDate } from '../logic/dates.js';
import { WEEKDAYS, timeOptions, toMin, termEvents } from '../logic/schedule.js';
import { esc, toast } from '../ui/util.js';

const MAX_ROWS = 40;

let dlg = null;
let cur = null; // { name, from, to, rows: [{ day, title, start, end }], onChange, error }

const blankRow = (prev) => ({ day: prev ? prev.day : 0, title: '', start: prev ? prev.end : '09:00', end: prev ? nextEnd(prev.end) : '10:30' });
function nextEnd(start) {
  const list = timeOptions(30, toMin(start) + 30, 1440);
  return list[Math.min(2, list.length - 1)] || '24:00'; // 90分後(授業1コマぶん)
}

function timeSelect(i, key, value) {
  const step = Math.min(getState().settings.timeStepMin, 30); // 授業は 10:30 などがあるので 30分きざみまで出す
  const list = timeOptions(step, key === 'start' ? 0 : step, key === 'start' ? 1440 - step : 1440);
  if (!list.includes(value)) list.push(value);
  list.sort((a, b) => toMin(a) - toMin(b));
  return `<select data-row="${i}" data-key="${key}" aria-label="${key === 'start' ? '開始' : '終了'}">${list
    .map((t) => `<option ${t === value ? 'selected' : ''}>${t}</option>`)
    .join('')}</select>`;
}

function render() {
  const scroll = dlg.querySelector('.sheet-body')?.scrollTop ?? 0;
  const { terms, events } = getState();
  dlg.innerHTML = `<form class="sheet" novalidate>
      <header class="sheet-head">
        <button type="button" class="btn-ghost" data-action="close">閉じる</button>
        <h2>時間割をまとめて登録</h2>
        <button type="submit" class="btn-primary">登録</button>
      </header>
      <div class="sheet-body">
        <p class="hint">学期の期間と、曜日ごとの授業を入れると、学期末まで毎週の予定としてまとめて登録します。休講は、あとでその回を開いて「この日だけ休みにする」で消せます。</p>
        <label class="field"><span>学期の名前</span><input type="text" maxlength="40" data-field="name" value="${esc(cur.name)}" placeholder="例: 後期"></label>
        <div class="row">
          <label class="field"><span>開始日</span><input type="date" data-field="from" value="${cur.from}"></label>
          <label class="field"><span>終了日</span><input type="date" data-field="to" value="${cur.to}"></label>
        </div>
        <h3>授業</h3>
        ${cur.rows
          .map(
            (r, i) => `<div class="term-row">
              <select data-row="${i}" data-key="day" aria-label="曜日">${WEEKDAYS.map((w, d) => `<option value="${d}" ${d === r.day ? 'selected' : ''}>${w}</option>`).join('')}</select>
              <input type="text" maxlength="60" data-row="${i}" data-key="title" value="${esc(r.title)}" placeholder="授業名" aria-label="授業名">
              ${timeSelect(i, 'start', r.start)}
              ${timeSelect(i, 'end', r.end)}
              <button type="button" class="icon-btn" data-action="remove-row" data-index="${i}" aria-label="${i + 1}行目を削除">×</button>
            </div>`,
          )
          .join('')}
        <button type="button" class="btn-ghost wide" data-action="add-row">＋ 授業を追加</button>
        <p class="error" role="alert" ${cur.error ? '' : 'hidden'}>${esc(cur.error)}</p>
        ${
          terms.length
            ? `<h3>登録済みの学期</h3><ul class="entry-list">${terms
                .map(
                  (t) => `<li class="term-item"><span class="entry-main">
                      <span class="entry-name">${esc(t.name)}</span>
                      <span class="entry-sub">${formatShortDate(t.from)}〜${formatShortDate(t.to)} ・ 授業 ${events.filter((e) => e.termId === t.id).length}件</span>
                    </span>
                    <button type="button" class="btn-danger" data-action="delete-term" data-id="${t.id}">削除</button></li>`,
                )
                .join('')}</ul>`
            : ''
        }
      </div>
    </form>`;
  dlg.querySelector('.sheet-body').scrollTop = scroll;
}

function close() {
  const { onChange } = cur;
  dlg.close();
  cur = null;
  onChange();
}

function setup() {
  dlg = document.getElementById('term-dialog');

  dlg.addEventListener('input', (ev) => {
    const t = ev.target;
    // 入力し直したら、前のエラー表示は消す
    cur.error = '';
    dlg.querySelector('.error').hidden = true;
    if (t.dataset.field === 'name') cur.name = t.value;
    else if (t.dataset.key === 'title') cur.rows[Number(t.dataset.row)].title = t.value;
  });

  dlg.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.field === 'from' || t.dataset.field === 'to') cur[t.dataset.field] = t.value;
    else if (t.dataset.key && t.dataset.key !== 'title') {
      const row = cur.rows[Number(t.dataset.row)];
      row[t.dataset.key] = t.dataset.key === 'day' ? Number(t.value) : t.value;
      if (t.dataset.key === 'start' && toMin(row.end) <= toMin(row.start)) {
        row.end = nextEnd(row.start);
        render();
      }
    }
  });

  dlg.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-action]');
    if (!t) return;
    switch (t.dataset.action) {
      case 'close':
        close();
        break;
      case 'add-row':
        if (cur.rows.length < MAX_ROWS) cur.rows.push(blankRow(cur.rows.at(-1)));
        render();
        break;
      case 'remove-row':
        cur.rows.splice(Number(t.dataset.index), 1);
        render();
        break;
      case 'delete-term': {
        const term = getState().terms.find((x) => x.id === t.dataset.id);
        const n = getState().events.filter((e) => e.termId === term.id).length;
        if (!confirm(`「${term.name}」と、その時間割の授業 ${n}件をすべて削除しますか？`)) break;
        deleteTerm(term.id);
        toast(`「${term.name}」を削除しました`);
        render();
        break;
      }
    }
  });

  dlg.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = cur.name.trim();
    const rows = cur.rows.filter((r) => r.title.trim());
    let error = '';
    if (!name) error = '学期の名前を入力してください';
    else if (!cur.from || !cur.to || cur.from > cur.to) error = '学期の開始日と終了日を正しく入力してください';
    else if (!rows.length) error = '授業を1つ以上入力してください(授業名が空の行は登録されません)';
    else if (rows.some((r) => toMin(r.start) >= toMin(r.end))) error = '終了は開始より後の時刻にしてください';
    if (error) {
      cur.error = error;
      return render();
    }
    const term = { id: makeId('term'), name, from: cur.from, to: cur.to };
    const events = termEvents(term, rows.map((r) => ({ ...r, title: r.title.trim() })), () => makeId('ev'));
    addTerm(term, events);
    toast(`「${name}」の授業を${events.length}件登録しました`);
    close();
  });

  dlg.addEventListener('cancel', (ev) => {
    ev.preventDefault();
    close();
  });
}

export function openTermForm({ onChange }) {
  if (!dlg) setup();
  const today = toDateStr(new Date());
  cur = { name: '', from: today, to: addDays(today, 7 * 15), rows: [blankRow(null)], onChange, error: '' };
  render();
  dlg.showModal();
}
