// 自動バックアップ。保存データ(JSON の文字列)を、端末の中の別の場所に直近3つまで残す。
// 保存先(storage)は localStorage と同じ形のものを受け取る(テストでは置き換える)。DOM には触れない。
//
// 1つ = 1つのキー: 'workoutTracker.autoBackup.<保存した時刻(ミリ秒)>.<理由>'。値は保存データの文字列そのまま。
// 端末の中に置くので、スマホをなくしたときやサイトのデータを消したときは一緒に消える。
// 操作ミスや不具合から戻すための備えで、書き出しのバックアップの代わりにはならない。
import { toDateStr } from './calc.js';

const PREFIX = 'workoutTracker.autoBackup.';
export const AUTO_BACKUP_MAX = 3;
export const BACKUP_REASONS = {
  daily: '起動時',
  migrate: 'データ変換の前',
  restore: '復元の前',
};

// 残っている自動バックアップ。新しい順。[{ key, at, reason }]
export function listAutoBackups(storage) {
  const out = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    const [at, reason] = key.slice(PREFIX.length).split('.');
    if (/^\d+$/.test(at) && reason in BACKUP_REASONS) out.push({ key, at: Number(at), reason });
  }
  return out.sort((a, b) => b.at - a.at);
}

export const readAutoBackup = (storage, key) => (key.startsWith(PREFIX) ? storage.getItem(key) : null);

// 今日の分がまだなければ true(1日1回、その日に初めて開いたときに取る)
export const needsDailyBackup = (list, nowMs) => !list.some((b) => toDateStr(new Date(b.at)) === toDateStr(new Date(nowMs)));

// 1つ保存し、古いものを消して max 個までにする。保存できたら true。
// 端末の容量が足りないときは、古い自動バックアップから消して入れ直す。それでも入らなければ false。
export function saveAutoBackup(storage, raw, { nowMs = Date.now(), reason = 'daily', max = AUTO_BACKUP_MAX } = {}) {
  const kept = listAutoBackups(storage);
  for (const b of kept.splice(max - 1)) storage.removeItem(b.key);
  // 同じミリ秒に2つ取ったときは、後の方を1ミリ秒ずらす(キーが重ならないように)
  let at = nowMs;
  while (kept.some((b) => b.at === at)) at++;
  const key = `${PREFIX}${at}.${reason}`;
  for (;;) {
    try {
      storage.setItem(key, raw);
      return true;
    } catch {
      const oldest = kept.pop();
      if (!oldest) return false;
      storage.removeItem(oldest.key);
    }
  }
}

// いちばん古い自動バックアップを1つ消す(本体のデータを保存する場所が足りないとき)。消せたら true。
export function dropOldestAutoBackup(storage) {
  const oldest = listAutoBackups(storage).pop();
  if (!oldest) return false;
  storage.removeItem(oldest.key);
  return true;
}
