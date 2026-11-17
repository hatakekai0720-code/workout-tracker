// 痛み・ケガの記録: 登録・更新のダイアログ、部位ごとの履歴、ホームの「痛みはどう？」、予定の自動調整。
// 調整のルールは js/logic/injury.js。
import { getState, saveInjury, deleteInjury, patchEntries, makeId } from '../data/store.js';
import { musclesOf, stressOf, isAvailable } from '../data/guides.js';
import {
  JOINTS, SIDES, LEVELS, CENTER_PARTS, NEAR_JOINTS, RECOVER_DAYS, partLabel, injuryLabel, currentLevel, isActive, needsCheck,
  recoverFactor, planInjuryAdjustments, historyByPart, withLevel, decide, scalePlan,
} from '../logic/injury.js';
import { suggestStrength } from '../logic/suggest.js';
import { toDateStr, formatShortDate, formatDateJa } from '../logic/dates.js';
import { esc, toast } from '../ui/util.js';

export const MEDICAL_NOTE = '強い痛みや腫れ、しびれが続く場合は医療機関を受診してください。このアプリの調整は一般的な目安で、専門家の監修はありません。';

const today = () => toDateStr(new Date());
const injuries = () => getState().injuries || [];

export function injuryCtx() {
  const s = getState();
  return {
    musclesOf,
    stressOf,
    isAvailable,
    exercises: s.exercises,
    exById: new Map(s.exercises.map((x) => [x.id, x])),
    weightStepKg: s.settings.weightStepKg,
    suggestPlan: (ex, date) => suggestStrength(ex, s.entries, date, s.settings.weightStepKg).plan,
  };
}

// 今日以降の予定を、痛みの記録に合わせる(起動時・画面の切り替え・痛みの登録や更新のあと)。返り値: 変えた件数
export function syncInjuryAdjustments() {
  const changes = planInjuryAdjustments(getState().entries, injuries(), today(), injuryCtx());
  patchEntries(changes);
  return changes.length;
}

// 種目ごとの調整(提案やトレーニング中の入れ替え候補に使う)
export const injuryDecision = (ex, date = today()) => decide(ex, injuries(), date, injuryCtx());
export const scaleForInjury = (ex, plan, pct) => scalePlan(ex, plan, pct, getState().settings.weightStepKg);

export const activeInjuries = () => injuries().filter(isActive);

// ---- ダイアログ ----

let dlg = null;
let cur = null; // { id | null, draft: { part, side, level, startDate, memo }, choices: [部位], onChange }

const seg = (name, options, value) => `<div class="segmented fill" role="group">${Object.entries(options)
  .map(([k, v]) => `<button type="button" data-set="${name}" data-key="${k}" aria-pressed="${k === value}">${v}</button>`)
  .join('')}</div>`;

function newHtml() {
  const d = cur.draft;
  return `<h3>痛む部位</h3>
    ${seg('part', Object.fromEntries(cur.choices.map((k) => [k, partLabel(k)])), d.part)}
    ${CENTER_PARTS.has(d.part) ? '' : `<h3>左右</h3>${seg('side', { left: '左', right: '右', both: '両側' }, d.side)}`}
    <h3>痛みの強さ</h3>
    ${seg('level', LEVELS, d.level)}
    <p class="hint">軽い: その部位がメインの種目の重さを下げます。中くらい: 負担がかかる種目を代わりの種目に入れ替えます。強い: その部位を使う種目をすべて外します。</p>
    <label class="field"><span>いつから</span><input type="date" data-field="startDate" value="${d.startDate}" max="${today()}"></label>
    <label class="field"><span>メモ(どんなときに痛むかなど)</span><textarea rows="2" maxlength="1000" data-field="memo">${esc(d.memo)}</textarea></label>
    <button type="button" class="btn-primary wide" data-action="save-new">登録する</button>`;
}

