// 種目カタログ(解説つきの種目の一覧)。中身は data/exercises.json に分けてあり、起動時に読み込む。
// カタログの種目は、種目マスタ(保存データ)に guideId で結びつく。
// 自分で追加した種目は guideId を持たず、customGuide(下の項目ごとの自由記述)に解説を書く。
import { getState, setExercises } from './store.js';
import { cleanMuscles } from '../logic/muscles.js';

export const CATEGORIES = {
  bodyweight: '自重',
  small: '小物器具',
  dumbbell: 'ダンベル',
  barbell: 'バーベル',
  machine: 'マシン・ケーブル',
  run: 'ランニング',
};
export const CUSTOM_CATEGORY = '自分で追加した種目';

export const EQUIPMENT = {
  pullup_bar: '懸垂バー',
  ab_wheel: '腹筋ローラー',
  kettlebell: 'ケトルベル',
  dumbbell: 'ダンベル',
  bench: 'ベンチ',
  barbell: 'バーベル',
  rack: 'ラック',
  machine: 'ジムのマシン・ケーブル',
};

export const PLACES = { home: '自宅でできる', gym: 'ジム向け', outdoor: '屋外' };
export const LEVELS = { beginner: '初級', intermediate: '中級', advanced: '上級' };

export const CUSTOM_FIELDS = [
  ['setup', '準備(器具・スタートの姿勢・足幅や手幅)'],
  ['steps', 'やり方・テンポ'],
  ['breathing', '呼吸'],
  ['tips', 'コツ'],
  ['mistakes', '失敗例と直し方'],
  ['safety', '安全面'],
  ['levels', 'レベル別(楽な版 → 基本 → きつい版)'],
  ['dosage', '目安(回数×セット数・休憩)'],
];

let catalog = {};

export async function loadGuides() {
  try {
    const res = await fetch('data/exercises.json');
    if (res.ok) catalog = await res.json();
  } catch {
    catalog = {}; // 読めなくても記録の機能は使える
  }
}

export const guideFor = (ex) => (ex.guideId && catalog[ex.guideId]) || null;

// 種目で負担がかかる関節(js/logic/injury.js の JOINTS)。種目マスタで設定していればそれを、なければカタログの値を使う。
export const stressOf = (ex) => (Array.isArray(ex.stress) ? ex.stress : guideFor(ex)?.stress || []);

// 種目の効く筋肉。種目マスタで設定していればそれを、なければカタログの初期値を使う。
export function musclesOf(ex) {
  return cleanMuscles(ex.muscles ?? guideFor(ex)?.muscles);
}

// カタログの guideId から、種目マスタの(非表示でない)種目を探す
export function exerciseForGuide(guideId) {
  return getState().exercises.find((x) => x.guideId === guideId && !x.archived) || null;
}

// 種目の器具カテゴリ。自分で追加した種目は 'custom'。
export const categoryOf = (ex) => guideFor(ex)?.category || (ex.kind === 'run' ? 'run' : 'custom');

// 種目を器具カテゴリごとにまとめる(一覧や選択欄の見出し用)。空のカテゴリは返さない。
export function groupByCategory(exercises) {
  const groups = [...Object.entries(CATEGORIES), ['custom', CUSTOM_CATEGORY]].map(([key, label]) => ({ key, label, items: [] }));
  for (const ex of exercises) groups.find((g) => g.key === categoryOf(ex)).items.push(ex);
  return groups.filter((g) => g.items.length);
}

// ---- 持っている器具 ----

// 設定で選んだ器具の一覧。絞り込みを使っていなければ null(すべての種目を出す)。
export function ownedEquipment() {
  const owned = getState().settings.ownedEquipment;
  return Array.isArray(owned) ? owned : null;
}

// その種目に必要で、持っていない器具(キーの配列)。自分で追加した種目は常に空。
export function missingEquipment(ex) {
  const owned = ownedEquipment();
  if (!owned) return [];
  return (guideFor(ex)?.equipment || []).filter((k) => !owned.includes(k));
}

// 持っている器具でできる種目か
export const isAvailable = (ex) => missingEquipment(ex).length === 0;

// ---- 種目マスタとカタログの統合 ----

// 最初の版から入っていた種目: [結びつけるカタログの種目, 当時の名前]
const LEGACY = {
  ex_squat: ['db_squat', 'ダンベルスクワット'],
  ex_row: ['one_hand_row', 'ロウ'],
  ex_pullup: ['pullup', '懸垂'],
  ex_pushup: ['pushup', '腕立て伏せ'],
  ex_shoulder: ['db_shoulder_press', 'ショルダープレス'],
  ex_plank: ['plank', 'プランク'],
  ex_run: ['running', 'ランニング'],
};

// 種目マスタにカタログを反映した新しい一覧を返す。変更がなければ元の配列をそのまま返す。
// - 以前からある種目は id を変えずにカタログへ結びつける(記録はそのまま引き継がれる)
// - 名前を変えていなければカタログの名前にそろえ、自分で変えた名前は残す
// - まだない種目を追加する
export function mergeCatalog(exercises, cat) {
  let changed = false;
  const list = exercises.map((ex) => {
    if (ex.guideId || !LEGACY[ex.id]) return ex;
    let [slug, oldName] = LEGACY[ex.id];
    // スクワットを自重に変えて使っていた場合は、自重スクワットの解説に結びつける
    if (ex.id === 'ex_squat' && ex.loadType === 'bodyweight' && cat.bw_squat) slug = 'bw_squat';
    if (!cat[slug]) return ex;
    changed = true;
    return { ...ex, guideId: slug, name: ex.name === oldName ? cat[slug].name : ex.name };
  });
  const linked = new Set(list.map((x) => x.guideId).filter(Boolean));
  const ids = new Set(list.map((x) => x.id));
  for (const [slug, g] of Object.entries(cat)) {
    if (linked.has(slug)) continue;
    let id = `ex_${slug}`;
    while (ids.has(id)) id += '_2';
    ids.add(id);
    list.push({ id, name: g.name, kind: g.kind, bodyPart: g.bodyPart, loadType: g.loadType, guideId: slug, archived: false });
    changed = true;
  }
  return changed ? list : exercises;
}

// 起動時と、バックアップから復元した直後に呼ぶ
export function syncCatalog() {
  const { exercises } = getState();
  const merged = mergeCatalog(exercises, catalog);
  if (merged !== exercises) setExercises(merged);
}
