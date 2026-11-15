// 筋肉の一覧。キーは種目マスタの muscles、解説データ、3Dマネキンのメッシュで共通に使う。
export const MUSCLES = {
  chest: '胸',
  deltFront: '肩(前)',
  deltSide: '肩(横)',
  deltRear: '肩(後ろ)',
  biceps: '上腕二頭筋',
  triceps: '上腕三頭筋',
  forearms: '前腕',
  abs: '腹筋',
  obliques: '腹斜筋',
  traps: '僧帽筋',
  lats: '広背筋',
  erectors: '脊柱起立筋',
  glutes: 'お尻',
  quads: '太もも前',
  hamstrings: '太もも裏',
  calves: 'ふくらはぎ',
};

export const MUSCLE_KEYS = Object.keys(MUSCLES);

// 不正なキーや重複を除く。メインに入っているものはサブから外す。
export function cleanMuscles(m) {
  const pick = (list) => [...new Set(Array.isArray(list) ? list : [])].filter((k) => k in MUSCLES);
  const main = pick(m?.main);
  return { main, sub: pick(m?.sub).filter((k) => !main.includes(k)) };
}