function detailHtml(inj) {
  const d = cur.draft;
  const active = isActive(inj);
  const f = recoverFactor(inj, today());
  const history = [...inj.history].reverse()
    .map((h) => `<li><span class="pr-date">${formatShortDate(h.date)}</span><span class="pr-what">${LEVELS[h.level]}${h.memo ? ` ・ ${esc(h.memo)}` : ''}</span></li>`)
    .join('');
  return `<p class="prog-summary"><b>${esc(injuryLabel(inj))}</b>
      <span>${formatDateJa(inj.startDate)}から ・ ${active ? `今: ${LEVELS[currentLevel(inj)]}` : `${formatDateJa(inj.healedDate)}に治った`}</span>
      ${f !== null ? `<span>回復中: 今日の重さは元の${Math.round(f * 100)}%(${RECOVER_DAYS}日で元に戻します)</span>` : ''}</p>
    ${
      active
        ? `<h3>今日の痛み</h3>
          ${seg('level', LEVELS, d.level)}
          <label class="field"><span>メモ</span><textarea rows="2" maxlength="1000" data-field="memo">${esc(d.memo)}</textarea></label>
          <button type="button" class="btn-primary wide" data-action="save-level">今日の強さを記録</button>
          <button type="button" class="btn-ghost wide" data-action="healed">✓ 治った</button>`
        : '<button type="button" class="btn-ghost wide" data-action="reopen">まだ痛む(記録を再開)</button>'
    }
    <h3>経過</h3>
    <ul class="pr-recent">${history}</ul>
    <button type="button" class="btn-danger wide" data-action="delete">この記録を削除</button>`;
}

function render() {
  const inj = cur.id ? injuries().find((x) => x.id === cur.id) : null;
  dlg.innerHTML = `<div class="sheet">
      <header class="sheet-head">
        <button type="button" class="btn-ghost" data-action="close">閉じる</button>
        <h2>${inj ? '痛みの記録' : '痛みを記録'}</h2>
        <span class="head-spacer"></span>
      </header>
      <div class="sheet-body">
        <p class="medical">⚠️ ${MEDICAL_NOTE}</p>
        ${inj ? detailHtml(inj) : newHtml()}
      </div>
    </div>`;
}

function changed(message) {
  const n = syncInjuryAdjustments();
  toast(n ? `${message}(今後の予定を${n}件調整しました)` : message);
  render();
  cur.onChange?.();
}

function setup() {
  dlg = document.getElementById('injury-dialog');
  dlg.addEventListener('input', (ev) => {
    const f = ev.target.dataset.field;
    if (f) cur.draft[f] = ev.target.value;
  });
  dlg.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-action], [data-set]');
    if (!t) return;
    if (t.dataset.set) {
      cur.draft[t.dataset.set] = t.dataset.key;
      if (t.dataset.set === 'part') cur.draft.side = CENTER_PARTS.has(t.dataset.key) ? 'center' : cur.draft.side === 'center' ? 'both' : cur.draft.side;
      return render();
    }
    const inj = cur.id ? injuries().find((x) => x.id === cur.id) : null;
    const d = cur.draft;
    switch (t.dataset.action) {
      case 'close':
        dlg.close();
        break;
      case 'save-new': {
        const id = makeId('inj');
        const start = d.startDate && d.startDate <= today() ? d.startDate : today();
        saveInjury({ id, part: d.part, side: CENTER_PARTS.has(d.part) ? 'center' : d.side, startDate: start, healedDate: null, history: [{ date: start, level: d.level, memo: d.memo.trim() }] });
        cur = { ...cur, id, draft: { ...d, memo: '' } };
        changed('痛みを記録しました');
        break;
      }
      case 'save-level':
        saveInjury(withLevel(inj, today(), d.level, d.memo.trim()));
        cur.draft.memo = '';
        changed(`今日の痛みを「${LEVELS[d.level]}」で記録しました`);
        break;
      case 'healed':
        saveInjury({ ...inj, healedDate: today() });
        changed(`治った日にしました。${RECOVER_DAYS}日かけて重さを戻します`);
        break;
      case 'reopen':
        saveInjury(withLevel({ ...inj, healedDate: null }, today(), 'mild'));
        cur.draft.level = 'mild';
        changed('記録を再開しました');
        break;
      case 'delete':
        if (!confirm('この痛みの記録を削除しますか？(調整した予定は元に戻ります)')) break;
        deleteInjury(inj.id);
        syncInjuryAdjustments();
        dlg.close();
        cur.onChange?.();
        toast('削除しました');
        break;
    }
  });
}

