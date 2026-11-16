import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// フォルダの決まり(CLAUDE.md の「構成」)を、ファイルが増えても守れているか確かめる。
//   画面(views) → ui / logic / data の向きにだけ読み込む。logic は logic しか読まず、DOM にも保存先にも触れない。
const root = new URL('../js/', import.meta.url).pathname;
const files = (dir) => readdirSync(`${root}${dir}`).filter((f) => f.endsWith('.js')).map((f) => `${dir}/${f}`);
const importsOf = (file) => [...readFileSync(`${root}${file}`, 'utf8').matchAll(/(?:from\s*|import\s*\(\s*)'(\.[^']+)'/g)].map((m) => m[1]);
// どのフォルダの何を読むか(js/ からの相対で '../logic/x.js' → 'logic')
const folderOf = (file, spec) => {
  const parts = `${file.split('/').slice(0, -1).join('/')}/${spec}`.split('/');
  const out = [];
  for (const p of parts) (p === '..' ? out.pop() : p !== '.' && out.push(p));
  return out.length > 1 ? out[0] : '(js 直下)';
};
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');

test('logic/ は logic/ のファイルしか読み込まない', () => {
  for (const f of files('logic')) {
    for (const spec of importsOf(f)) assert.equal(folderOf(f, spec), 'logic', `${f} が ${spec} を読み込んでいます`);
  }
});

test('logic/ は DOM・保存先・通信に触れない(node だけでテストできる)', () => {
  const banned = /\b(document|window|localStorage|sessionStorage|navigator|fetch|alert|confirm)\b/;
  for (const f of files('logic')) assert.doesNotMatch(strip(readFileSync(`${root}${f}`, 'utf8')), banned, `${f} が DOM か保存先に触れています`);
});

test('data/ は画面(views・ui)を読み込まない。migrate・autobackup・backup は DOM にも触れない', () => {
  for (const f of files('data')) {
    for (const spec of importsOf(f)) assert.ok(['data', 'logic'].includes(folderOf(f, spec)), `${f} が ${spec} を読み込んでいます`);
  }
  for (const f of ['data/migrate.js', 'data/autobackup.js', 'data/backup.js']) {
    assert.doesNotMatch(strip(readFileSync(`${root}${f}`, 'utf8')), /\b(document|window|localStorage)\b/, `${f} が DOM か保存先に直接触れています`);
  }
});

test('すべての読み込み先が実在する(ファイルを動かしたときの取りこぼし)', () => {
  for (const dir of ['data', 'logic', 'ui', 'views', 'views/program', 'mannequin']) {
    for (const f of files(dir)) {
      for (const spec of importsOf(f)) {
        assert.doesNotThrow(() => readFileSync(new URL(`../js/${dir}/${spec}`, import.meta.url)), `${f} の ${spec} が見つかりません`);
      }
    }
  }
});
