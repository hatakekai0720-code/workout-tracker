// 週・日のタイムライン(縦軸が時間)。予定とトレーニングを時間帯のブロックで並べる。
import { toMin, fromMin, weekdayOf, DEFAULT_TRAINING_MIN, EVENT_KINDS, WEEKDAYS } from '../schedule.js';
import { esc } from '../util.js';

export const HOUR_PX = 44; // 1時間の高さ
const MIN_HANDLE_PX = 34; // これより低いブロックには、下の伸縮つまみだけ付ける

// 重なるブロックを横に並べる。各ブロックに lane(何列目)と lanes(全部で何列)を付ける。
function layout(blocks) {
  blocks.sort((a, b) => a.s - b.s || b.e - a.e);
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(...cluster.map((b) => b.lane)) + 1;
    cluster.forEach((b) => (b.lanes = lanes));
    cluster = [];
  };
  for (const b of blocks) {
    if (cluster.length && b.s >= clusterEnd) flush();
    const used = new Set(cluster.filter((c) => c.e > b.s).map((c) => c.lane));
    b.lane = 0;
    while (used.has(b.lane)) b.lane++;
    cluster.push(b);
    clusterEnd = Math.max(cluster.length === 1 ? b.e : clusterEnd, b.e);
  }
  if (cluster.length) flush();
  return blocks;
}

// dates: 表示する日付の配列(週なら7日、日なら1日)
// occurrences: expandEvents の結果 / entries: トレーニングの記録 / nameOf: 記録 → 種目名
export function timelineHtml({ dates, today, selected, occurrences, entries, dayStart, dayEnd, nameOf }) {
  const from = toMin(dayStart);
  const to = toMin(dayEnd);
  const px = (min) => ((min - from) / 60) * HOUR_PX;
  const hours = [];
  for (let m = Math.ceil(from / 60) * 60; m < to; m += 60) hours.push(m);
  const wide = dates.length === 1;

  const head = dates
    .map((d) => {
      const cls = ['tl-day', d === today ? 'today' : '', d === selected ? 'selected' : ''].join(' ');
      return `<button type="button" class="${cls}" data-action="select" data-date="${d}">
        <span>${WEEKDAYS[weekdayOf(d)]}</span><b>${Number(d.slice(8))}</b></button>`;
    })
    .join('');

  // 時刻のないトレーニングは、上の「時間未定」の段に件数で出す
  const untimed = dates
    .map((d) => {
      const list = entries.filter((e) => e.date === d && !e.time);
      const label = wide ? list.map((e) => esc(nameOf(e))).join('、') : list.length ? `●${list.length}` : '';
      return `<button type="button" class="tl-untimed" data-action="select" data-date="${d}" ${list.length ? '' : 'tabindex="-1"'}>${label}</button>`;
    })
    .join('');

  const columns = dates
    .map((d) => {
      const blocks = [];
      for (const o of occurrences) {
        if (o.date !== d) continue;
        const s = Math.max(toMin(o.start), from);
        const e = Math.min(toMin(o.end), to);
        if (e > s) blocks.push({ type: 'ev', s, e, o });
      }
      const sessions = new Map(); // プログラムの1回ぶん(同じ時刻・同じ sessionKey)は1つにまとめる
      for (const en of entries) {
        if (en.date !== d || !en.time) continue;
        const s = Math.max(toMin(en.time), from);
        const e = Math.min(toMin(en.time) + (en.durationMin || DEFAULT_TRAINING_MIN), to);
        if (e <= s) continue;
        const key = en.sessionKey && `${en.time}|${en.sessionKey}`;
        if (key && sessions.has(key)) sessions.get(key).list.push(en);
        else {
          const block = { type: 'tr', s, e, en, list: [en] };
          if (key) sessions.set(key, block);
          blocks.push(block);
        }
      }
      const html = layout(blocks)
        .map((b) => {
          const height = px(b.e) - px(b.s);
          const style = `top:${px(b.s)}px;height:${height}px;left:${(b.lane / b.lanes) * 100}%;width:${100 / b.lanes}%`;
          if (b.type === 'tr') {
            const grouped = !!b.en.sessionKey;
            const allDone = b.list.every((x) => x.status === 'done');
            const title = grouped ? b.en.sessionLabel || 'プログラム' : nameOf(b.en);
            // まとめたブロックは、タップするとその日を選ぶ(下の一覧で種目ごとに開ける)
            const action = grouped ? `data-action="select" data-date="${d}"` : `data-action="edit" data-id="${b.en.id}"`;
            return `<button type="button" class="tl-block tr ${allDone ? 'done' : 'planned'}" style="${style}" ${action}
              aria-label="${esc(title)} ${b.en.time}">
              <span class="tl-title">${allDone ? '✓ ' : ''}${esc(title)}</span>
              ${wide ? `<span class="tl-time">${b.en.time}〜${grouped ? ` ・ ${b.list.length}種目` : ''}</span>` : ''}</button>`;
          }
          const ev = b.o.event;
          const handles =
            (height >= MIN_HANDLE_PX ? '<i class="tl-handle top" data-edge="top"></i>' : '') + '<i class="tl-handle bottom" data-edge="bottom"></i>';
          return `<div class="tl-block ev ${ev.kind}" style="${style}" role="button" tabindex="0" data-action="edit-event" data-id="${ev.id}" data-date="${d}"
            data-start="${toMin(b.o.start)}" data-end="${toMin(b.o.end)}" aria-label="${esc(ev.title)} ${b.o.start}〜${b.o.end}">
            <span class="tl-title">${ev.repeat ? '↻ ' : ''}${esc(ev.title)}</span>
            ${wide ? `<span class="tl-time">${EVENT_KINDS[ev.kind]} ・ ${b.o.start}〜${b.o.end}</span>` : ''}
            ${handles}</div>`;
        })
        .join('');
      return `<div class="tl-col ${d === today ? 'today' : ''}" data-date="${d}">${html}</div>`;
    })
    .join('');

  return `<div class="tl ${wide ? 'wide' : ''}" style="--cols:${dates.length}">
    <div class="tl-row tl-head"><span class="tl-gutter"></span>${head}</div>
    <div class="tl-row"><span class="tl-gutter small">時間<br>未定</span>${untimed}</div>
    <div class="tl-row tl-body" style="height:${px(to)}px;--hour:${HOUR_PX}px;--offset:${px(Math.ceil(from / 60) * 60)}px">
      <div class="tl-gutter">${hours.map((m) => `<span style="top:${px(m)}px">${m / 60}</span>`).join('')}</div>
      ${columns}
    </div>
  </div>`;
}

