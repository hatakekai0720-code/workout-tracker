// 振り替えの記録(「元に戻す」のため)と、自動では動かさない回の一覧。
// 保存データ本体とは別のキーに置く(バックアップには含めない。消えても予定そのものは壊れない)。
//   last: 直近の振り替え { at, mode: 'auto'|'manual'|'restart', moves, adjusted: [記録id], choices: { key: 'sick' }, dismissed } | null
//   hold: 自動では動かさない過去の回の key(元に戻した・「今回はしない」を選んだもの)
const KEY = 'workoutTracker.reschedule';

export function loadLog(storage = localStorage) {
  try {
    const v = JSON.parse(storage.getItem(KEY));
    if (v && typeof v === 'object') return { last: v.last && Array.isArray(v.last.moves) ? v.last : null, hold: Array.isArray(v.hold) ? v.hold : [] };
  } catch {
    /* 壊れていたら空から */
  }
  return { last: null, hold: [] };
}

export function saveLog(log, storage = localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(log));
  } catch {
    /* 保存できなくても予定の振り替え自体は済んでいる */
  }
}