// muscle: 筋肉マップで選んだ筋肉(新しく登録するとき)。injuryId: 記録を開くとき。
export function openInjuryForm({ muscle = null, injuryId = null, onChange } = {}) {
  if (!dlg) setup();
  const choices = muscle ? [muscle, ...(NEAR_JOINTS[muscle] || [])] : Object.keys(JOINTS);
  const inj = injuryId ? injuries().find((x) => x.id === injuryId) : null;
  const part = choices[0];
  cur = {
    id: inj?.id || null,
    choices,
    onChange,
    draft: { part, side: CENTER_PARTS.has(part) ? 'center' : 'both', level: inj ? currentLevel(inj) : 'mild', startDate: today(), memo: '' },
  };
  render();
  dlg.showModal();
}

// ---- 一覧(筋肉マップの下)とホームの確認 ----

export function injuryListHtml() {
  const groups = historyByPart(injuries());
  const rows = groups
    .map((g) => `<h4>${esc(g.label)}</h4><ul class="entry-list compact">${g.injuries
      .map((inj) => {
        const f = recoverFactor(inj, today());
        const state = isActive(inj) ? `⚠️ ${LEVELS[currentLevel(inj)]}` : f !== null ? `回復中 ${Math.round(f * 100)}%` : '治った';
        return `<li><button type="button" class="entry" data-action="injury-open" data-id="${inj.id}">
          <span class="entry-main"><span class="entry-name">${esc(injuryLabel(inj))}<span class="tag">${state}</span></span>
            <span class="entry-sub">${formatShortDate(inj.startDate)}〜${inj.healedDate ? formatShortDate(inj.healedDate) : ''} ・ 記録${inj.history.length}回</span></span>
          <span class="chev">›</span></button></li>`;
      })
      .join('')}</ul>`)
    .join('');
  return `<section class="card">
    <h2>痛み・ケガの記録</h2>
    <p class="hint">筋肉マップで部位をタップすると登録できます。痛みに合わせて、今日以降の予定を自動で調整します。</p>
    ${rows || '<p class="empty">記録はありません</p>'}
    <button type="button" class="btn-ghost wide" data-action="injury-joint">関節(首・腰・ひざなど)の痛みを記録</button>
    <p class="hint after">${MEDICAL_NOTE}</p>
  </section>`;
}

// ホーム: 前回から3日たった痛みに「痛みはどう？」と聞く
export function injuryCheckHtml() {
  const due = injuries().filter((i) => needsCheck(i, today()));
  const active = activeInjuries();
  if (!active.length) return '';
  const adjusted = getState().entries.filter((e) => e.date >= today() && (e.adjustReason === 'pain' || e.skipReason === 'pain')).length;
  return `<section class="card injury-check">
    <h2>痛み・ケガ</h2>
    <p class="hint">${active.map((i) => `⚠️ ${esc(injuryLabel(i))}(${LEVELS[currentLevel(i)]})`).join(' ・ ')}${adjusted ? ` ・ 今後の予定を${adjusted}件調整中` : ''}</p>
    ${due
      .map((i) => `<div class="check-row"><p class="rs-title">${esc(injuryLabel(i))}の痛みはどう？<small>前回 ${formatShortDate(i.history.at(-1).date)}: ${LEVELS[currentLevel(i)]}</small></p>
        <div class="check-btns">${Object.entries(LEVELS).map(([k, v]) => `<button type="button" class="btn-ghost" data-action="injury-check" data-id="${i.id}" data-level="${k}">${v}</button>`).join('')}
          <button type="button" class="btn-primary" data-action="injury-check" data-id="${i.id}" data-level="healed">治った</button></div></div>`)
      .join('')}
    <a class="hint-link" href="#exercises">記録の一覧を見る ›</a>
  </section>`;
}

// ホームのボタン。処理したら true。
export function handleInjuryAction(t) {
  if (t.dataset.action !== 'injury-check') return false;
  const inj = injuries().find((x) => x.id === t.dataset.id);
  if (!inj) return true;
  if (t.dataset.level === 'healed') saveInjury({ ...inj, healedDate: today() });
  else saveInjury(withLevel(inj, today(), t.dataset.level));
  const n = syncInjuryAdjustments();
  toast(t.dataset.level === 'healed' ? `治った日にしました。${RECOVER_DAYS}日かけて重さを戻します` : `「${LEVELS[t.dataset.level]}」で記録しました${n ? `(予定を${n}件調整)` : ''}`);
  return true;
}

