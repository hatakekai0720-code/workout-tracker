// Service Worker: オフラインでも開けるようにする。
// - アプリ本体はネットワーク優先(つながれば常に最新、だめならキャッシュ)
// - フォントは変わらないのでキャッシュ優先(使った分だけ貯まる)
// PRECACHE を変えたら VERSION を上げる(tests/sw.test.js がファイルの過不足を確かめる)。
const VERSION = 'v17'; // js/ui/util.js の APP_VERSION とそろえる(テストで確認している)
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
  'js/data/autobackup.js',
  'js/data/backup.js',
  'js/data/guides.js',
  'js/data/migrate.js',
  'js/data/store.js',
  'js/data/workout-session.js',
  'js/logic/dates.js',
  'js/logic/insights.js',
  'js/logic/musclemap.js',
  'js/logic/muscles.js',
  'js/logic/placement.js',
  'js/logic/program.js',
  'js/logic/schedule.js',
  'js/logic/suggest.js',
  'js/logic/training.js',
  'js/logic/workout.js',
  'js/mannequin/index.js',
  'js/mannequin/model.js',
  'js/mannequin/svg-view.js',
  'js/mannequin/three-view.js',
  'js/ui/charts.js',
  'js/ui/theme.js',
  'js/ui/timer.js',
  'js/ui/util.js',
  'js/views/body.js',
  'js/views/calendar.js',
  'js/views/entry.js',
  'js/views/event.js',
  'js/views/exercises.js',
  'js/views/guide.js',
  'js/views/home.js',
  'js/views/program.js',
  'js/views/program/form.js',
  'js/views/program/place.js',
  'js/views/program/preview.js',
  'js/views/program/state.js',
  'js/views/settings.js',
  'js/views/stats.js',
  'js/views/term.js',
  'js/views/timeline.js',
  'js/views/workout.js',
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
      // ブラウザの HTTP キャッシュ(GitHub Pages は10分)を通さず、必ず最新を取りに行く
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
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
  // cache: 'no-cache' で、ブラウザの HTTP キャッシュに古い版が残っていても必ずサーバーに確かめる
  const fromNetwork = fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' }).then((res) => {
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
