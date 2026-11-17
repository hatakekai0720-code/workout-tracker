// マネキンの形。すべて「楕円体」で、3D ではつぶした球、2D では楕円として描く。
// 筋肉は体の表面に沿わせた薄い板のような楕円体にして、解剖図のように見せる。
// 単位はおよそメートル。y が上、z の正が体の前、x は左右。

export const COLORS = {
  body: '#f1dccc', // 筋肉以外(頭・関節・手足)
  idle: '#cdc3ba', // 色を付けていない筋肉(今週まだ使っていない)
  selected: '#316ac5', // タップして選んだ筋肉
  outline: '#7a5f55',
};

const ARM_TILT = 0.26; // 腕を少し開いた姿勢(ラジアン)
const LEG_TILT = 0.05;
const SHOULDER = [0.225, 1.435];
const HIP = [0.1, 0.93];

// [筋肉(骨格は null), 位置 [x, y, z], 半径 [x, y, z], 回転 [x, y, z]]
// x が 0 でないものは左右に1つずつ置く(右側の値で書く)。
// 1つの筋肉をいくつかの楕円体(筋頭)に分けて、ふくらみや溝が出るようにしている。
const TORSO = [
  [null, [0, 1.665, 0.005], [0.088, 0.115, 0.1]], // 頭
  [null, [0, 1.6, 0.032], [0.066, 0.058, 0.066]], // あご
  [null, [0, 1.535, -0.005], [0.054, 0.085, 0.057]], // 首
  [null, [0, 1.425, -0.01], [0.19, 0.066, 0.09]], // 肩まわり
  [null, [0, 1.3, 0], [0.16, 0.2, 0.104]], // 胸郭
  [null, [0, 1.08, 0], [0.13, 0.15, 0.088]], // 腹まわり
  [null, [0, 0.955, 0], [0.158, 0.11, 0.1]], // 骨盤
  ['chest', [0.08, 1.33, 0.076], [0.094, 0.062, 0.042], [0, 0.3, -0.06]], // 大胸筋(下部)
  ['chest', [0.085, 1.385, 0.07], [0.08, 0.04, 0.034], [0, 0.35, -0.25]], // 大胸筋(上部)
  ['abs', [0.043, 1.236, 0.088], [0.042, 0.034, 0.02]],
  ['abs', [0.043, 1.166, 0.092], [0.042, 0.034, 0.02]],
  ['abs', [0.043, 1.096, 0.092], [0.042, 0.034, 0.02]],
  ['abs', [0.041, 1.006, 0.087], [0.04, 0.06, 0.02]],
  ['obliques', [0.113, 1.1, 0.036], [0.05, 0.13, 0.068], [0, 0.25, 0.1]],
  ['obliques', [0.122, 1.252, 0.05], [0.036, 0.016, 0.03], [0, 0.6, 0.45]], // 前鋸筋(ろっ骨に沿ったギザギザ)
  ['obliques', [0.126, 1.214, 0.047], [0.036, 0.016, 0.03], [0, 0.6, 0.45]],
  ['obliques', [0.126, 1.176, 0.044], [0.034, 0.015, 0.028], [0, 0.6, 0.45]],
  ['traps', [0.095, 1.49, -0.03], [0.1, 0.038, 0.05], [0, 0, -0.36]],
  ['traps', [0, 1.545, -0.04], [0.042, 0.06, 0.03]],
  ['traps', [0, 1.385, -0.092], [0.085, 0.15, 0.028]],
  ['traps', [0.034, 1.255, -0.098], [0.036, 0.075, 0.02], [0, 0, 0.35]], // 僧帽筋(下部)
  ['lats', [0.12, 1.22, -0.064], [0.09, 0.155, 0.042], [0, -0.35, -0.25]],
  ['lats', [0.085, 1.105, -0.074], [0.06, 0.085, 0.03], [0, -0.2, -0.4]], // 広背筋(下の細くなるところ)
  ['lats', [0.162, 1.33, -0.058], [0.04, 0.03, 0.032], [0, -0.3, -0.5]], // 大円筋(わきの下)
  ['erectors', [0.036, 1.04, -0.084], [0.03, 0.1, 0.025]],
  ['erectors', [0.033, 1.16, -0.092], [0.024, 0.075, 0.02]],
  ['glutes', [0.085, 0.92, -0.055], [0.092, 0.1, 0.068], [0, 0, -0.12]], // 大殿筋
  ['glutes', [0.125, 0.985, -0.025], [0.058, 0.05, 0.05], [0, 0, -0.4]], // 中殿筋
];

