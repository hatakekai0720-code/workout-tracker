// マネキンの形。すべて「楕円体」で、3D ではつぶした球、2D では楕円として描く。
// 筋肉は体の表面に沿わせた薄い板のような楕円体にして、解剖図のように見せる。
// 単位はおよそメートル。y が上、z の正が体の前、x は左右。

export const COLORS = {
  body: '#f1dccc', // 筋肉以外(頭・関節・手足)
  idle: '#d79d92', // 色を付けていない筋肉
  selected: '#316ac5', // タップして選んだ筋肉
  outline: '#7a5f55',
};

const ARM_TILT = 0.26; // 腕を少し開いた姿勢(ラジアン)
const LEG_TILT = 0.05;
const SHOULDER = [0.225, 1.435];
const HIP = [0.1, 0.93];

// [筋肉(骨格は null), 位置 [x, y, z], 半径 [x, y, z], 回転 [x, y, z]]
// x が 0 でないものは左右に1つずつ置く(右側の値で書く)。
const TORSO = [
  [null, [0, 1.665, 0.005], [0.092, 0.118, 0.105]], // 頭
  [null, [0, 1.535, -0.005], [0.052, 0.08, 0.055]], // 首
  [null, [0, 1.425, -0.01], [0.2, 0.07, 0.09]], // 肩まわり
  [null, [0, 1.3, 0], [0.165, 0.2, 0.105]], // 胸郭
  [null, [0, 1.08, 0], [0.135, 0.15, 0.09]], // 腹まわり
  [null, [0, 0.955, 0], [0.16, 0.11, 0.1]], // 骨盤
  ['chest', [0.083, 1.345, 0.074], [0.096, 0.076, 0.04], [0, 0.3, -0.1]],
  ['abs', [0.042, 1.235, 0.09], [0.04, 0.034, 0.02]],
  ['abs', [0.042, 1.165, 0.093], [0.04, 0.034, 0.02]],
  ['abs', [0.042, 1.095, 0.093], [0.04, 0.034, 0.02]],
  ['abs', [0.04, 1.005, 0.088], [0.038, 0.058, 0.02]],
  ['obliques', [0.113, 1.1, 0.036], [0.05, 0.13, 0.068], [0, 0.25, 0.1]],
  ['traps', [0.095, 1.49, -0.03], [0.1, 0.038, 0.05], [0, 0, -0.36]],
  ['traps', [0, 1.545, -0.04], [0.042, 0.06, 0.03]],
  ['traps', [0, 1.385, -0.092], [0.085, 0.15, 0.028]],
  ['lats', [0.115, 1.21, -0.064], [0.092, 0.17, 0.042], [0, -0.35, -0.25]],
  ['erectors', [0.036, 1.04, -0.084], [0.03, 0.105, 0.024]],
  ['glutes', [0.085, 0.93, -0.052], [0.094, 0.105, 0.068], [0, 0, -0.12]],
];

// 腕: 肩を原点に、下向きを -y とした位置。x は体の外側が正。
const ARM = [
  [null, [0, -0.01, 0], [0.055, 0.055, 0.055]], // 肩の関節
  ['deltFront', [-0.005, -0.03, 0.038], [0.052, 0.085, 0.046]],
  ['deltSide', [0.03, -0.03, 0], [0.045, 0.09, 0.055]],
  ['deltRear', [-0.005, -0.03, -0.038], [0.052, 0.085, 0.046]],
  [null, [0, -0.17, 0], [0.042, 0.15, 0.044]], // 上腕の芯
  ['biceps', [0, -0.165, 0.026], [0.04, 0.115, 0.036]],
  ['triceps', [0, -0.165, -0.028], [0.042, 0.125, 0.036]],
  [null, [0, -0.31, 0], [0.036, 0.036, 0.036]], // ひじ
  ['forearms', [0, -0.42, 0], [0.041, 0.12, 0.038]],
  [null, [0, -0.52, 0], [0.03, 0.07, 0.028]], // 手首
  [null, [0, -0.635, 0], [0.034, 0.068, 0.022]], // 手
];

// 脚: 股関節を原点に、下向きを -y とした位置。
const LEG = [
  [null, [0, -0.21, 0], [0.078, 0.235, 0.08]], // 太ももの芯
  ['quads', [0, -0.2, 0.033], [0.074, 0.205, 0.066]],
  ['hamstrings', [0, -0.215, -0.038], [0.07, 0.19, 0.06]],
  [null, [0, -0.445, 0.012], [0.05, 0.052, 0.05]], // ひざ
  [null, [0, -0.66, 0], [0.044, 0.2, 0.046]], // すね
  ['calves', [0, -0.585, -0.032], [0.054, 0.135, 0.05]],
  [null, [0, -0.86, 0], [0.036, 0.04, 0.04]], // 足首
  [null, [0, -0.897, 0.04], [0.046, 0.033, 0.1]], // 足
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
