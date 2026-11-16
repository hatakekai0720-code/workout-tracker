// 自動メニュー作成: できたプログラムの確認画面。
import { getState, getExercise, BODY_PARTS } from '../../data/store.js';
import { guideFor, LEVELS } from '../../data/guides.js';
import { GOALS, swapOptions } from '../../logic/program.js';
import { esc } from '../../ui/util.js';
import { ui, context } from './state.js';

// ---- 確認画面 ----

const fmtKg = (n) => `${Math.round(n * 10) / 10}kg`;

function itemHtml(t, tIndex, it, iIndex, weekItem) {
  const ex = getExercise(it.exerciseId);
  const g = guideFor(ex);
  const weight = ex.loadType !== 'weighted' ? '' : weekItem.weightKg === null ? ' ・ 重さは初回に決める' : ` ・ ${fmtKg(weekItem.weightKg)}`;
  const swapping = ui.cur.swapping === `${tIndex}:${iIndex}`;
  const options = swapping ? swapOptions(ui.cur.result.templates, tIndex, iIndex, ui.cur.config, context()) : [];
  return `<li class="prog-item">
    <div class="prog-main">
      <span class="entry-name">${esc(ex.name)}${ex.bodyPart ? `<span class="tag">${BODY_PARTS[ex.bodyPart]}</span>` : ''}</span>
      <span class="entry-sub">${weekItem.sets}セット × ${weekItem.reps}${weekItem.unit}${weight} ・ 休憩${weekItem.restSec}秒${g?.compound ? '' : ' ・ 単関節'}</span>
    </div>
    <button type="button" class="btn-ghost" data-action="swap" data-t="${tIndex}" data-i="${iIndex}">${swapping ? 'やめる' : '入れ替え'}</button>
    ${
      swapping
        ? `<div class="prog-swap">${
            options.length
              ? options.map((x) => `<button type="button" class="chip link" data-action="swap-to" data-t="${tIndex}" data-i="${iIndex}" data-id="${x.id}">${esc(x.name)}</button>`).join('')
              : '<span class="entry-sub">同じ部位で入れ替えられる種目がありません</span>'
          }</div>`
        : ''
    }
  </li>`;
}

export function previewHtml() {
  const { result, config } = ui.cur;
  const week = result.weeks[ui.cur.week];
  const saved = getState().program;
  const summary = `${GOALS[config.goal]} ・ ${config.weeks}週 ・ 週${result.templates.length}回 ・ ${config.minutes}分 ・ ${LEVELS[config.level]}`;
  return `<div class="sheet">
    <header class="sheet-head">
      <button type="button" class="btn-ghost" data-action="close">閉じる</button>
      <h2>プログラムの確認</h2>
      <button type="button" class="btn-primary" data-action="save">保存</button>
    </header>
    <div class="sheet-body">
      <p class="prev"><b>内容</b>${summary}</p>
      <section class="group"><h3>なぜこのメニューか</h3>
        <ul class="bullets">${result.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      </section>

      <div class="week-nav">
        <button type="button" class="icon-btn" data-action="week" data-dir="-1" ${ui.cur.week === 0 ? 'disabled' : ''} aria-label="前の週">‹</button>
        <b>第${ui.cur.week + 1}週 / ${config.weeks}週${week.deload ? '<span class="tag deload">軽めの週</span>' : ''}</b>
        <button type="button" class="icon-btn" data-action="week" data-dir="1" ${ui.cur.week === config.weeks - 1 ? 'disabled' : ''} aria-label="次の週">›</button>
      </div>
      <div class="week-strip" aria-label="週の一覧">${result.weeks
        .map((w) => `<button type="button" class="${w.index === ui.cur.week ? 'on' : ''} ${w.deload ? 'deload' : ''}" data-action="goto-week" data-week="${w.index}" aria-label="第${w.index + 1}週${w.deload ? '(軽めの週)' : ''}">${w.index + 1}</button>`)
        .join('')}</div>

      ${week.sessions
        .map(
          (s, tIndex) => `<section class="group prog-session">
            <h3>${tIndex + 1}回目 ${esc(s.label)}${s.gym ? '<span class="tag">ジム</span>' : ''}<small>約${s.minutes}分</small></h3>
            <ul class="prog-list">${result.templates[tIndex].items.map((it, iIndex) => itemHtml(result.templates[tIndex], tIndex, it, iIndex, s.items[iIndex])).join('')}</ul>
          </section>`,
        )
        .join('')}
      ${week.runs.length ? `<section class="group"><h3>ランニング</h3><p>週 ${week.runs.length} 回 ・ 1回 ${week.runs[0]}km</p></section>` : ''}

      <button type="button" class="btn-ghost wide" data-action="regenerate">作り直す(別の種目の組み合わせ)</button>
      <button type="button" class="btn-ghost wide" data-action="back">入力内容を変える</button>
      <button type="button" class="btn-primary wide" data-action="save">${saved ? 'このプログラムに置き換えて保存' : 'このプログラムを保存'}</button>
      <p class="hint after">保存すると、続けて日程に入れる画面に進みます。</p>
      ${saved && ui.cur.viewing ? '<button type="button" class="btn-primary wide" data-action="place">日程に入れる(空き時間に自動で配置)</button>' : ''}
      ${saved && ui.cur.viewing ? '<button type="button" class="btn-danger wide" data-action="delete">保存したプログラムを削除</button>' : ''}
    </div>
  </div>`;
}
