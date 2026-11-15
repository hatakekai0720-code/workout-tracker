// 3D マネキン(Three.js)。必要なときだけ描画し、動かしていない間は何もしない。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PARTS, COLORS, BODY_CENTER_Y } from './model.js';

const DISTANCE = 3.65;
const VIEWS = { front: 0, side: Math.PI / 2, back: Math.PI };
const TURN_MS = 350;
const TAP_MOVE_PX = 8;

export function create3D(host, { onSelect }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '筋肉マップ(3D)');
  host.replaceChildren(canvas);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9a917f, 2.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.3);
  scene.add(sun);

  const target = new THREE.Vector3(0, BODY_CENTER_Y, 0);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
  camera.position.set(0, BODY_CENTER_Y, DISTANCE);

  // 球を1つだけ作り、拡大縮小してすべてのパーツに使い回す(ポリゴン数とメモリを抑える)
  const sphere = new THREE.SphereGeometry(1, 14, 9);
  const bodyMaterial = new THREE.MeshLambertMaterial({ color: COLORS.body });
  const materials = new Map(); // 筋肉のキー → マテリアル(左右で共有)
  const meshes = [];
  for (const part of PARTS) {
    let material = bodyMaterial;
    if (part.muscle) {
      if (!materials.has(part.muscle)) materials.set(part.muscle, new THREE.MeshLambertMaterial({ color: COLORS.idle }));
      material = materials.get(part.muscle);
    }
    const mesh = new THREE.Mesh(sphere, material);
    mesh.position.set(...part.pos);
    mesh.scale.set(...part.scale);
    mesh.rotation.z = part.rotZ;
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
    sun.position.copy(camera.position).add(new THREE.Vector3(0.8, 1.5, 0.5)); // いつも手前上から照らす
    renderer.render(scene, camera);
  }
  const requestDraw = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };

  // ---- 操作: 1本指で回転、ピンチで拡大縮小 ----
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(target);
  controls.enablePan = false;
  controls.enableDamping = false;
  controls.minDistance = 1.4;
  controls.maxDistance = 6;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = Math.PI - 0.35;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.addEventListener('change', requestDraw);
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

  // ---- 向きの切り替え ----
  let turning = 0;
  function setView(name, animate = true) {
    cancelAnimationFrame(turning);
    const from = new THREE.Spherical().setFromVector3(camera.position.clone().sub(target));
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
      camera.position.setFromSpherical(s).add(target);
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

  return {
    mode: '3d',
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
      controls.dispose();
      sphere.dispose();
      bodyMaterial.dispose();
      materials.forEach((m) => m.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
