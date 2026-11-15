// Service Worker: オフラインでも開けるようにする。
// - アプリ本体はネットワーク優先(つながれば常に最新、だめならキャッシュ)
// - フォントは変わらないのでキャッシュ優先(使った分だけ貯まる)
// PRECACHE を変えたら VERSION を上げる(tests/sw.test.js がファイルの過不足を確かめる)。
const VERSION = 'v2';
const SHELL = `shell-${VERSION}`;
const FONTS = 'fonts-v1';
const NETWORK_TIMEOUT_MS = 3000;

const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'data/guides.json',
  'js/app.js',
  'js/backup.js',
  'js/calc.js',
  'js/charts.js',
  'js/guides.js',
  'js/insights.js',
  'js/muscles.js',
  'js/store.js',
  'js/suggest.js',
  'js/theme.js',
  'js/timer.js',
  'js/util.js',
  'js/views/body.js',
  'js/views/calendar.js',
  'js/views/entry.js',
  'js/views/exercises.js',
  'js/views/guide.js',
  'js/views/home.js',
  'js/views/settings.js',
  'js/views/stats.js',
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
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(FONTS);
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
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(url.pathname.includes('/vendor/noto-sans-jp/files/') ? cacheFirst(request) : networkFirst(request));
});
