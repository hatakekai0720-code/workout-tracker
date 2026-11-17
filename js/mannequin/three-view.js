// 3D マネキン(Three.js)。必要なときだけ描画し、動かしていない間は何もしない。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PARTS, COLORS, BODY_CENTER_Y, markerPoints } from './model.js';

const DISTANCE = 3.65;
const VIEWS = { front: 0, side: Math.PI / 2, back: Math.PI };
const TURN_MS = 350;
const TAP_MOVE_PX = 8;
const PAN_Y = [0.25, 1.6]; // 上下に動かせる範囲(見る中心の高さ、m)。足先〜頭
const PAN_STEP = 0.3; // ▲▼ボタン1回で動かす量

// 痛みの印: 黄色い三角に「!」。体に隠れないよう、いつも手前に描く
function markTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.beginPath();
  g.moveTo(32, 4);
  g.lineTo(61, 58);
  g.lineTo(3, 58);
  g.closePath();
  g.fillStyle = '#ffd21f';
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = '#3a2a00';
  g.stroke();
  g.fillStyle = '#3a2a00';
  g.font = 'bold 36px sans-serif';
  g.textAlign = 'center';
  g.fillText('!', 32, 52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 筋線維のすじ模様(白〜うすい灰色の縦じま)。色に掛け合わせるので、筋肉の色はそのまま残る。
// 球の UV は縦(y 方向)に沿うので、すじは楕円体の長い方向に走る。
function fiberTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 8;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let x = 0; x < c.width; x++) {
    const v = 255 - Math.round(rand() * 34 + (x % 4 === 0 ? 18 : 0));
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(x, 0, 1, c.height);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  return tex;
}

// 足もとの影(ぼかした円)
function floorShadow() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.32)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.42), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.002;
  return mesh;
}

