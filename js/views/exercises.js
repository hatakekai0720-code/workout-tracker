// 種目タブ: 種目の一覧。タップすると解説ページが開く。
import { getState, BODY_PARTS } from '../store.js';
import { getGuide, musclesOf } from '../guides.js';
import { MUSCLES } from '../muscles.js';
import { openGuide } from './guide.js';
import { esc } from '../util.js';

export function mountExercises(root) {
  function row(x) {
    const m = musclesOf(x);
    const tag = x.bodyPart ? `<span class="tag">${BODY_PARTS[x.bodyPart]}</span>` : '';
    const main = m.main.length ? `メイン: ${m.main.map((k) => MUSCLES[k]).join('・')}` : '効く筋肉は未設定';
    const hasGuide = getGuide(x.id) || Object.keys(x.customGuide || {}).length;
    return `<li><button type="button" class="entry ${x.archived ? 'archived' : ''}" data-action="guide" data-id="${x.id}">
      <span class="entry-main">
        <span class="entry-name">${esc(x.name)}${tag}</span>
        <span class="entry-sub">${main}${hasGuide ? '' : ' ・ 解説なし'}${x.archived ? ' ・ 非表示' : ''}</span>
      </span>
      <span class="chev">›</span>
    </button></li>`;
  }

  function render() {
    const { exercises } = getState();
    const sorted = [...exercises.filter((x) => !x.archived), ...exercises.filter((x) => x.archived)];
    root.innerHTML = `
      <header class="page-head"><h1>種目</h1></header>
      <section class="card">
        <h2>種目の解説</h2>
        <p class="hint">種目をタップすると、やり方・コツ・注意点の解説が開きます。</p>
        <ul class="entry-list">${sorted.map(row).join('')}</ul>
        <p class="hint after">種目の追加や、効く筋肉の設定は<a href="#settings">「設定」の種目マスタ</a>からできます。</p>
      </section>`;
  }

  root.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-action="guide"]');
    if (t) openGuide(t.dataset.id, render);
  });

  return { render };
}
