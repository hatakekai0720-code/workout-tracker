// トレーニング中モードの途中経過。保存データ本体とは別のキーに置く(バックアップには含めない)。
// 操作のたびに保存し、アプリを閉じても続きから再開できるようにする。終わったら消す。
import { isValidWorkout } from '../logic/workout.js';

const KEY = 'workoutTracker.workout';

export function loadWorkout(storage = localStorage) {
  try {
    const w = JSON.parse(storage.getItem(KEY));
    return isValidWorkout(w) ? w : null;
  } catch {
    return null;
  }
}

export function saveWorkout(w, storage = localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(w));
  } catch {
    /* 容量不足などで保存できなくても、画面の操作は続ける */
  }
}

export function clearWorkout(storage = localStorage) {
  storage.removeItem(KEY);
}
