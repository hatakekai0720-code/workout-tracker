// Service Worker: オフラインでも開けるようにする。
// - アプリ本体はネットワーク優先(つながれば常に最新、だめならキャッシュ)
// - フォントは変わらないのでキャッシュ優先(使った分だけ貯まる)
// PRECACHE を変えたら VERSION を上げる(tests/sw.test.js がファイルの過不足を確かめる)。
const VERSION = 'v13';
const SHELL = `shell-${VERSION}`;
const FONTS = 'fonts-v1';
const CDN = 'cdn-v1';
// 3D マネキン用の Three.js(版を固定)。一度取得したらオフラインでも 3D が出る。
const CDN_PREFIX = 'https://cdn.jsdelivr.net/npm/three@0.180.0/';
const NETWORK_TIMEOUT_MS = 3000;

const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'data/exercises.json',
  'js/app.js',
  'js/backup.js',
  'js/calc.js',
  'js/charts.js',
  'js/guides.js',
  'js/insights.js',
  'js/mannequin/index.js',
  'js/mannequin/model.js',
  'js/mannequin/svg-view.js',
  'js/mannequin/three-view.js',
  'js/musclemap.js',
  'js/muscles.js',
  'js/placement.js',
  'js/program.js',
  'js/schedule.js',
  'js/store.js',
  'js/suggest.js',
  'js/theme.js',
  'js/timer.js',
  'js/util.js',
  'js/views/body.js',
  'js/views/calendar.js',
  'js/views/entry.js',
  'js/views/event.js',
  'js/views/exercises.js',
  'js/views/guide.js',
  'js/views/home.js',
  'js/views/program.js',
  'js/views/settings.js',
  'js/views/stats.js',
  'js/views/term.js',
  'js/views/timeline.js',
  'vendor/chart.umd.min.js',
  'vendor/noto-sans-jp/noto-sans-jp.css',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== FONTS && k !== CDN).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL);
  const fromCache = async () =>
    (await cache.match(request, { ignoreSearch: true })) ||
    (request.mode === 'navigate' ? cache.match('index.html') : undefined);
  const fromNetwork = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  });
  fromNetwork.catch(() => {}); // タイムアウト後に失敗しても未処理エラーにしない
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS));
  try {
    // 電波が悪くて返事が遅いときは、待たずにキャッシュを使う
    const res = await Promise.race([fromNetwork, timeout]);
    if (res) return res;
    return (await fromCache()) || fromNetwork;
  } catch {
    return (await fromCache()) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;
  if (url.href.startsWith(CDN_PREFIX)) return event.respondWith(cacheFirst(request, CDN));
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    url.pathname.includes('/vendor/noto-sans-jp/files/') ? cacheFirst(request, FONTS) : networkFirst(request),
  );
});
