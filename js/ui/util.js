// アプリの版。sw.js の VERSION とそろえる(テストで確認している)。設定画面のいちばん下に出す。
export const APP_VERSION = 'v19';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

let toastTimer = null;

// 画面下に短いお知らせを出す。
// popover にして最前面の層に載せるので、ダイアログを開いている間も見える。
export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  try {
    if (el.matches(':popover-open')) el.hidePopover();
    el.showPopover(); // 出し直すと、後から開いたダイアログより手前になる
  } catch {
    /* popover 非対応の環境では通常の表示だけ */
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    try {
      el.hidePopover();
    } catch {
      /* 同上 */
    }
  }, 3000);
}