export function create3D(host, { onSelect }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '筋肉マップ(3D)');
  host.replaceChildren(canvas);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff6ee, 0x8a7468, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); // 手前上からの主な光
  const rim = new THREE.DirectionalLight(0xdfe8ff, 1.4); // 後ろからの光で、輪郭を浮かせる
  scene.add(sun, rim);
  const shadow = floorShadow();
  scene.add(shadow);

  const target = new THREE.Vector3(0, BODY_CENTER_Y, 0);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
  camera.position.set(0, BODY_CENTER_Y, DISTANCE);

  // 球を1つだけ作り、拡大縮小してすべてのパーツに使い回す(ポリゴン数とメモリを抑える)
  const sphere = new THREE.SphereGeometry(1, 32, 20);
  const fibers = fiberTexture();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: COLORS.body, roughness: 0.62, metalness: 0 });
  const muscleMaterial = () => new THREE.MeshStandardMaterial({ color: COLORS.idle, map: fibers, roughness: 0.48, metalness: 0 });
  const materials = new Map(); // 筋肉のキー → マテリアル(左右で共有)
  const meshes = [];
  for (const part of PARTS) {
    let material = bodyMaterial;
    if (part.muscle) {
      if (!materials.has(part.muscle)) materials.set(part.muscle, muscleMaterial());
      material = materials.get(part.muscle);
    }
    const mesh = new THREE.Mesh(sphere, material);
    // 位置・回転・拡大を1つの行列にまとめて直接渡す
    const r = part.rot;
    const [sx, sy, sz] = part.scale;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.set(
      r[0][0] * sx, r[0][1] * sy, r[0][2] * sz, part.pos[0],
      r[1][0] * sx, r[1][1] * sy, r[1][2] * sz, part.pos[1],
      r[2][0] * sx, r[2][1] * sy, r[2][2] * sz, part.pos[2],
      0, 0, 0, 1,
    );
    mesh.userData.muscle = part.muscle;
    scene.add(mesh);
    meshes.push(mesh);
  }

  // ---- 描画(変化があったときだけ) ----
  let frame = 0;
  let disposed = false;
  function draw() {
    frame = 0;
    if (disposed) return;
    // いつも見ている向きに合わせて、手前の右上から照らし、反対側の後ろから輪郭を照らす
    const toCam = camera.position.clone().sub(target).setY(0).normalize();
    const side = new THREE.Vector3(toCam.z, 0, -toCam.x);
    sun.position.copy(target).addScaledVector(toCam, 2).addScaledVector(side, 1).add(new THREE.Vector3(0, 2, 0));
    rim.position.copy(target).addScaledVector(toCam, -2).addScaledVector(side, -1.2).add(new THREE.Vector3(0, 1, 0));
    renderer.render(scene, camera);
  }
  const requestDraw = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };

  // ---- 操作: 1本指で回転、ピンチで拡大縮小、2本指のまま動かすと上下に移動 ----
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(target);
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.enableDamping = false;
  controls.minDistance = 1.4;
  controls.maxDistance = 6;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = Math.PI - 0.35;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  // 動かすのは上下だけ。左右・前後へのずれは打ち消し、高さは体の範囲に収める
  function keepOnBody() {
    const t = controls.target;
    const y = Math.min(Math.max(t.y, PAN_Y[0]), PAN_Y[1]);
    const shift = new THREE.Vector3(-t.x, y - t.y, -t.z);
    if (shift.lengthSq() < 1e-12) return;
    t.add(shift);
    camera.position.add(shift);
  }
  controls.addEventListener('change', () => {
    keepOnBody();
    requestDraw();
  });
  controls.update();

  // ---- 色 ----
  let colors = {};
  let selected = null;
  function applyColors() {
    for (const [key, material] of materials) {
      material.color.set(key === selected ? COLORS.selected : colors[key] || COLORS.idle);
    }
    requestDraw();
  }

  // ---- タップで筋肉を選ぶ(ドラッグとは区別する) ----
  const raycaster = new THREE.Raycaster();
  let down = null;
  canvas.addEventListener('pointerdown', (ev) => {
    down = ev.isPrimary ? { x: ev.clientX, y: ev.clientY } : null;
  });
  canvas.addEventListener('pointerup', (ev) => {
    if (!down || !ev.isPrimary) return;
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    down = null;
    if (moved > TAP_MOVE_PX) return;
    const rect = canvas.getBoundingClientRect();
    const point = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(point, camera);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    onSelect(hit?.object.userData.muscle || null);
  });

  // ---- 上下に動かす(▲▼ボタン)。見る中心の高さを変え、カメラも同じだけ動かす ----
  let turning = 0;
  function moveTo(y, animate = true) {
    cancelAnimationFrame(turning);
    const from = controls.target.y;
    const to = Math.min(Math.max(y, PAN_Y[0]), PAN_Y[1]);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    const step = (now) => {
      const t = !animate || reduce ? 1 : Math.min((now - start) / TURN_MS, 1);
      const k = t * t * (3 - 2 * t);
      const dy = from + (to - from) * k - controls.target.y;
      controls.target.y += dy;
      camera.position.y += dy;
      controls.update();
      requestDraw();
      if (t < 1) turning = requestAnimationFrame(step);
    };
    step(start);
  }
  const panBox = document.createElement('div');
  panBox.className = 'mq-pan';
  panBox.innerHTML = `<button type="button" data-pan="1" aria-label="上へ">▲</button><button type="button" data-pan="-1" aria-label="下へ">▼</button>`;
  panBox.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-pan]');
    // 引いて全身が見えているときは少しだけ、近づいているときは大きく動かす
    const near = camera.position.distanceTo(controls.target) / DISTANCE;
    if (b) moveTo(controls.target.y + Number(b.dataset.pan) * PAN_STEP * Math.min(1, near * 1.4));
  });
  host.append(panBox);

  // ---- 向きの切り替え(全身が見える位置に戻す) ----
  function setView(name, animate = true) {
    cancelAnimationFrame(turning);
    const fromTarget = controls.target.clone();
    const from = new THREE.Spherical().setFromVector3(camera.position.clone().sub(fromTarget));
    let delta = VIEWS[name] - from.theta;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta)); // 近い回り方を選ぶ
    const to = { radius: DISTANCE, phi: Math.PI / 2 - 0.04, theta: from.theta + delta };
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    const step = (now) => {
      const t = !animate || reduce ? 1 : Math.min((now - start) / TURN_MS, 1);
      const k = t * t * (3 - 2 * t);
      const s = new THREE.Spherical(
        from.radius + (to.radius - from.radius) * k,
        from.phi + (to.phi - from.phi) * k,
        from.theta + (to.theta - from.theta) * k,
      );
      controls.target.lerpVectors(fromTarget, target, k);
      camera.position.setFromSpherical(s).add(controls.target);
      controls.update();
      requestDraw();
      if (t < 1) turning = requestAnimationFrame(step);
    };
    step(start);
  }

  // ---- 大きさを枠に合わせる ----
  function resize() {
    const { clientWidth: w, clientHeight: h } = host;
    if (!w || !h) return; // タブが隠れている間
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestDraw();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  setView('front', false);

  // ---- 痛みの印 ----
  const markTex = markTexture();
  const markMaterial = new THREE.SpriteMaterial({ map: markTex, depthTest: false, transparent: true });
  const marks = new THREE.Group();
  marks.renderOrder = 10;
  scene.add(marks);
  function setMarkers(list) {
    marks.clear();
    for (const m of list || []) {
      for (const [x, y, z] of markerPoints(m.part, m.side)) {
        const sprite = new THREE.Sprite(markMaterial);
        sprite.position.set(x, y, z);
        sprite.scale.set(0.09, 0.09, 1);
        sprite.renderOrder = 10;
        marks.add(sprite);
      }
    }
    requestDraw();
  }

  return {
    mode: '3d',
    setMarkers,
    setSelected(key) {
      selected = key;
      applyColors();
    },
    setColors(map) {
      colors = map || {};
      applyColors();
    },
    setView,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(turning);
      observer.disconnect();
      panBox.remove();
      controls.dispose();
      sphere.dispose();
      fibers.dispose();
      markTex.dispose();
      markMaterial.dispose();
      shadow.geometry.dispose();
      shadow.material.map.dispose();
      shadow.material.dispose();
      bodyMaterial.dispose();
      materials.forEach((m) => m.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