// 腕: 肩を原点に、下向きを -y とした位置。x は体の外側が正。
const ARM = [
  [null, [0, -0.01, 0], [0.055, 0.055, 0.055]], // 肩の関節
  ['deltFront', [-0.005, -0.03, 0.038], [0.052, 0.085, 0.046]],
  ['deltSide', [0.03, -0.03, 0], [0.045, 0.09, 0.055]],
  ['deltRear', [-0.005, -0.03, -0.038], [0.052, 0.085, 0.046]],
  [null, [0, -0.17, 0], [0.04, 0.15, 0.042]], // 上腕の芯
  ['biceps', [0, -0.16, 0.026], [0.038, 0.11, 0.036]],
  ['biceps', [0.016, -0.225, 0.016], [0.026, 0.06, 0.026]], // 上腕筋(力こぶの外下)
  ['triceps', [-0.008, -0.15, -0.03], [0.036, 0.12, 0.034]], // 長頭
  ['triceps', [0.02, -0.125, -0.022], [0.03, 0.08, 0.03]], // 外側頭
  [null, [0, -0.31, 0], [0.036, 0.036, 0.036]], // ひじ
  ['forearms', [-0.008, -0.39, 0.012], [0.037, 0.1, 0.034]], // 屈筋
  ['forearms', [0.013, -0.37, 0.004], [0.034, 0.11, 0.034]], // 腕橈骨筋
  ['forearms', [0, -0.47, 0], [0.03, 0.07, 0.028]],
  [null, [0, -0.525, 0], [0.028, 0.035, 0.024]], // 手首
  [null, [0, -0.6, 0], [0.033, 0.065, 0.02]], // 手
  [null, [-0.024, -0.575, 0.016], [0.012, 0.036, 0.013]], // 親指
];

// 脚: 股関節を原点に、下向きを -y とした位置。x は体の外側が正。
const LEG = [
  [null, [0, -0.21, 0], [0.078, 0.235, 0.08]], // 太ももの芯
  [null, [-0.045, -0.12, 0.005], [0.04, 0.12, 0.05]], // 内もも(内転筋)
  ['quads', [0.004, -0.2, 0.046], [0.05, 0.195, 0.042]], // 大腿直筋
  ['quads', [0.038, -0.21, 0.018], [0.048, 0.195, 0.054]], // 外側広筋
  ['quads', [-0.03, -0.32, 0.03], [0.044, 0.09, 0.044]], // 内側広筋(ひざの上の内側のふくらみ)
  ['hamstrings', [0.026, -0.22, -0.04], [0.042, 0.18, 0.045]], // 大腿二頭筋
  ['hamstrings', [-0.022, -0.22, -0.04], [0.042, 0.18, 0.045]], // 半腱様筋など
  [null, [0, -0.445, 0.012], [0.05, 0.052, 0.05]], // ひざ
  [null, [0, -0.445, 0.052], [0.026, 0.03, 0.014]], // ひざのお皿
  [null, [0, -0.66, 0], [0.042, 0.2, 0.045]], // すね
  ['calves', [-0.02, -0.565, -0.034], [0.035, 0.11, 0.04]], // 腓腹筋(内側)
  ['calves', [0.022, -0.555, -0.03], [0.03, 0.1, 0.036]], // 腓腹筋(外側)
  ['calves', [0, -0.67, -0.028], [0.044, 0.09, 0.033]], // ヒラメ筋
  [null, [0, -0.86, 0], [0.034, 0.04, 0.038]], // 足首
  [null, [0, -0.897, 0.04], [0.045, 0.032, 0.1]], // 足
];

