// 2D マネキン(SVG)。3D が使えない環境用。3D と同じ形状データを前後から平面に写して描く。
import { PARTS, COLORS } from './model.js';

const PX = 150; // 1m あたりのピクセル数
const W = 150;
const H = 290;
const TOP = 1.83; // 図の上端の高さ(m)

export function create2D(host, { onSelect }) {
  // 奥にあるものから順に描く。後ろ姿は左右と前後を反転する。
  const figure = (back) => {
    const dir = back ? -1 : 1;
    const shapes = [...PARTS]
      .sort((a, b) => dir * (a.pos[2] - b.pos[2]))
      .map((p) => {
        const cx = (W / 2 + dir * p.pos[0] * PX).toFixed(1);
        const cy = ((TOP - p.pos[1]) * PX).toFixed(1);
        const rot = ((-dir * p.rotZ * 180) / Math.PI).toFixed(1);
        const attrs = p.muscle ? `data-muscle="${p.muscle}" fill="${COLORS.idle}"` : `fill="${COLORS.body}"`;
        return `<ellipse cx="${cx}" cy="${cy}" rx="${(p.scale[0] * PX).toFixed(1)}" ry="${(p.scale[1] * PX).toFixed(1)}"
          transform="rotate(${rot} ${cx} ${cy})" ${attrs} stroke="${COLORS.outline}" stroke-width="0.6"/>`;
      })
      .join('');
    return `<figure><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="筋肉マップ(${back ? '後ろ' : '前'})">${shapes}</svg>
      <figcaption>${back ? '後ろ' : '前'}</figcaption></figure>`;
  };
  host.innerHTML = `<div class="mq-2d">${figure(false)}${figure(true)}</div>`;
  const root = host.firstElementChild;

  let colors = {};
  let selected = null;
  function applyColors() {
    for (const el of root.querySelectorAll('[data-muscle]')) {
      const key = el.dataset.muscle;
      el.setAttribute('fill', key === selected ? COLORS.selected : colors[key] || COLORS.idle);
    }
  }

  root.addEventListener('click', (ev) => {
    onSelect(ev.target.closest('[data-muscle]')?.dataset.muscle || null);
  });

  return {
    mode: '2d',
    setSelected(key) {
      selected = key;
      applyColors();
    },
    setColors(map) {
      colors = map || {};
      applyColors();
    },
    setView() {}, // 前後を並べて表示しているので切り替えは不要
    dispose() {
      host.replaceChildren();
    },
  };
}
