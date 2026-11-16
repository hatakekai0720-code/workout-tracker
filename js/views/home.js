// ホーム: 今週のまとめ・継続日数、次のメニュー提案、自己ベスト。
import { getState, getExercise, upsertEntry, removeProgramEntries, BODY_PARTS } from '../data/store.js';
import { toDateStr, formatDateJa, formatShortDate, dayNumber, addDays } from '../logic/dates.js';
import { describePlan } from '../logic/training.js';
import { timerHtml, refreshTimers } from '../ui/timer.js';
import { computePRs, streak, weekSummary, formatPR, PR_LABELS } from '../logic/insights.js';
import { buildSuggestions, defaultTargetDate } from '../logic/suggest.js';
import { isAvailable } from '../data/guides.js';
import { openEntryForm } from './entry.js';
import { openProgram } from './program.js';
import { focusCalendarDate } from './calendar.js';
import { toMin, fromMin, DEFAULT_TRAINING_MIN } from '../logic/schedule.js';
import { GOALS } from '../logic/program.js';
import { esc, toast } from '../ui/util.js';

const RECENT_PR_COUNT = 5;
const BACKUP_REMIND_DAYS = 14;
const round1 = (n) => (Math.round(n * 10) / 10).toString();

export function mountHome(root) {
  const ui = { target: null };
  let current = []; // 表示中の提案(ボタンの data-index から引く)

  const tile = (label, value, unit, note = '', cls = '') => `<div class="tile ${cls}">
      <span class="tile-label">${label}</span>
      <span class="tile-value">${value}<small>${value === '—' ? '' : unit}</small></span>
      <span class="tile-note">${note}</span>
    </div>`;

  function summaryHtml(state, today) {
    const s = weekSummary(state.entries, state.exercises, state.bodyLogs, today);
    const n = streak(state.entries, today);
    return `<section class="card">
      <h2>今週のまとめ<small>${formatShortDate(s.from)}〜${formatShortDate(s.to)}</small></h2>
      <div class="tiles">
        ${tile('継続', n, '日', n > 0 ? '予定した日を続けて実施中' : '次の実施でスタート', 'wide-tile')}
        ${tile('実施した日', s.days, '日')}
        ${tile('総距離', round1(s.distanceKm), 'km')}
        ${tile('総挙上量', Math.round(s.volumeKg).toLocaleString('ja-JP'), 'kg')}
        ${tile(
          'ランの消費(概算)',
          s.kcal != null ? Math.round(s.kcal).toLocaleString('ja-JP') : s.distanceKm > 0 ? '—' : '0',
          'kcal',
          s.kcal == null && s.distanceKm > 0 ? '体重の記録が必要です' : '体重 × 距離',
        )}
      </div>
    </section>`;
  }

  function suggestHtml(state, today) {
    if (!ui.target || ui.target < today) ui.target = defaultTargetDate(state.entries, today);
    const { items, skippedParts } = buildSuggestions(state, ui.target, isAvailable);
    current = items;
    const addable = items.filter((i) => i.plan).length;
    const list = items.length
      ? `<ul class="sug-list">${items
          .map((s, i) => {
            const ex = s.exercise;
            const tag = ex.bodyPart ? `<span class="tag">${BODY_PARTS[ex.bodyPart]}</span>` : '';
            const button = s.plan
              ? `<button type="button" class="btn-primary" data-action="add" data-index="${i}">予定に追加</button>`
              : s.tone === 'new'
                ? `<button type="button" class="btn-ghost" data-action="input" data-index="${i}">入力する</button>`
                : '';
            return `<li class="sug ${s.tone}">
              <div class="sug-main">
                <span class="entry-name">${esc(ex.name)}${tag}</span>
                ${s.plan ? `<span class="sug-plan">${esc(describePlan(ex, s.plan))}</span>` : ''}
                <span class="sug-reason">${esc(s.reason)}</span>
              </div>
              ${button}
            </li>`;
          })
          .join('')}</ul>`
      : '<p class="empty">この日に提案できるメニューはありません</p>';
    return `<section class="card">
      <h2>次のメニュー提案</h2>
      <label class="field"><span>予定に入れる日</span>
        <input type="date" data-field="target" value="${ui.target}" min="${today}"></label>
      ${
        skippedParts.length
          ? `<p class="sug-note">前日に入っている部位(${skippedParts.map((p) => BODY_PARTS[p]).join('・')})は外しています</p>`
          : ''
      }
      ${list}
      ${addable >= 2 ? '<button type="button" class="btn-ghost wide" data-action="add-all">すべて予定に追加</button>' : ''}
    </section>`;
  }

  function prHtml(state) {
    const { bests, updates } = computePRs(state.entries, state.exercises);
    if (!bests.length) {
      return `<section class="card"><h2>🏆 自己ベスト</h2><p class="empty">実施済みの記録が入ると、ここに自己ベストが並びます</p></section>`;
    }
    const recent = updates
      .slice()
      .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0))
      .slice(0, RECENT_PR_COUNT)
      .map(
        (u) => `<li><span class="pr-date">${formatShortDate(u.date)}</span>
          <span class="pr-what">🏆 ${esc(getExercise(u.exerciseId).name)} ${PR_LABELS[u.type]}</span>
          <span class="pr-value">${formatPR(u.type, u.value)}<small>前 ${formatPR(u.type, u.previous)}</small></span></li>`,
      )
      .join('');
    const rows = state.exercises
      .map((ex) => {
        const mine = bests.filter((b) => b.exerciseId === ex.id);
        if (!mine.length) return '';
        return `<tr><th>${esc(ex.name)}</th><td>${mine
          .map((b) => `<span class="pr-item">${PR_LABELS[b.type]} <b>${formatPR(b.type, b.value)}</b><small>${formatShortDate(b.date)}</small></span>`)
          .join('')}</td></tr>`;
      })
      .join('');
    return `<section class="card">
      <h2>🏆 自己ベスト</h2>
      <h3>最近の更新</h3>
      ${recent ? `<ul class="pr-recent">${recent}</ul>` : '<p class="empty">まだ更新はありません</p>'}
      <h3>一覧</h3>
      <table class="pr-table"><tbody>${rows}</tbody></table>
    </section>`;
  }

  // 記録があるのに長くバックアップしていなければ知らせる
  function backupHtml(state, today) {
    if (!state.entries.length && !state.bodyLogs.length) return '';
    const last = state.settings.lastBackupAt;
    const days = last ? dayNumber(today) - dayNumber(last) : null;
    if (days !== null && days < BACKUP_REMIND_DAYS) return '';
    return `<a class="notice" href="#settings">💾 ${
      days === null ? 'まだバックアップしていません' : `最後のバックアップから${days}日たちました`
    }。設定から書き出せます ›</a>`;
  }

  // 自動メニュー作成で保存したプログラム
  function programHtml(state) {
    const p = state.program;
    if (!p) {
      return `<section class="card"><h2>プログラム</h2>
        <p class="hint">目的・回数・使える器具などを選ぶと、数週間ぶんのメニューを自動で組み立てます。</p>
        <button type="button" class="btn-primary wide first" data-action="program-new">メニューを自動で作る</button>
      </section>`;
    }
    const c = p.config;
    const mine = state.entries.filter((e) => e.programId === p.id);
    const sessions = (status) => new Set(mine.filter((e) => e.status === status).map((e) => `${e.date}|${e.sessionKey}`)).size;
    const left = sessions('planned');
    const placed = mine.length > 0;
    return `<section class="card"><h2>プログラム</h2>
      <p class="prog-summary"><b>${esc(p.name)}</b><span>${GOALS[c.goal]} ・ 1回${c.minutes}分${c.run.perWeek ? ` ・ ラン週${c.run.perWeek}回` : ''}${p.createdAt ? ` ・ ${formatShortDate(p.createdAt)}作成` : ''}</span>
        <span>${placed ? `カレンダーに登録済み: 残り ${left}回 ・ 実施 ${sessions('done')}回` : 'まだカレンダーに入れていません'}</span></p>
      <button type="button" class="btn-primary wide first" data-action="program-place">${placed ? '日程を入れ直す' : '日程に入れる(空き時間に自動で配置)'}</button>
      <button type="button" class="btn-ghost wide" data-action="program-view">内容を見る</button>
      ${left ? '<button type="button" class="btn-ghost wide" data-action="program-unplace">日程を取り消す(未実施の予定を消す)</button>' : ''}
      <button type="button" class="btn-ghost wide" data-action="program-new">条件を変えて作り直す</button>
    </section>`;
  }

  // プログラムの次の回(今日以降で、まだ実施していない一番近い回)
  function nextSessionHtml(state, today) {
    const p = state.program;
    if (!p) return '';
    const upcoming = state.entries
      .filter((e) => e.programId === p.id && e.status === 'planned' && e.date >= today)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : toMin(a.time || '24:00') - toMin(b.time || '24:00')));
    if (!upcoming.length) return '';
    const first = upcoming[0];
    const group = upcoming.filter((e) => e.date === first.date && e.sessionKey === first.sessionKey);
    const when = first.date === today ? '今日' : first.date === addDays(today, 1) ? '明日' : formatDateJa(first.date);
    const range = first.time ? ` ${first.time}〜${fromMin(toMin(first.time) + (first.durationMin || DEFAULT_TRAINING_MIN))}` : ' 時間未定';
    return `<section class="card">
      <h2>次のプログラム<small>${when}${range}</small></h2>
      <p class="prog-summary"><b>${esc(first.sessionLabel || 'プログラム')}</b><span>${formatDateJa(first.date)}${range} ・ ${group.length}種目</span></p>
      <ul class="entry-list compact">${group
        .map((e) => {
          const ex = getExercise(e.exerciseId);
          return `<li class="next-item"><span class="entry-main"><span class="entry-name">${esc(ex.name)}</span>
            <span class="entry-sub">${esc(describePlan(ex, e.plan).replace(/^0kg × /, ''))}${e.memo ? ` ・ ${esc(e.memo)}` : ''}</span></span></li>`;
        })
        .join('')}</ul>
      <button type="button" class="btn-primary wide" data-action="open-calendar" data-date="${first.date}">カレンダーで開いて記録する</button>
    </section>`;
  }

  function render() {
    const state = getState();
    const today = toDateStr(new Date());
    root.innerHTML = `
      <header class="page-head"><h1>ホーム</h1><span class="page-date">${formatDateJa(today)}</span></header>
      ${backupHtml(state, today)}
      ${summaryHtml(state, today)}
      ${programHtml(state)}
      <section class="card"><h2>インターバルタイマー</h2>${timerHtml()}</section>
      ${nextSessionHtml(state, today) || suggestHtml(state, today)}
      ${prHtml(state)}`;
    refreshTimers();
  }

  const planned = (s) => ({ id: null, date: ui.target, exerciseId: s.exercise.id, status: 'planned', plan: s.plan, actual: null, memo: '' });

  root.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-action]');
    if (!t) return;
    const s = current[Number(t.dataset.index)];
    switch (t.dataset.action) {
      case 'add':
        upsertEntry(planned(s));
        toast(`${formatDateJa(ui.target)}の予定に追加しました`);
        render();
        break;
      case 'add-all': {
        const items = current.filter((i) => i.plan);
        items.forEach((i) => upsertEntry(planned(i)));
        toast(`${formatDateJa(ui.target)}の予定に${items.length}件追加しました`);
        render();
        break;
      }
      case 'program-new':
        openProgram({ onChange: render });
        break;
      case 'program-place':
        openProgram({ place: true, onChange: render });
        break;
      case 'program-unplace': {
        const n = getState().entries.filter((e) => e.programId === getState().program.id && e.status === 'planned').length;
        if (!confirm(`カレンダーに登録した未実施の予定 ${n}件を消します。実施済みの記録は残ります。よろしいですか？`)) break;
        removeProgramEntries(getState().program.id);
        toast('日程を取り消しました');
        render();
        break;
      }
      case 'open-calendar':
        focusCalendarDate(t.dataset.date);
        location.hash = '#calendar';
        break;
      case 'program-view':
        openProgram({ view: true, onChange: render });
        break;
      case 'input':
        openEntryForm({ date: ui.target, exerciseId: s.exercise.id, onChange: render });
        break;
    }
  });

  root.addEventListener('change', (ev) => {
    if (ev.target.dataset.field !== 'target' || !ev.target.value) return;
    ui.target = ev.target.value;
    render();
  });

  return {
    render() {
      ui.target = null;
      render();
    },
  };
}