// 回転行列(Z・Y・X の順に掛ける)。行ごとの配列で返す。
function rotation([rx, ry, rz]) {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(rx), Math.sin(rx), Math.cos(ry), Math.sin(ry), Math.cos(rz), Math.sin(rz)];
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}

function build() {
  const parts = [];
  // 各パーツ: { muscle, pos, scale, rot: 3x3 の回転行列 }
  const add = (muscle, pos, scale, euler) => parts.push({ muscle, pos, scale, rot: rotation(euler) });
  // 左右を反転するときは、y 軸・z 軸まわりの回転の向きも逆にする
  const mirror = ([rx, ry, rz], s) => [rx, s * ry, s * rz];

  for (const [muscle, [x, y, z], scale, euler = [0, 0, 0]] of TORSO) {
    if (x === 0) add(muscle, [0, y, z], scale, euler);
    else for (const s of [1, -1]) add(muscle, [s * x, y, z], scale, mirror(euler, s));
  }
  // 腕と脚は、付け根を中心に外へ傾ける
  const limb = (list, [px, py], tilt) => {
    for (const s of [1, -1]) {
      const a = s * tilt;
      const [cos, sin] = [Math.cos(a), Math.sin(a)];
      for (const [muscle, [x, y, z], scale] of list) {
        const lx = s * x;
        add(muscle, [s * px + lx * cos - y * sin, py + lx * sin + y * cos, z], scale, [0, 0, a]);
      }
    }
  };
  limb(ARM, SHOULDER, ARM_TILT);
  limb(LEG, HIP, LEG_TILT);
  return parts;
}

export const PARTS = build();
export const BODY_CENTER_Y = 0.9;

// 2D 用: 楕円体を前(または後ろ)から見たときの楕円 { rx, ry, angle }。
// angle は前から見たときの、画面上での反時計回りの角度(ラジアン)。
export function silhouette(part) {
  // M = 回転 × 拡大。影の形は M·Mᵀ の左上 2x2 で決まる。
  const m = part.rot.map((row) => row.map((v, j) => v * part.scale[j]));
  const dot = (i, j) => m[i][0] * m[j][0] + m[i][1] * m[j][1] + m[i][2] * m[j][2];
  const [a, b, c] = [dot(0, 0), dot(0, 1), dot(1, 1)];
  const mid = (a + c) / 2;
  const diff = Math.hypot((a - c) / 2, b);
  return { rx: Math.sqrt(mid + diff), ry: Math.sqrt(Math.max(mid - diff, 0)), angle: 0.5 * Math.atan2(2 * b, a - c) };
}

// ---- 痛みの印(⚠️)を置く位置 ----
// 本人の右は x が負の側(体の前は z の正なので、前から見ると画面の左が本人の右)。

function centroid(muscle, sign) {
  const list = PARTS.filter((p) => p.muscle === muscle && (sign === 0 || Math.sign(p.pos[0]) === sign));
  const n = list.length || 1;
  return [0, 1, 2].map((i) => list.reduce((a, p) => a + p.pos[i], 0) / n);
}
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// 関節の位置: 近くの筋肉の中心から決める
const JOINT_POINT = {
  shoulder: (s) => centroid('deltSide', s),
  elbow: (s) => lerp(centroid('biceps', s), centroid('forearms', s), 0.5),
  wrist: (s) => lerp(centroid('biceps', s), centroid('forearms', s), 1.6),
  hip: (s) => centroid('glutes', s),
  knee: (s) => lerp(centroid('quads', s), centroid('calves', s), 0.5),
  ankle: (s) => lerp(centroid('quads', s), centroid('calves', s), 1.55),
  neck: () => [0, 1.54, 0.05],
  lowerBack: () => centroid('erectors', 0),
};

// part(筋肉か関節のキー)と side('left'|'right'|'both'|'center')から、印を置く点 [x, y, z] の一覧
export function markerPoints(part, side) {
  const point = JOINT_POINT[part] || ((s) => centroid(part, s));
  if (part === 'neck' || part === 'lowerBack' || side === 'center') return [point(0)];
  const signs = side === 'right' ? [-1] : side === 'left' ? [1] : [-1, 1];
  return signs.map((s) => point(s)).filter((p) => p.every(Number.isFinite));
}
