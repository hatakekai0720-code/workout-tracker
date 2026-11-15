// 種目の解説ページ(ダイアログ)。筋肉マップ・種目一覧・記録画面から開く。
import { getState, getExercise, saveExercise, BODY_PARTS } from '../store.js';
import { findPrevious, formatShortDate, describeActual } from '../calc.js';
import { computePRs, formatPR, PR_LABELS } from '../insights.js';
import { getGuide, musclesOf, CUSTOM_FIELDS } from '../guides.js';
import { MUSCLES } from '../muscles.js';
import { esc, toast } from '../util.js';

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
  return `<dl class="kv">
    <dt>メイン</dt><dd>${chips(m.main, 'main') || '—'}</dd>
    <dt>サブ</dt><dd>${chips(m.sub, 'sub') || '—'}</dd>
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
  const g = getGuide(ex.id);
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
        ${g && g.title !== ex.name ? `<p class="hint">解説の内容: ${esc(g.title)}</p>` : ''}
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
}

function close() {
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