// タイムラインの空いている所をタップした位置 → 開始時刻(分)。step 分きざみに丸める。
export function minuteAt(col, clientY, dayStart, step) {
  const y = clientY - col.getBoundingClientRect().top;
  return toMin(dayStart) + Math.floor(((y / HOUR_PX) * 60) / step) * step;
}

// 予定の上下の端をドラッグして時間を伸縮できるようにする。
// onResize(予定のid, 日付, 開始 'HH:MM', 終了 'HH:MM')。返り値の justDragged() は、直後のタップを無視するために使う。
export function attachResize(root, { getStep, getRange, onResize }) {
  let drag = null;
  let draggedAt = 0;

  root.addEventListener('pointerdown', (ev) => {
    const handle = ev.target.closest('.tl-handle');
    if (!handle) return;
    const block = handle.closest('.tl-block');
    ev.preventDefault();
    handle.setPointerCapture(ev.pointerId);
    drag = { handle, block, edge: handle.dataset.edge, y0: ev.clientY, start: Number(block.dataset.start), end: Number(block.dataset.end), s: null, e: null };
    block.classList.add('resizing');
  });

  root.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const step = getStep();
    const [from, to] = getRange();
    const delta = Math.round((((ev.clientY - drag.y0) / HOUR_PX) * 60) / step) * step;
    let s = drag.start;
    let e = drag.end;
    if (drag.edge === 'top') s = Math.min(Math.max(drag.start + delta, from), e - step);
    else e = Math.max(Math.min(drag.end + delta, to), s + step);
    drag.s = s;
    drag.e = e;
    drag.block.style.top = `${((Math.max(s, from) - from) / 60) * HOUR_PX}px`;
    drag.block.style.height = `${((Math.min(e, to) - Math.max(s, from)) / 60) * HOUR_PX}px`;
    const label = drag.block.querySelector('.tl-title');
    label.dataset.live = `${fromMin(s)}〜${fromMin(e)}`;
  });

  const finish = (ev) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    draggedAt = Date.now();
    d.block.classList.remove('resizing');
    if (ev.type === 'pointerup' && d.s !== null && (d.s !== d.start || d.e !== d.end)) {
      onResize(d.block.dataset.id, d.block.dataset.date, fromMin(d.s), fromMin(d.e));
    }
  };
  root.addEventListener('pointerup', finish);
  root.addEventListener('pointercancel', finish);

  return { justDragged: () => Date.now() - draggedAt < 400 };
}
