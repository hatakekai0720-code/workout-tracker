// 保存データの版(schemaVersion)と、古い版からの自動変換。DOM や保存先には触れない。
//
// データの形を変えるとき(必ずこの順で):
//   1. SCHEMA_VERSION を 1 つ上げる
//   2. MIGRATIONS に「前の版の番号: その版のデータを次の版の形に直して返す関数」を 1 つ足す
//   3. tests/migrate.test.js に、古い形のデータが新しい形になるテストを足す
// 起動時(store.js)とバックアップの取り込み時(backup.js)に、ここを通して最新の形にそろえる。
// 変換の前には、store.js が自動バックアップを取る。

export const SCHEMA_VERSION = 1;

// 例: 1: (data) => ({ ...data, newField: [] }), // 版1 → 版2
export const MIGRATIONS = {};

// データの版。番号がない・おかしいものは、最初の版(1)として扱う。
export function versionOf(data) {
  const v = data?.schemaVersion;
  return Number.isInteger(v) && v >= 1 ? v : 1;
}

// 最新の版に変換する。受け取ったデータは変えずに、新しいデータを返す。
// 返り値: { data, from, to, tooNew }
//   tooNew: このアプリより新しい版のデータ。変換せずにそのまま返す(呼び出し側で扱いを決める)。
export function migrate(data, migrations = MIGRATIONS, latest = SCHEMA_VERSION) {
  const from = versionOf(data);
  if (from > latest) return { data, from, to: from, tooNew: true };
  let cur = structuredClone(data);
  for (let v = from; v < latest; v++) {
    const step = migrations[v];
    if (typeof step !== 'function') throw new Error(`版${v}から版${v + 1}への変換がありません`);
    cur = step(cur);
    cur.schemaVersion = v + 1;
  }
  cur.schemaVersion = latest;
  return { data: cur, from, to: latest, tooNew: false };
}
