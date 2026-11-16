// 自動メニュー作成のダイアログ: 画面の切り替えと、ボタンの受け付け。画面ごとの中身は program/ の中。
import { getState, getExercise, setProgram, makeId, removeProgramEntries } from '../data/store.js';
import { toDateStr } from '../logic/dates.js';
import { GOALS, generateProgram, describe } from '../logic/program.js';
import { toast } from '../ui/util.js';
import { ui, context } from './program/state.js';
import { NEXT_STATE, initialForm, toConfig, formHtml, mountMap } from './program/form.js';
import { previewHtml } from './program/preview.js';
import { plannedCount, computePlacement, placeHtml, applyPlacement, startPlacing } from './program/place.js';

// ---- 共通 ----

// 画面ごとのファイルから呼べるように登録する(関数宣言なので、ここに書いても下の定義が使われる)
ui.render = render;
ui.close = close;

function render(keepScroll = true) {
  const scroll = keepScroll ? ui.dlg.querySelector('.sheet-body')?.scrollTop ?? 0 : 0;
  ui.mannequin?.dispose();
  ui.mannequin = null;
  ui.dlg.innerHTML = ui.cur.mode === 'form' ? formHtml() : ui.cur.mode === 'place' ? placeHtml() : previewHtml();
  ui.dlg.querySelector('.sheet-body').scrollTop = scroll;
  if (ui.cur.mode === 'form' && ui.cur.f.showMap) mountMap();
}

function generate(seed) {
  const { config, error } = toConfig(ui.cur.f, seed);
  if (error) {
    ui.cur.f.error = error;
    return ui.render();
  }
  ui.cur.f.error = '';
  ui.cur.config = config;
  ui.cur.result = generateProgram(config, context());
  if (!ui.cur.result.templates.length) {
    ui.cur.f.error = 'この条件では入れられる種目がありません。器具・レベル・「鍛えない」の指定を見直してください';
    return ui.render();
  }
  ui.cur.mode = 'preview';
  ui.cur.week = 0;
  ui.cur.swapping = null;
  ui.render(false);
}

function close() {
  ui.mannequin?.dispose();
  ui.mannequin = null;
  const { onChange } = ui.cur;
  ui.dlg.close();
  ui.cur = null;
  onChange();
}

