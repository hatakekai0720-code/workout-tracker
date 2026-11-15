// 種目の解説。初期種目の解説は data/guides.json に分けてあり、起動時に読み込む。
// 自分で追加した種目は、種目マスタの customGuide(下の項目ごとの自由記述)に書く。
import { cleanMuscles } from './muscles.js';

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

let guides = {};

export async function loadGuides() {
  try {
    const res = await fetch('data/guides.json');
    if (res.ok) guides = await res.json();
  } catch {
    guides = {}; // 読めなくても記録の機能は使える
  }
}

export const getGuide = (exerciseId) => guides[exerciseId] || null;

// 種目の効く筋肉。種目マスタで設定していればそれを、なければ解説データの初期値を使う。
export function musclesOf(ex) {
  return cleanMuscles(ex.muscles ?? getGuide(ex.id)?.muscles);
}
