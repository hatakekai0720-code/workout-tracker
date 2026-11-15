// 種目タブ: 筋肉マップ(3D/2D のマネキン)と種目の一覧。
import { getState, BODY_PARTS } from '../store.js';
import { guideFor, musclesOf, groupByCategory, LEVELS } from '../guides.js';
import { MUSCLES } from '../muscles.js';
import { createMannequin } from '../mannequin/index.js';
import { openGuide } from './guide.js';
import { esc } from '../util.js';

const VIEW_BUTTONS = [
  ['front', '前'],
  ['back', '後ろ'],
  ['side', '横'],
];

export function mountExercises(root) {
  // マネキンは描き直しのたびに作り直さないよう、枠を一度だけ作っておく
  root.innerHTML = `
    <header class="page-head"><h1>種目</h1></header>
    <section class="card">
      <h2>筋肉マップ</h2>
      <div class="mq-tools">
        <div class="segmented" role="group" aria-label="向き" data-views>
          ${VIEW_BUTTONS.map(([key, label]) => `<button type="button" data-action="view" data-key="${key}">${label}</button>`).join('')}
        </div>
        <button type="button" class="btn-ghost" data-action="toggle-mode" hidden></button>
      </div>
      <div class="mq-stage" data-stage><p class="empty">読み込み中…</p></div>
      <p class="mq-info" data-info></p>
    </section>
    <div data-list></div>`;
  const stage = root.querySelector('[data-stage]');
  const info = root.querySelector('[data-info]');
  const views = root.querySelector('[data-views]');
  const toggle = root.querySelector('[data-action="toggle-mode"]');

  let mannequin = null;
  let starting = false;
  let prefer2D = false;
  let selected = null;

  function showInfo() {
    if (selected) info.innerHTML = `選択中: <b>${MUSCLES[selected]}</b>`;
    else if (mannequin?.mode === '3d') info.textContent = '1本指でドラッグして回転、2本指でつまんで拡大・縮小。筋肉をタップすると名前が出ます。';
    else if (mannequin?.reason === 'webgl') info.textContent = 'この端末では3Dが使えないため、2Dで表示しています。筋肉をタップすると名前が出ます。';
    else if (mannequin?.reason === 'load') info.textContent = '3Dの部品を読み込めなかったため、2Dで表示しています(通信できる状態で開き直すと3Dになります)。';
    else info.textContent = '筋肉をタップすると名前が出ます。';
  }

  function select(key) {
    selected = key;
    mannequin.setSelected(key);
    showInfo();
  }

  async function startMannequin() {
    if (starting) return;
    starting = true;
    mannequin?.dispose();
    mannequin = null;
    stage.innerHTML = '<p class="empty">読み込み中…</p>';
    mannequin = await createMannequin(stage, { onSelect: select, prefer2D });
    starting = false;
    mannequin.setSelected(selected);
    views.hidden = mannequin.mode !== '3d';
    // 3D が使える端末だけ、2D との切り替えを出す
    toggle.hidden = mannequin.reason !== null;
    toggle.textContent = mannequin.mode === '3d' ? '2D表示にする' : '3D表示にする';
    stage.dataset.mode = mannequin.mode;
    showInfo();
  }

  function row(x) {
    const m = musclesOf(x);
    const g = guideFor(x);
    const tag = x.bodyPart ? `<span class="tag">${BODY_PARTS[x.bodyPart]}</span>` : '';
    const main = m.main.length ? m.main.map((k) => MUSCLES[k]).join('・') : '効く筋肉は未設定';
    const hasGuide = g || Object.keys(x.customGuide || {}).length;
    return `<li><button type="button" class="entry ${x.archived ? 'archived' : ''}" data-action="guide" data-id="${x.id}">
      <span class="entry-main">
        <span class="entry-name">${esc(x.name)}${tag}</span>
        <span class="entry-sub">${g ? `${LEVELS[g.level]} ・ ` : ''}${main}${hasGuide ? '' : ' ・ 解説なし'}${x.archived ? ' ・ 非表示' : ''}</span>
      </span>
      <span class="chev">›</span>
    </button></li>`;
  }

  function render() {
    const { exercises } = getState();
    const sorted = [...exercises.filter((x) => !x.archived), ...exercises.filter((x) => x.archived)];
    const groups = groupByCategory(sorted)
      .map((g) => `<h3>${g.label}<small>${g.items.length}種目</small></h3><ul class="entry-list">${g.items.map(row).join('')}</ul>`)
      .join('');
    root.querySelector('[data-list]').innerHTML = `
      <section class="card">
        <h2>種目の解説</h2>
        <p class="hint">種目をタップすると、やり方・コツ・注意点の解説が開きます。</p>
        ${groups}
        <p class="hint after">種目の追加や、効く筋肉の設定は<a href="#settings">「設定」の種目マスタ</a>からできます。</p>
      </section>`;
    if (!mannequin) startMannequin(); // 初めてこのタブを開いたときに読み込む
  }

  root.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-action]');
    if (!t) return;
    switch (t.dataset.action) {
      case 'guide':
        openGuide(t.dataset.id, render);
        break;
      case 'view':
        mannequin?.setView(t.dataset.key);
        break;
      case 'toggle-mode':
        prefer2D = mannequin?.mode === '3d';
        startMannequin();
        break;
    }
  });

  return { render };
}
