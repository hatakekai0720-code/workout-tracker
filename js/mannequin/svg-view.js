// 2D マネキン(SVG)。3D が使えない環境用。3D と同じ形状データを前後から平面に写して描く。
import { PARTS, COLORS, silhouette, markerPoints } from './model.js';

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
        const shape = silhouette(p);
        const rot = ((-dir * shape.angle * 180) / Math.PI).toFixed(1); // SVG は y が下向きなので符号が逆
        const attrs = p.muscle ? `data-muscle="${p.muscle}" fill="${COLORS.idle}"` : `fill="${COLORS.body}"`;
        return `<ellipse cx="${cx}" cy="${cy}" rx="${(shape.rx * PX).toFixed(1)}" ry="${(shape.ry * PX).toFixed(1)}"
          transform="rotate(${rot} ${cx} ${cy})" ${attrs} stroke="${COLORS.outline}" stroke-width="0.6"/>`;
      })
      .join('');
    return `<figure><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="筋肉マップ(${back ? '後ろ' : '前'})" data-dir="${dir}">${shapes}<g data-marks></g></svg>
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
    // 痛みの印(⚠️)。marks: [{ part, side }]。前と後ろの両方に出す
    setMarkers(marks) {
      for (const svg of root.querySelectorAll('svg')) {
        const dir = Number(svg.dataset.dir);
        svg.querySelector('[data-marks]').innerHTML = (marks || [])
          .flatMap((m) => markerPoints(m.part, m.side))
          // 体の前側の印は前の図だけ、後ろ側(腰など)は後ろの図だけ。手足や関節は両方に出す
          .filter(([, , z]) => (dir > 0 ? z > -0.05 : z < 0.05))
          .map(([x, y]) => `<text class="mq-mark" x="${(W / 2 + dir * x * PX).toFixed(1)}" y="${((TOP - y) * PX + 5).toFixed(1)}" text-anchor="middle">⚠️</text>`)
          .join('');
      }
    },
    setView() {}, // 前後を並べて表示しているので切り替えは不要
    dispose() {
      host.replaceChildren();
    },
  };
}