function setup() {
  ui.dlg = document.getElementById('program-dialog');

  ui.dlg.addEventListener('input', (ev) => {
    const key = ev.target.dataset.input;
    if (key) ui.cur.f[key] = ev.target.value;
  });

  ui.dlg.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.field === 'startDate' && t.value) {
      // 始める日を変えたら、全体を配置し直す
      ui.cur.place.startDate = t.value;
      computePlacement();
      ui.render();
    } else if (t.dataset.place) {
      // 1回ぶんを手で動かす。自動配置のときの注意書きは消し、重なりだけを確かめ直す
      const it = ui.cur.place.items[Number(t.dataset.place)];
      if (t.dataset.key === 'date' && !t.value) return;
      it[t.dataset.key] = t.value || null;
      it.warnings = [];
      ui.render();
    } else if (t.dataset.check === 'runOn') {
      ui.cur.f.runOn = t.checked;
      ui.render();
    } else if (t.dataset.check === 'separateRun') {
      ui.cur.f.separateRun = t.checked;
    }
  });

  ui.dlg.addEventListener('click', (ev) => {
    const f = ui.cur.f;
    const set = ev.target.closest('[data-set]');
    if (set) {
      const key = set.dataset.set;
      const numeric = ['perWeek', 'minutes', 'gymSessions', 'runPerWeek'].includes(key);
      f[key] = numeric ? Number(set.dataset.value) : set.dataset.value;
      return ui.render();
    }
    const part = ev.target.closest('[data-part]');
    if (part) {
      f.parts[part.dataset.part] = NEXT_STATE[f.parts[part.dataset.part]];
      return ui.render();
    }
    const equip = ev.target.closest('[data-equip]');
    if (equip) {
      const k = equip.dataset.equip;
      if (f.equipment.has(k)) f.equipment.delete(k);
      else f.equipment.add(k);
      return ui.render();
    }
    const exclude = ev.target.closest('[data-exclude]');
    if (exclude) {
      const id = exclude.dataset.exclude;
      if (f.excluded.has(id)) f.excluded.delete(id);
      else f.excluded.add(id);
      return ui.render();
    }
    const t = ev.target.closest('[data-action]');
    if (!t) return;
    switch (t.dataset.action) {
      case 'close':
        close();
        break;
      case 'toggle-map':
        f.showMap = !f.showMap;
        ui.render();
        break;
      case 'week':
        ui.cur.week += Number(t.dataset.dir);
        ui.cur.swapping = null;
        ui.render();
        break;
      case 'goto-week':
        ui.cur.week = Number(t.dataset.week);
        ui.cur.swapping = null;
        ui.render();
        break;
      case 'swap': {
        const key = `${t.dataset.t}:${t.dataset.i}`;
        ui.cur.swapping = ui.cur.swapping === key ? null : key;
        ui.render();
        break;
      }
      case 'swap-to': {
        // 種目を入れ替えて、週ごとの回数・重さと説明を作り直す
        ui.cur.result.templates[Number(t.dataset.t)].items[Number(t.dataset.i)].exerciseId = t.dataset.id;
        Object.assign(ui.cur.result, describe(ui.cur.result.templates, ui.cur.config, context()));
        ui.cur.swapping = null;
        toast(`${getExercise(t.dataset.id).name} に入れ替えました`);
        ui.render();
        break;
      }
      case 'regenerate':
        generate((ui.cur.config.seed || 0) + 1);
        break;
      case 'back':
        ui.cur.mode = 'form';
        ui.render(false);
        break;
      case 'save': {
        const c = ui.cur.config;
        const old = getState().program;
        const leftovers = old ? plannedCount(old.id) : 0;
        if (leftovers && !confirm(`前のプログラムからカレンダーに登録した未実施の予定 ${leftovers}件を消して、新しいプログラムに置き換えます。よろしいですか？`)) break;
        if (old) removeProgramEntries(old.id);
        setProgram({
          id: makeId('prog'),
          name: `${GOALS[c.goal]} ${c.weeks}週(週${ui.cur.result.templates.length}回)`,
          createdAt: toDateStr(new Date()),
          config: c,
          templates: ui.cur.result.templates,
          schedule: null,
        });
        toast('プログラムを保存しました。続けて日程に入れられます');
        startPlacing();
        break;
      }
      case 'delete': {
        const n = plannedCount(getState().program.id);
        if (!confirm(`保存したプログラムを削除しますか？${n ? `カレンダーに登録した未実施の予定 ${n}件も消えます。` : ''}(実施済みの記録は消えません)`)) break;
        removeProgramEntries(getState().program.id);
        setProgram(null);
        toast('プログラムを削除しました');
        close();
        break;
      }
      case 'place':
        startPlacing();
        break;
      case 'replace-auto':
        computePlacement();
        toast('自動で配置し直しました');
        ui.render();
        break;
      case 'apply':
        applyPlacement();
        break;
    }
  });

  ui.dlg.addEventListener('submit', (ev) => {
    ev.preventDefault();
    generate(ui.cur.config?.seed || 1);
  });

  ui.dlg.addEventListener('cancel', (ev) => {
    ev.preventDefault();
    close();
  });
}

// view: true なら、保存してあるプログラムの確認画面を開く。false なら入力画面から始める。
// place: true なら、保存してあるプログラムを日程に入れる画面を開く。
export function openProgram({ view = false, place = false, onChange }) {
  if (!ui.dlg) setup();
  const saved = getState().program;
  ui.cur = { mode: 'form', f: initialForm(), config: null, result: null, week: 0, swapping: null, viewing: false, onChange };
  if (view && saved) {
    // 保存した種目のうち、種目マスタから消えたものがあれば、その分は外して表示する
    const templates = saved.templates
      .map((t) => ({ ...t, items: t.items.filter((it) => getExercise(it.exerciseId)).map((it) => ({ ...it })) }))
      .filter((t) => t.items.length);
    ui.cur.config = saved.config;
    ui.cur.result = { templates, ...describe(templates, saved.config, context()) };
    ui.cur.mode = 'preview';
    ui.cur.viewing = true;
  }
  if (place && saved) {
    ui.dlg.showModal();
    return startPlacing();
  }
  ui.render(false);
  ui.dlg.showModal();
}
