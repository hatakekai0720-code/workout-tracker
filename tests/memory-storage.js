// テスト用の localStorage の代わり(メモリの中だけ)。quota を決めると、合計の文字数を超えたときに保存を断る。
export class MemoryStorage {
  constructor(quota = Infinity) {
    this.map = new Map();
    this.quota = quota;
  }
  get length() {
    return this.map.size;
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    const used = [...this.map].reduce((a, [key, val]) => a + (key === k ? 0 : key.length + val.length), 0);
    if (used + k.length + String(v).length > this.quota) throw new Error('QuotaExceededError');
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}
