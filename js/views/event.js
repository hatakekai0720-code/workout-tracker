// 予定(バイト・学校など)の登録・編集ダイアログ。
import { getState, setEvents, saveTemplate, makeId } from '../store.js';
import { formatDateJa, addDays } from '../calc.js';
import { EVENT_KINDS, REPEAT_FREQS, WEEKDAYS, weekdayOf, timeOptions, toMin, fromMin, editEvent, deleteEvent } from '../schedule.js';
import { esc, toast } from '../util.js';

let dlg = null;
let cur = null; // { model, eventId, occurrenceDate, onChange, asking: null | 'save' | 'delete', error }

const opts = (map, value) =>
  Object.entries(map)
    .map(([k, v]) => `<option value="${k}" ${k === value ? 'selected' : ''}>${v}</option>`)
    .join('');

function timeSelect(path, value, from, to) {
  const list = timeOptions(getState().settings.timeStepMin, from, to);
  if (!list.includes(value)) list.push(value); // きざみを変える前に入れた時刻も選べるように
  list.sort((a, b) => toMin(a) - toMin(b));
  return `<select data-path="${path}">${list.map((t) => `<option ${t === value ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
}

function render() {
  const m = cur.model;
  const existing = cur.eventId ? getState().events.find((e) => e.id === cur.eventId) : null;
  const series = !!existing?.repeat; // 繰り返しの予定を、ある回から開いている
  const scroll = dlg.querySelector('.sheet-body')?.scrollTop ?? 0;
  const templates = getState().eventTemplates;

  const repeatFields =
    m.freq === 'none'
      ? ''
      : `${
          m.freq === 'weekly' || m.freq === 'biweekly'
            ? `<div class="field"><span>曜日(複数選べます)</span><div class="chip-picker">${WEEKDAYS.map(
                (w, i) => `<button type="button" class="chip ${m.days.includes(i) ? 'own' : ''}" data-day="${i}" aria-pressed="${m.days.includes(i)}">${w}</button>`,
              ).join('')}</div></div>`
            : ''
        }
        <div class="row">
          <label class="field"><span>いつまで</span><select data-path="endType">${opts({ never: '終わりなし', until: '終了日まで', count: '回数を指定' }, m.endType)}</select></label>
          ${m.endType === 'until' ? `<label class="field"><span>終了日</span><input type="date" data-path="until" value="${m.until}" min="${m.date}"></label>` : ''}
          ${m.endType === 'count' ? `<label class="field"><span>回数</span><input type="number" inputmode="numeric" min="1" max="1000" step="1" data-path="count" value="${esc(m.count)}"></label>` : ''}
        </div>`;

  let actions;
  if (cur.asking === 'save') {
    actions = `<p class="hint">この予定は繰り返しです。どの範囲を変えますか？</p>
      <button type="button" class="btn-ghost wide" data-action="apply" data-scope="one">この回だけ(時間の変更のみ)</button>
      <button type="button" class="btn-ghost wide" data-action="apply" data-scope="future">これ以降すべて</button>
      <button type="button" class="btn-ghost wide" data-action="apply" data-scope="all">すべて</button>
      <button type="button" class="btn-ghost wide" data-action="cancel-ask">やめる</button>`;
  } else if (cur.asking === 'delete') {
    actions = `<p class="hint">この予定は繰り返しです。どの範囲を消しますか？</p>
      <button type="button" class="btn-danger wide" data-action="remove" data-scope="one">この日だけ休みにする</button>
      <button type="button" class="btn-danger wide" data-action="remove" data-scope="future">これ以降すべて削除</button>
      <button type="button" class="btn-danger wide" data-action="remove" data-scope="all">すべて削除</button>
      <button type="button" class="btn-ghost wide" data-action="cancel-ask">やめる</button>`;
  } else {
    actions = `${cur.eventId ? '<button type="button" class="btn-danger wide" data-action="ask-delete">この予定を削除</button>' : ''}
      <button type="button" class="btn-ghost wide" data-action="save-template">この内容をテンプレートに保存</button>`;
  }

  dlg.innerHTML = `<form class="sheet" novalidate>
      <header class="sheet-head">
        <button type="button" class="btn-ghost" data-action="close">閉じる</button>
        <h2>${cur.eventId ? '予定の編集' : '予定の追加'}</h2>
        <button type="submit" class="btn-primary">保存</button>
      </header>
      <div class="sheet-body">
        ${
          !cur.eventId && templates.length
            ? `<div class="field"><span>テンプレートから入力</span><div class="chip-picker">${templates
                .map((t) => `<button type="button" class="chip link" data-template="${t.id}">${esc(t.title)} ${t.start}〜${t.end}</button>`)
                .join('')}</div></div>`
            : ''
        }
        <label class="field"><span>予定の名前</span><input type="text" maxlength="60" data-path="title" value="${esc(m.title)}" placeholder="例: バイト、統計学"></label>
        <label class="field"><span>種類</span><select data-path="kind">${opts(EVENT_KINDS, m.kind)}</select></label>
        ${
          series
            ? `<p class="prev"><b>この回</b>${formatDateJa(cur.occurrenceDate)}(繰り返しの開始日: ${formatDateJa(existing.date)})</p>`
            : `<label class="field"><span>日付${m.freq === 'none' ? '' : '(繰り返しの開始日)'}</span><input type="date" data-path="date" value="${m.date}"></label>`
        }
        <div class="row">
          <label class="field"><span>開始</span>${timeSelect('start', m.start, 0, 1440 - getState().settings.timeStepMin)}</label>
          <label class="field"><span>終了</span>${timeSelect('end', m.end, getState().settings.timeStepMin, 1440)}</label>
        </div>
        <label class="field"><span>繰り返し</span><select data-path="freq">${opts({ none: 'なし', ...REPEAT_FREQS }, m.freq)}</select></label>
        ${repeatFields}
        <p class="error" role="alert" ${cur.error ? '' : 'hidden'}>${esc(cur.error || '')}</p>
        ${actions}
      </div>
    </form>`;
  dlg.querySelector('.sheet-body').scrollTop = scroll;
}

// 入力内容 → 保存する項目。問題があれば { error }。
function build() {
  const m = cur.model;
  const title = m.title.trim();
  if (!title) return { error: '予定の名前を入力してください' };
  if (!m.date) return { error: '日付を入力してください' };
  if (toMin(m.start) >= toMin(m.end)) return { error: '終了は開始より後の時刻にしてください' };
  let repeat = null;
  if (m.freq !== 'none') {
    const weekly = m.freq === 'weekly' || m.freq === 'biweekly';
    if (weekly && !m.days.length) return { error: '曜日を1つ以上選んでください' };
    const count = Number(m.count);
    if (m.endType === 'until' && (!m.until || m.until < m.date)) return { error: '終了日は開始日以降にしてください' };
    if (m.endType === 'count' && !(Number.isInteger(count) && count >= 1 && count <= 1000)) return { error: '回数は1〜1000で入力してください' };
    repeat = {
      freq: m.freq,
      days: weekly ? [...m.days].sort() : [],
      until: m.endType === 'until' ? m.until : null,
      count: m.endType === 'count' ? count : null,
    };
  }
  return { fields: { title, kind: m.kind, date: m.date, start: m.start, end: m.end, repeat } };
}

function finish(message) {
  const { onChange } = cur;
  dlg.close();
  cur = null;
  if (message) toast(message);
  onChange();
}

function apply(scope) {
  const { fields, error } = build();
  if (error) {
    cur.error = error;
    cur.asking = null;
    return render();
  }
  const { events } = getState();
  if (!cur.eventId) {
    setEvents([...events, { id: makeId('ev'), ...fields, exceptions: {}, termId: null }]);
    return finish('予定を追加しました');
  }
  const existing = events.find((e) => e.id === cur.eventId);
  // 繰り返しの予定では、開始日は画面から変えられないので元のままにする
  const changes = existing.repeat ? { ...fields, date: existing.date } : fields;
  setEvents(editEvent(events, cur.eventId, cur.occurrenceDate, scope, changes, () => makeId('ev')));
  finish(scope === 'one' && existing.repeat ? 'この回だけ時間を変更しました' : '予定を変更しました');
}

function setup() {
  dlg = document.getElementById('event-dialog');

  dlg.addEventListener('input', (ev) => {
    const path = ev.target.dataset.path;
    if (path === 'title' || path === 'count') {
      cur.model[path] = ev.target.value;
      cur.error = '';
      dlg.querySelector('.error').hidden = true; // 入力し直したら、前のエラー表示は消す
    }
  });

  dlg.addEventListener('change', (ev) => {
    const path = ev.target.dataset.path;
    if (!path || path === 'title' || path === 'count') return;
    const m = cur.model;
    m[path] = ev.target.value;
    if (path === 'start' && toMin(m.end) <= toMin(m.start)) m.end = fromMin(Math.min(toMin(m.start) + 60, 1440)); // 終了が前に来ないように
    if (path === 'freq' && !m.days.length) m.days = [weekdayOf(cur.occurrenceDate || m.date)];
    if (path === 'endType' && m.endType === 'until' && !m.until) m.until = addDays(m.date, 28);
    cur.error = '';
    render();
  });

  dlg.addEventListener('click', (ev) => {
    const m = cur.model;
    const day = ev.target.closest('[data-day]');
    if (day) {
      const i = Number(day.dataset.day);
      m.days = m.days.includes(i) ? m.days.filter((d) => d !== i) : [...m.days, i];
      return render();
    }
    const tpl = ev.target.closest('[data-template]');
    if (tpl) {
      const t = getState().eventTemplates.find((x) => x.id === tpl.dataset.template);
      Object.assign(m, { title: t.title, kind: t.kind, start: t.start, end: t.end });
      return render();
    }
    const t = ev.target.closest('[data-action]');
    if (!t) return;
    switch (t.dataset.action) {
      case 'close':
        dlg.close();
        cur = null;
        break;
      case 'cancel-ask':
        cur.asking = null;
        render();
        break;
      case 'apply':
        apply(t.dataset.scope);
        break;
      case 'ask-delete': {
        const existing = getState().events.find((e) => e.id === cur.eventId);
        if (existing.repeat) {
          cur.asking = 'delete';
          render();
          dlg.querySelector('.sheet-body').scrollTop = 1e6;
        } else if (confirm(`「${existing.title}」を削除しますか？`)) {
          setEvents(deleteEvent(getState().events, cur.eventId, cur.occurrenceDate, 'all'));
          finish('予定を削除しました');
        }
        break;
      }
      case 'remove':
        setEvents(deleteEvent(getState().events, cur.eventId, cur.occurrenceDate, t.dataset.scope));
        finish(t.dataset.scope === 'one' ? 'この日だけ休みにしました' : '予定を削除しました');
        break;
      case 'save-template': {
        const { fields, error } = build();
        if (error) {
          cur.error = error;
          render();
          break;
        }
        saveTemplate({ id: makeId('tpl'), title: fields.title, kind: fields.kind, start: fields.start, end: fields.end });
        toast(`テンプレート「${fields.title}」を保存しました`);
        break;
      }
    }
  });

  dlg.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const existing = cur.eventId ? getState().events.find((e) => e.id === cur.eventId) : null;
    if (existing?.repeat) {
      const { error } = build();
      cur.error = error || '';
      cur.asking = error ? null : 'save';
      render();
      if (!error) dlg.querySelector('.sheet-body').scrollTop = 1e6;
    } else apply('all');
  });

  dlg.addEventListener('cancel', () => {
    cur = null;
  });
}

// date: 新しい予定の日付、または開いた回の日付。eventId: 編集する予定。preset: { start, end }(タイムラインのタップ位置)。
export function openEventForm({ date, eventId = null, preset = null, onChange }) {
  if (!dlg) setup();
  let model;
  if (eventId) {
    const ev = getState().events.find((e) => e.id === eventId);
    const ex = ev.exceptions?.[date];
    const r = ev.repeat;
    model = {
      title: ev.title,
      kind: ev.kind,
      date: ev.date,
      start: (ex && !ex.skip && ex.start) || ev.start,
      end: (ex && !ex.skip && ex.end) || ev.end,
      freq: r ? r.freq : 'none',
      days: r?.days?.length ? [...r.days] : [],
      endType: r?.until ? 'until' : r?.count ? 'count' : 'never',
      until: r?.until || '',
      count: r?.count ? String(r.count) : '10',
    };
  } else {
    model = { title: '', kind: 'work', date, start: preset?.start || '09:00', end: preset?.end || '10:00', freq: 'none', days: [], endType: 'never', until: '', count: '10' };
  }
  cur = { model, eventId, occurrenceDate: date, onChange, asking: null, error: '' };
  render();
  dlg.showModal();
}
