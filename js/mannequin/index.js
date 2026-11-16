// マネキンの入口。3D(Three.js を CDN から読み込む)が使えなければ 2D にする。
import { create2D } from './svg-view.js';

const LOAD_TIMEOUT_MS = 10000;

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

let threeView = null; // 一度読み込めたら使い回す
function loadThreeView() {
  threeView ??= Promise.race([
    import('./three-view.js'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), LOAD_TIMEOUT_MS)),
  ]).catch((err) => {
    threeView = null; // 次に開いたときにもう一度試す
    throw err;
  });
  return threeView;
}

// host に描く。返り値: { mode: '3d'|'2d', reason, setSelected, setColors, setView, dispose }
// reason は 3D にできなかった理由('webgl' | 'load')。自分で 2D を選んだ場合は null。
export async function createMannequin(host, { onSelect, prefer2D = false }) {
  let reason = null;
  if (!prefer2D) {
    if (!webglAvailable()) reason = 'webgl';
    else {
      try {
        const { create3D } = await loadThreeView();
        return { ...create3D(host, { onSelect }), reason: null };
      } catch {
        reason = 'load'; // オフラインで未取得、古いブラウザなど
      }
    }
  }
  return { ...create2D(host, { onSelect }), reason };
}
