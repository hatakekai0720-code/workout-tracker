import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const sw = readFileSync(`${root}sw.js`, 'utf8');
const precache = [...sw.match(/const PRECACHE = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('事前キャッシュに挙げたファイルがすべて存在する', () => {
  for (const f of precache) {
    if (f === './') continue;
    assert.ok(existsSync(root + f), `${f} がありません`);
  }
});

test('アプリの JS・CSS がすべて事前キャッシュに入っている', () => {
  const files = [
    ...readdirSync(`${root}js`).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`),
    ...readdirSync(`${root}js/views`).map((f) => `js/views/${f}`),
    ...readdirSync(`${root}css`).map((f) => `css/${f}`),
    ...readdirSync(`${root}icons`).map((f) => `icons/${f}`),
  ];
  for (const f of files) assert.ok(precache.includes(f), `${f} が sw.js の PRECACHE にありません`);
});

test('マニフェストのアイコンが存在する', () => {
  const manifest = JSON.parse(readFileSync(`${root}manifest.webmanifest`, 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  for (const icon of manifest.icons) assert.ok(existsSync(root + icon.src), `${icon.src} がありません`);
});
