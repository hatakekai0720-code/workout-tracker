// ホーム: 今週のまとめ・継続日数、次のメニュー提案、自己ベスト。
import { getState, getExercise, upsertEntry, BODY_PARTS } from '../store.js';
import { toDateStr, formatDateJa, formatShortDate, describePlan } from '../calc.js';
import { computePRs, streak, weekSummary, formatPR, PR_LABELS } from '../insights.js';
import { buildSuggestions, defaultTargetDate } from '../suggest.js';
import { openEntryForm } from './entry.js';
import { esc, toast } from '../util.js';

const RECENT_PR_COUNT = 5;
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
    const { items, skippedParts } = buildSuggestions(state, ui.target);
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

  function render() {
    const state = getState();
    const today = toDateStr(new Date());
    root.innerHTML = `
      <header class="page-head"><h1>ホーム</h1><span class="page-date">${formatDateJa(today)}</span></header>
      ${summaryHtml(state, today)}
      ${suggestHtml(state, today)}
      ${prHtml(state)}`;
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
