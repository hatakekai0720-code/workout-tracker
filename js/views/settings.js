// 設定: テーマ、タイマー、種目マスタ、バックアップ・復元。
import {
  getState,
  getExercise,
  setSettings,
  exerciseInUse,
  saveExercise,
  deleteExercise,
  exportJson,
  replaceState,
  BODY_PARTS,
} from '../store.js';
import { toDateStr, formatDateJa } from '../calc.js';
import { parseBackup } from '../backup.js';
import { applyTheme } from '../theme.js';
import { musclesOf, syncCatalog, guideFor, CATEGORIES } from '../guides.js';
import { MUSCLES, MUSCLE_KEYS, cleanMuscles } from '../muscles.js';
import { esc, toast } from '../util.js';

const THEMES = [
  { key: 'auto', label: '端末に合わせる' },
  { key: 'light', label: 'ライト' },
  { key: 'dark', label: 'ダーク' },
];
const LOAD_TYPES = { weighted: '重量を扱う', bodyweight: '自重(加重は任意)', timed: '時間で測る(秒)' };
const MIN_TIMER = 5;
const MAX_TIMER = 3600;

export function mountSettings(root) {
  const dlg = document.getElementById('exercise-dialog');
  let editing = null; // 編集中の種目 { id|null, name, kind, bodyPart, loadType, archived }

  // ---- 画面 ----

  function exerciseRows() {
    return getState()
      .exercises.map((x) => {
        const g = guideFor(x);
        const sub = `${g ? `${CATEGORIES[g.category]} ・ ` : ''}${x.kind === 'run' ? '距離と時間' : LOAD_TYPES[x.loadType]}`;
        const tag = x.bodyPart ? `<span class="tag">${BODY_PARTS[x.bodyPart]}</span>` : '';
        return `<li><button type="button" class="entry ${x.archived ? 'archived' : ''}" data-action="edit-exercise" data-id="${x.id}">
          <span class="entry-main">
            <span class="entry-name">${esc(x.name)}${tag}</span>
            <span class="entry-sub">${sub}${x.archived ? ' ・ 非表示' : ''}</span>
          </span>
          <span class="chev">›</span>
        </button></li>`;
      })
      .join('');
  }

  function render() {
    const { settings, entries, bodyLogs } = getState();
    root.innerHTML = `
      <header class="page-head"><h1>設定</h1></header>

      <section class="card">
        <h2>表示</h2>
        <div class="segmented fill" role="group" aria-label="テーマ">
          ${THEMES.map(
            (t) =>
              `<button type="button" data-action="theme" data-key="${t.key}" aria-pressed="${t.key === settings.theme}">${t.label}</button>`,
          ).join('')}
        </div>
      </section>

      <section class="card">
        <h2>インターバルタイマー</h2>
        <p class="hint">60秒・90秒・120秒に加えて、自分の秒数を1つ追加できます。</p>
        <label class="field"><span>自分で設定する秒数(空欄で無し)</span>
          <input type="number" inputmode="numeric" step="1" min="${MIN_TIMER}" max="${MAX_TIMER}"
            data-field="timerCustomSec" value="${settings.timerCustomSec ?? ''}"></label>
        <p class="error" role="alert" data-timer-error hidden></p>
      </section>

      <section class="card">
        <h2>種目マスタ</h2>
        <ul class="entry-list">${exerciseRows()}</ul>
        <button type="button" class="btn-primary wide" data-action="add-exercise">＋ 種目を追加</button>
      </section>

      <section class="card">
        <h2>バックアップ</h2>
        <p class="hint">データはこの端末の中だけにあります。機種変更やサイトデータの削除に備えて、ときどき書き出してください。</p>
        <p class="hint">メニューの記録 ${entries.length}件 ・ 体の記録 ${bodyLogs.length}件 ・
          最終バックアップ ${settings.lastBackupAt ? formatDateJa(settings.lastBackupAt) : 'なし'}</p>
        <button type="button" class="btn-primary wide" data-action="export">バックアップを書き出す</button>
        <button type="button" class="btn-ghost wide" data-action="import">バックアップから復元する</button>
        <input type="file" accept="application/json,.json" data-field="import-file" hidden>
        <p class="error" role="alert" data-import-error hidden></p>
      </section>

      <section class="card">
        <h2>ホーム画面に追加</h2>
        <p class="hint">iPhone: Safari の共有ボタン →「ホーム画面に追加」</p>
        <p class="hint">Android: Chrome のメニュー →「アプリをインストール」または「ホーム画面に追加」</p>
        <p class="hint">追加すると、アプリのように全画面で開き、電波のない場所でも使えます。</p>
      </section>`;
  }

  // ---- バックアップ ----

  async function exportBackup() {
    const today = toDateStr(new Date());
    const name = `workout-backup-${today}.json`;
    const json = exportJson();
    const file = new File([json], name, { type: 'application/json' });
    let shared = false;
    // スマホでは共有シート(ファイルに保存など)を使う
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        shared = true;
      } catch (err) {
        if (err.name === 'AbortError') return; // 利用者がやめた
      }
    }
    if (!shared) {
      const url = URL.createObjectURL(file);
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    setSettings({ lastBackupAt: today });
    toast('バックアップを書き出しました');
    render();
  }

  async function importBackup(file) {
    const errorEl = root.querySelector('[data-import-error]');
    const { state, error } = parseBackup(await file.text(), toDateStr(new Date()));
    if (error) {
      errorEl.textContent = error;
      errorEl.hidden = false;
      return;
    }
    const ok = confirm(
      `今のデータをすべて置き換えます。\n\n復元する内容: メニューの記録 ${state.entries.length}件、体の記録 ${state.bodyLogs.length}件、種目 ${state.exercises.length}件\n\nよろしいですか？`,
    );
    if (!ok) return;
    replaceState(state);
    syncCatalog(); // 古いバックアップにも、今のカタログの種目を足す
    applyTheme();
    toast('バックアップから復元しました');
    render();
  }

  // ---- 種目の編集 ----

  function renderDialog() {
    const x = editing;
    const used = x.id ? exerciseInUse(x.id) : false;
    const lock = used ? 'disabled' : '';
    const opts = (map, cur) =>
      Object.entries(map)
        .map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v}</option>`)
        .join('');
    const scroll = dlg.querySelector('.sheet-body')?.scrollTop ?? 0;
    dlg.innerHTML = `<form class="sheet" novalidate>
      <header class="sheet-head">
        <button type="button" class="btn-ghost" data-action="close">閉じる</button>
        <h2>${x.id ? '種目の編集' : '種目の追加'}</h2>
        <button type="submit" class="btn-primary">保存</button>
      </header>
      <div class="sheet-body">
        <label class="field"><span>種目名</span>
          <input type="text" maxlength="40" data-ex="name" value="${esc(x.name)}"></label>
        <label class="field"><span>種類</span>
          <select data-ex="kind" ${lock}>${opts({ strength: '筋トレ', run: 'ランニング' }, x.kind)}</select></label>
        ${
          x.kind === 'strength'
            ? `<label class="field"><span>部位</span><select data-ex="bodyPart">${opts(BODY_PARTS, x.bodyPart)}</select></label>
               <label class="field"><span>記録のしかた</span><select data-ex="loadType" ${lock}>${opts(LOAD_TYPES, x.loadType)}</select></label>`
            : ''
        }
        <div class="field"><span>効く筋肉(タップで なし → メイン → サブ)</span>
          <div class="chip-picker">${MUSCLE_KEYS.map((k) => {
            const state = x.muscles.main.includes(k) ? 'main' : x.muscles.sub.includes(k) ? 'sub' : '';
            const mark = state === 'main' ? '<small>メイン</small>' : state === 'sub' ? '<small>サブ</small>' : '';
            return `<button type="button" class="chip ${state}" data-muscle="${k}" aria-pressed="${state !== ''}">${MUSCLES[k]}${mark}</button>`;
          }).join('')}</div>
        </div>
        ${used ? '<p class="hint">すでに記録があるため、種類と記録のしかたは変更できません。</p>' : ''}
        <p class="error" role="alert" hidden></p>
        ${
          !x.id
            ? ''
            : x.archived
              ? '<button type="button" class="btn-ghost wide" data-action="unarchive">もう一度表示する</button>'
              : used || x.guideId
                ? '<button type="button" class="btn-danger wide" data-action="archive">この種目を非表示にする</button><p class="hint">過去の記録は残り、新しく選べなくなります。</p>'
                : '<button type="button" class="btn-danger wide" data-action="delete">この種目を削除</button>'
        }
      </div>
    </form>`;
    dlg.querySelector('.sheet-body').scrollTop = scroll;
  }

  function openDialog(id) {
    editing = id
      ? { ...getExercise(id), muscles: musclesOf(getExercise(id)) }
      : { id: null, name: '', kind: 'strength', bodyPart: 'chest', loadType: 'weighted', archived: false, muscles: { main: [], sub: [] } };
    renderDialog();
    dlg.showModal();
  }

  function closeDialog() {
    dlg.close();
    editing = null;
    render();
  }

  const isLastActive = () => getState().exercises.filter((x) => !x.archived).length <= 1 && !editing.archived;

  function showDialogError(msg) {
    const el = dlg.querySelector('.error');
    el.textContent = msg;
    el.hidden = false;
  }

  dlg.addEventListener('input', (ev) => {
    if (ev.target.dataset.ex === 'name') editing.name = ev.target.value;
  });

  dlg.addEventListener('change', (ev) => {
    const key = ev.target.dataset.ex;
    if (!key || key === 'name') return;
    editing[key] = ev.target.value;
    if (key === 'kind') renderDialog();
  });

  dlg.addEventListener('click', (ev) => {
    const chip = ev.target.closest('[data-muscle]');
    if (chip) {
      // なし → メイン → サブ → なし
      const k = chip.dataset.muscle;
      const { main, sub } = editing.muscles;
      if (main.includes(k)) editing.muscles = { main: main.filter((m) => m !== k), sub: [...sub, k] };
      else if (sub.includes(k)) editing.muscles = { main, sub: sub.filter((m) => m !== k) };
      else editing.muscles = { main: [...main, k], sub };
      renderDialog();
      return;
    }
    const t = ev.target.closest('[data-action]');
    if (!t) return;
    switch (t.dataset.action) {
      case 'close':
        closeDialog();
        break;
      case 'archive':
      case 'delete':
        if (isLastActive()) return showDialogError('使える種目が1つもなくなるため、この操作はできません');
        if (t.dataset.action === 'delete') {
          if (!confirm(`「${editing.name}」を削除しますか？`)) return;
          deleteExercise(editing.id);
        } else {
          saveExercise({ ...getExercise(editing.id), archived: true });
        }
        closeDialog();
        break;
      case 'unarchive':
        saveExercise({ ...getExercise(editing.id), archived: false });
        closeDialog();
        break;
    }
  });

  dlg.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = editing.name.trim();
    if (!name) return showDialogError('種目名を入力してください');
    const run = editing.kind === 'run';
    // editing は元の種目を写したものなので、メモや自分で書いた解説もそのまま残る
    saveExercise({
      ...editing,
      name,
      bodyPart: run ? null : editing.bodyPart || 'chest',
      loadType: run ? null : editing.loadType || 'weighted',
      muscles: cleanMuscles(editing.muscles),
    });
    closeDialog();
  });

  dlg.addEventListener('cancel', () => {
    editing = null;
  });

  // ---- 設定画面の操作 ----

  root.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-action]');
    if (!t) return;
    switch (t.dataset.action) {
      case 'theme':
        setSettings({ theme: t.dataset.key });
        applyTheme();
        render();
        break;
      case 'add-exercise':
        openDialog(null);
        break;
      case 'edit-exercise':
        openDialog(t.dataset.id);
        break;
      case 'export':
        exportBackup();
        break;
      case 'import':
        root.querySelector('[data-field="import-file"]').click();
        break;
    }
  });

  root.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.field === 'import-file') {
      const file = t.files[0];
      t.value = '';
      if (file) importBackup(file);
    } else if (t.dataset.field === 'timerCustomSec') {
      const errorEl = root.querySelector('[data-timer-error]');
      const raw = t.value.trim();
      const v = raw === '' ? null : Number(raw);
      if (v !== null && !(Number.isInteger(v) && v >= MIN_TIMER && v <= MAX_TIMER)) {
        errorEl.textContent = `${MIN_TIMER}〜${MAX_TIMER}秒の整数で入力してください`;
        errorEl.hidden = false;
        return;
      }
      setSettings({ timerCustomSec: v });
      toast(v ? `タイマーに${v}秒を追加しました` : '自分で設定した秒数を外しました');
      render();
    }
  });

  return { render };
}
