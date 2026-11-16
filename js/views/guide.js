// 種目の解説ページ(ダイアログ)。筋肉マップ・種目一覧・記録画面から開く。
import { getState, getExercise, saveExercise, BODY_PARTS } from '../data/store.js';
import { formatShortDate } from '../logic/dates.js';
import { findPrevious, describeActual } from '../logic/training.js';
import { computePRs, formatPR, PR_LABELS } from '../logic/insights.js';
import { guideFor, musclesOf, exerciseForGuide, CUSTOM_FIELDS, CATEGORIES, EQUIPMENT, PLACES, LEVELS } from '../data/guides.js';
import { MUSCLES } from '../logic/muscles.js';
import { createMannequin } from '../mannequin/index.js';
import { bestView } from '../logic/musclemap.js';
import { esc, toast } from '../ui/util.js';

const FAR_FUTURE = '9999-12-31';

let dlg = null;
let cur = null; // { exerciseId, editing, draft, onClose }

const list = (items) => `<ul class="bullets">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
const group = (title, body) => `<section class="group"><h3>${title}</h3>${body}</section>`;
const chips = (keys, cls) => keys.map((k) => `<span class="chip ${cls}">${MUSCLES[k]}</span>`).join('');

function recordsHtml(ex) {
  const { entries, exercises } = getState();
  const bests = computePRs(entries, exercises).bests.filter((b) => b.exerciseId === ex.id);
  const prev = findPrevious(entries, ex.id, FAR_FUTURE);
  if (!prev) return '<p class="empty">まだ実施した記録がありません</p>';
  return `<dl class="kv">
    <dt>前回</dt><dd>${formatShortDate(prev.date)} ・ ${esc(describeActual(ex, prev.actual))}</dd>
    ${bests.map((b) => `<dt>🏆 ${PR_LABELS[b.type]}</dt><dd><b>${formatPR(b.type, b.value)}</b> <small>${formatShortDate(b.date)}</small></dd>`).join('')}
  </dl>`;
}

function musclesHtml(ex) {
  const m = musclesOf(ex);
  if (!m.main.length && !m.sub.length) {
    return '<p class="empty">未設定です。「設定」→ 種目マスタで選べます</p>';
  }
  return `<div class="mq-tools">
      <div class="segmented" role="group" aria-label="向き" data-guide-views hidden>
        <button type="button" data-action="mq-view" data-key="front">前</button>
        <button type="button" data-action="mq-view" data-key="back">後ろ</button>
        <button type="button" data-action="mq-view" data-key="side">横</button>
      </div>
    </div>
    <div class="mq-stage small" data-guide-stage><p class="empty">読み込み中…</p></div>
    <dl class="kv after-stage">
      <dt>メイン</dt><dd>${chips(m.main, 'main') || '—'}</dd>
      <dt>サブ</dt><dd>${chips(m.sub, 'sub') || '—'}</dd>
    </dl>`;
}

// 解説ページのマネキン。効く筋肉を、ラベルと同じ色(メイン = オレンジ、サブ = 黄)で光らせる。
const GLOW = { main: '#eb6834', sub: '#ffd27a' };
let mannequin = null;
let mountToken = 0;

function disposeMannequin() {
  mountToken++; // 読み込み中のものがあれば、完成しても使わない
  mannequin?.dispose();
  mannequin = null;
}

async function mountMannequin(ex) {
  disposeMannequin();
  const stage = dlg.querySelector('[data-guide-stage]');
  if (!stage) return; // 効く筋肉が未設定
  const token = mountToken;
  const m = musclesOf(ex);
  const view = await createMannequin(stage, { onSelect() {} });
  if (token !== mountToken || !stage.isConnected) return view.dispose(); // 待っている間に閉じた・描き直した
  mannequin = view;
  const colors = {};
  for (const k of m.sub) colors[k] = GLOW.sub;
  for (const k of m.main) colors[k] = GLOW.main;
  view.setColors(colors);
  view.setView(bestView(m), false);
  dlg.querySelector('[data-guide-views]').hidden = view.mode !== '3d';
}

// 器具・場所・難易度・代わりの種目
function infoHtml(g) {
  const needs = g.equipment.length ? g.equipment.map((k) => EQUIPMENT[k]).join('・') : 'なし';
  const alts = g.alternatives
    .map((a) => {
      // 一覧にある種目なら、タップでその解説へ移れる
      const target = a.id && exerciseForGuide(a.id);
      return target
        ? `<button type="button" class="chip link" data-action="open-alt" data-id="${target.id}">${esc(target.name)} ›</button>`
        : `<span class="chip">${esc(a.name)}</span>`;
    })
    .join('');
  return `<dl class="kv">
    <dt>器具カテゴリ</dt><dd>${CATEGORIES[g.category]}</dd>
    <dt>必要な器具</dt><dd>${needs}</dd>
    <dt>場所</dt><dd>${PLACES[g.place]}</dd>
    <dt>難易度</dt><dd>${LEVELS[g.level]}</dd>
    <dt>代わりの種目</dt><dd>${alts}</dd>
  </dl>`;
}

function builtInHtml(g) {
  const level = (label, l) => `<li><span class="level-label">${label}</span><b>${esc(l.name)}</b><span>${esc(l.desc)}</span></li>`;
  return (
    group(
      '準備',
      `<dl class="kv">
        <dt>器具</dt><dd>${esc(g.setup.equipment)}</dd>
        <dt>スタートの姿勢</dt><dd>${esc(g.setup.start)}</dd>
        <dt>足幅・手幅</dt><dd>${esc(g.setup.width)}</dd>
      </dl>`,
    ) +
    group(
      'やり方',
      `<ol class="steps">${g.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
       <p class="tempo"><b>テンポ</b>${esc(g.tempo)}</p>`,
    ) +
    group('呼吸', `<p>${esc(g.breathing)}</p>`) +
    group('コツ', list(g.tips)) +
    group(
      '失敗例',
      `<ul class="mistakes">${g.mistakes
        .map(
          (m) => `<li><b>✕ ${esc(m.mistake)}</b>
            <span><i>起きること</i>${esc(m.result)}</span>
            <span><i>直し方</i>${esc(m.fix)}</span></li>`,
        )
        .join('')}</ul>`,
    ) +
    group(
      '安全面',
      `<h4>こうなったら中止する</h4>${list(g.safety.stop)}
       <h4>注意が必要な人</h4>${list(g.safety.caution)}`,
    ) +
    group(
      'レベル別',
      `<ol class="levels">${level('楽な版', g.levels.easier)}${level('基本', g.levels.basic)}${level('きつい版', g.levels.harder)}</ol>`,
    ) +
    group(
      '目安',
      `<dl class="kv">
        <dt>初心者</dt><dd>${esc(g.dosage.beginner)}</dd>
        <dt>中級者</dt><dd>${esc(g.dosage.intermediate)}</dd>
        <dt>休憩</dt><dd>${esc(g.dosage.rest)}</dd>
      </dl>`,
    )
  );
}

// 自分で追加した種目: 項目ごとの自由記述を表示・編集する
function customHtml(ex) {
  if (cur.editing) {
    return group(
      '解説を書く',
      `${CUSTOM_FIELDS.map(
        ([key, label]) => `<label class="field"><span>${label}</span>
          <textarea rows="3" maxlength="4000" data-custom="${key}">${esc(cur.draft[key] || '')}</textarea></label>`,
      ).join('')}
      <div class="row-actions">
        <button type="button" class="btn-primary" data-action="save-custom">解説を保存</button>
        <button type="button" class="btn-ghost" data-action="cancel-custom">やめる</button>
      </div>`,
    );
  }
  const g = ex.customGuide || {};
  const filled = CUSTOM_FIELDS.filter(([key]) => (g[key] || '').trim());
  return (
    filled.map(([key, label]) => group(label, `<p class="pre">${esc(g[key])}</p>`)).join('') +
    `<p class="hint">${filled.length ? '' : 'この種目の解説はまだありません。自分で書いておけます。'}</p>
     <button type="button" class="btn-ghost wide" data-action="edit-custom">${filled.length ? '解説を編集' : '解説を書く'}</button>`
  );
}

function render() {
  const ex = getExercise(cur.exerciseId);
  const g = guideFor(ex);
  const body = dlg.querySelector('.sheet-body');
  const scroll = body ? body.scrollTop : 0;
  const query = encodeURIComponent(`${ex.name} フォーム やり方`);
  dlg.innerHTML = `<div class="sheet">
      <header class="sheet-head">
        <button type="button" class="btn-ghost" data-action="close">閉じる</button>
        <h2>${esc(ex.name)}</h2>
        <span class="head-spacer"></span>
      </header>
      <div class="sheet-body guide">
        <a class="btn-primary yt" target="_blank" rel="noopener noreferrer"
          href="https://www.youtube.com/results?search_query=${query}">▶ YouTubeでフォームを見る</a>
        ${g && g.name !== ex.name ? `<p class="hint">解説の内容: ${esc(g.name)}</p>` : ''}
        ${g ? group('種目の情報', infoHtml(g)) : ''}
        ${group('自己ベストと前回の記録', recordsHtml(ex))}
        ${group(`効く筋肉${ex.bodyPart ? `<span class="tag">${BODY_PARTS[ex.bodyPart]}</span>` : ''}`, musclesHtml(ex))}
        ${g ? builtInHtml(g) : customHtml(ex)}
        ${group(
          '自分用メモ',
          `<textarea rows="4" maxlength="4000" data-field="note" placeholder="気づいたこと、次に試すことなど">${esc(ex.note || '')}</textarea>
           <button type="button" class="btn-primary wide" data-action="save-note">メモを保存</button>`,
        )}
        <p class="hint">ここに書かれた内容は一般的な目安です。痛みや持病があるときは、無理をせず医師に相談してください。</p>
      </div>
    </div>`;
  dlg.querySelector('.sheet-body').scrollTop = scroll;
  mountMannequin(ex);
}

function close() {
  disposeMannequin();
  dlg.close();
  const { onClose } = cur;
  cur = null;
  onClose?.();
}

function setup() {
  dlg = document.getElementById('guide-dialog');

  dlg.addEventListener('input', (ev) => {
    const key = ev.target.dataset.custom;
    if (key) cur.draft[key] = ev.target.value;
  });

  dlg.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-action]');
    if (!t) return;
    const ex = getExercise(cur.exerciseId);
    switch (t.dataset.action) {
      case 'close':
        close();
        break;
      case 'mq-view':
        mannequin?.setView(t.dataset.key);
        break;
      case 'open-alt':
        cur = { ...cur, exerciseId: t.dataset.id, editing: false, draft: {} };
        render();
        dlg.querySelector('.sheet-body').scrollTop = 0;
        break;
      case 'save-note':
        saveExercise({ ...ex, note: dlg.querySelector('[data-field="note"]').value.trim() });
        toast('メモを保存しました');
        break;
      case 'edit-custom':
        cur.editing = true;
        cur.draft = { ...(ex.customGuide || {}) };
        render();
        break;
      case 'cancel-custom':
        cur.editing = false;
        render();
        break;
      case 'save-custom': {
        const customGuide = {};
        for (const [key] of CUSTOM_FIELDS) {
          const v = (cur.draft[key] || '').trim();
          if (v) customGuide[key] = v;
        }
        // 書きかけのメモを消さないよう、画面の値も一緒に保存する
        saveExercise({ ...ex, customGuide, note: dlg.querySelector('[data-field="note"]').value.trim() });
        cur.editing = false;
        toast('解説を保存しました');
        render();
        break;
      }
    }
  });

  dlg.addEventListener('cancel', (ev) => {
    ev.preventDefault();
    close();
  });
}

export function openGuide(exerciseId, onClose) {
  if (!dlg) setup();
  cur = { exerciseId, editing: false, draft: {}, onClose };
  render();
  dlg.showModal();
  dlg.querySelector('.sheet-body').scrollTop = 0;
}
