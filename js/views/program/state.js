// 自動メニュー作成ダイアログの、画面どうしで共有する状態。
import { getState } from '../../data/store.js';
import { toDateStr } from '../../logic/dates.js';
import { guideFor } from '../../data/guides.js';

// dlg: ダイアログの要素 / cur: { mode: 'form' | 'preview' | 'place', f: 入力内容, config, result, week, swapping, place, onChange }
// mannequin: 入力画面の筋肉マップ / render / close: 今の画面を描き直す・閉じる(program.js が入れる)
export const ui = { dlg: null, cur: null, mannequin: null, render: null, close: null };

export const context = () => {
  const s = getState();
  return { exercises: s.exercises, guideFor, entries: s.entries, weightStepKg: s.settings.weightStepKg, today: toDateStr(new Date()) };
};
