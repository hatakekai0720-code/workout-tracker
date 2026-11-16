// 自動メニュー作成: 入力画面と、できたプログラムの確認画面。
import { getState, getExercise, setProgram, makeId, BODY_PARTS } from '../store.js';
import { toDateStr } from '../calc.js';
import { guideFor, groupByCategory, ownedEquipment, EQUIPMENT, LEVELS } from '../guides.js';
import { MUSCLES } from '../muscles.js';
import { createMannequin } from '../mannequin/index.js';
import { GOALS, TIMES_OF_DAY, MUSCLE_PART, ALL_EQUIPMENT, generateProgram, describe, swapOptions, autoLevel } from '../program.js';
import { esc, toast } from '../util.js';

const PART_STATES = { normal: '普通', focus: '重点', avoid: '鍛えない' };
const NEXT_STATE = { normal: 'focus', focus: 'avoid', avoid: 'normal' };
const PART_COLORS = { focus: '#eb6834', avoid: '#77756a' };

let dlg = null;
let cur = null; // { mode: 'form' | 'preview', f: 入力内容, config, result, week, swapping, onChange }
let mannequin = null;

const context = () => {
  const s = getState();
  return { exercises: s.exercises, guideFor, entries: s.entries, weightStepKg: s.settings.weightStepKg, today: toDateStr(new Date()) };
};

// ---- 入力内容 ----

function initialForm() {
  const p = getState().program?.config;
  const parts = Object.fromEntries(Object.keys(BODY_PARTS).map((k) => [k, p?.focus.includes(k) ? 'focus' : p?.avoid.includes(k) ? 'avoid' : 'normal']));
  return {
    goal: p?.goal || 'hypertrophy',
    weeksChoice: p ? ([4, 8, 12].includes(p.weeks) ? String(p.weeks) : 'custom') : '8',
    weeksCustom: p ? String(p.weeks) : '6',
    perWeek: p?.perWeek || 3,
    minutes: p?.minutes || 60,
    levelChoice: 'auto',
    parts,
    equipment: new Set(p?.equipment || ownedEquipment() || []),
    gymSessions: p?.gymSessions || 0,
    excluded: new Set(p?.excluded || []),
    runOn: (p?.run.perWeek || 0) > 0,
    runPerWeek: p?.run.perWeek || 2,
    runKm: String(p?.run.km || 3),
    timeOfDay: p?.timeOfDay || 'any',
    showMap: false,
    error: '',
  };
}

function toConfig(f, seed) {
  const weeks = f.weeksChoice === 'custom' ? Number(f.weeksCustom) : Number(f.weeksChoice);
  if (!(Number.isInteger(weeks) && weeks >= 1 && weeks <= 52)) return { error: '期間は1〜52週で入力してください' };
  const km = Number(f.runKm);
  if (f.runOn && !(km > 0 && km <= 100)) return { error: 'ランニングの距離を入力してください' };
  const { exercises, entries } = getState();
  return {
    config: {
      goal: f.goal,
      focus: Object.keys(f.parts).filter((k) => f.parts[k] === 'focus'),
      avoid: Object.keys(f.parts).filter((k) => f.parts[k] === 'avoid'),
      weeks,
      perWeek: f.perWeek,
      minutes: f.minutes,
      equipment: [...f.equipment],
      gymSessions: Math.min(f.gymSessions, f.perWeek),
      level: f.levelChoice === 'auto' ? autoLevel(entries, exercises).level : f.levelChoice,
      excluded: [...f.excluded],
      run: { perWeek: f.runOn ? f.runPerWeek : 0, km: f.runOn ? km : 0 },
      timeOfDay: f.timeOfDay,
      seed,
    },
  };
}

// ---- 入力画面 ----

// 1つだけ選ぶボタンの並び
const choice = (key, options, value) =>
  `<div class="chip-picker">${options
    .map(([v, label]) => `<button type="button" class="chip ${String(v) === String(value) ? 'own' : ''}" data-set="${key}" data-value="${v}" aria-pressed="${String(v) === String(value)}">${label}</button>`)
    .join('')}</div>`;

function formHtml() {
  const f = cur.f;
  const { exercises, entries } = getState();
  const auto = autoLevel(entries, exercises);
  const catalogExercises = exercises.filter((x) => !x.archived && x.kind === 'strength' && guideFor(x));
  const partChip = (k) => {
    const st = f.parts[k];
    return `<button type="button" class="chip part-${st}" data-part="${k}" aria-label="${BODY_PARTS[k]}: ${PART_STATES[st]}">${BODY_PARTS[k]}<small>${PART_STATES[st]}</small></button>`;
  };
  return `<form class="sheet" novalidate>
    <header class="sheet-head">
      <button type="button" class="btn-ghost" data-action="close">閉じる</button>
      <h2>メニューを自動で作る</h2>
      <button type="submit" class="btn-primary">作成</button>
    </header>
    <div class="sheet-body">
      <section class="group"><h3>目的</h3>${choice('goal', Object.entries(GOALS), f.goal)}</section>

      <section class="group"><h3>期間と回数</h3>
        <div class="field"><span>期間</span>${choice('weeksChoice', [['4', '4週'], ['8', '8週'], ['12', '12週'], ['custom', '自由入力']], f.weeksChoice)}</div>
        ${f.weeksChoice === 'custom' ? `<label class="field"><span>週数(1〜52)</span><input type="number" inputmode="numeric" min="1" max="52" step="1" data-input="weeksCustom" value="${esc(f.weeksCustom)}"></label>` : ''}
        <div class="field"><span>週の回数</span>${choice('perWeek', [1, 2, 3, 4, 5, 6].map((n) => [n, `${n}回`]), f.perWeek)}</div>
        <div class="field"><span>1回あたりの時間</span>${choice('minutes', [30, 45, 60, 90].map((n) => [n, `${n}分`]), f.minutes)}</div>
      </section>

      <section class="group"><h3>レベル</h3>
        ${choice('levelChoice', [['auto', `自動(${LEVELS[auto.level]})`], ...Object.entries(LEVELS)], f.levelChoice)}
        <p class="hint after">自動判定: 筋トレの記録がある週が ${auto.weeks} 週 → ${LEVELS[auto.level]}(12週未満は初級、1年未満は中級)。レベルより難しい種目は入りません。</p>
      </section>

      <section class="group"><h3>部位</h3>
        <p class="hint">タップで「普通 → 重点 → 鍛えない」と切り替わります。</p>
        <div class="chip-picker">${Object.keys(BODY_PARTS).map(partChip).join('')}</div>
        <button type="button" class="btn-ghost wide" data-action="toggle-map">${f.showMap ? '筋肉マップを閉じる' : '筋肉マップから選ぶ'}</button>
        ${f.showMap ? '<div class="mq-stage small" data-program-stage><p class="empty">読み込み中…</p></div><p class="hint">筋肉をタップすると、その部位が切り替わります。</p>' : ''}
      </section>

      <section class="group"><h3>使える器具</h3>
        <p class="hint">自宅で使える器具を選びます(「持っている器具」の設定が最初に入っています)。自重の種目は常に使えます。</p>
        <div class="chip-picker">${Object.entries(EQUIPMENT)
          .map(([k, label]) => `<button type="button" class="chip ${f.equipment.has(k) ? 'own' : ''}" data-equip="${k}" aria-pressed="${f.equipment.has(k)}">${f.equipment.has(k) ? '✓ ' : ''}${label}</button>`)
          .join('')}</div>
        <div class="field"><span>週のうちジムに行く回数(その回だけ、ジムの器具をすべて使います)</span>
          ${choice('gymSessions', Array.from({ length: f.perWeek + 1 }, (_, n) => [n, n === 0 ? '行かない' : `${n}回`]), Math.min(f.gymSessions, f.perWeek))}</div>
      </section>

      <section class="group"><h3>除外したい種目</h3>
        <details ${f.excluded.size ? 'open' : ''}><summary>苦手な種目・痛みが出る種目を選ぶ(${f.excluded.size}件)</summary>
          ${groupByCategory(catalogExercises)
            .map(
              (g) => `<h4>${g.label}</h4><div class="chip-picker">${g.items
                .map((x) => `<button type="button" class="chip ${f.excluded.has(x.id) ? 'part-avoid' : ''}" data-exclude="${x.id}" aria-pressed="${f.excluded.has(x.id)}">${f.excluded.has(x.id) ? '✕ ' : ''}${esc(x.name)}</button>`)
                .join('')}</div>`,
            )
            .join('')}
        </details>
      </section>

      <section class="group"><h3>ランニング</h3>
        <label class="check"><input type="checkbox" data-check="runOn" ${f.runOn ? 'checked' : ''}><span>ランニングも入れる</span></label>
        ${
          f.runOn
            ? `<div class="field"><span>週の回数</span>${choice('runPerWeek', [1, 2, 3, 4, 5, 6].map((n) => [n, `${n}回`]), f.runPerWeek)}</div>
               <label class="field"><span>1回の距離の目安 (km)</span><input type="number" inputmode="decimal" min="0" step="0.5" data-input="runKm" value="${esc(f.runKm)}"></label>`
            : ''
        }
      </section>

      <section class="group"><h3>希望の時間帯</h3>${choice('timeOfDay', Object.entries(TIMES_OF_DAY), f.timeOfDay)}</section>

      <p class="error" role="alert" ${f.error ? '' : 'hidden'}>${esc(f.error)}</p>
      <button type="submit" class="btn-primary wide">この内容でメニューを作成</button>
      <p class="hint after">ルールに沿って自動で組み立てます。痛みや持病があるときは、無理をせず医師に相談してください。</p>
    </div>
  </form>`;
}

// 入力画面の筋肉マップ: 重点はオレンジ、鍛えないは濃い灰色
function partColors() {
  const colors = {};
  for (const [muscle, part] of Object.entries(MUSCLE_PART)) {
    const st = cur.f.parts[part];
    if (st !== 'normal') colors[muscle] = PART_COLORS[st];
  }
  return colors;
}

async function mountMap() {
  mannequin?.dispose();
  mannequin = null;
  const stage = dlg.querySelector('[data-program-stage]');
  if (!stage) return;
  const view = await createMannequin(stage, {
    onSelect(muscle) {
      if (!muscle) return;
      const part = MUSCLE_PART[muscle];
      cur.f.parts[part] = NEXT_STATE[cur.f.parts[part]];
      // マネキンを作り直さずに、色と部位ボタンだけ更新する
      view.setColors(partColors());
      const chip = dlg.querySelector(`[data-part="${part}"]`);
      chip.className = `chip part-${cur.f.parts[part]}`;
      chip.querySelector('small').textContent = PART_STATES[cur.f.parts[part]];
      toast(`${MUSCLES[muscle]} → ${BODY_PARTS[part]}: ${PART_STATES[cur.f.parts[part]]}`);
    },
  });
  if (cur?.mode !== 'form' || !stage.isConnected) return view.dispose();
  mannequin = view;
  view.setColors(partColors());
}

// ---- 確認画面 ----

const fmtKg = (n) => `${Math.round(n * 10) / 10}kg`;

function itemHtml(t, tIndex, it, iIndex, weekItem) {
  const ex = getExercise(it.exerciseId);
  const g = guideFor(ex);
  const weight = ex.loadType !== 'weighted' ? '' : weekItem.weightKg === null ? ' ・ 重さは初回に決める' : ` ・ ${fmtKg(weekItem.weightKg)}`;
  const swapping = cur.swapping === `${tIndex}:${iIndex}`;
  const options = swapping ? swapOptions(cur.result.templates, tIndex, iIndex, cur.config, context()) : [];
  return `<li class="prog-item">
    <div class="prog-main">
      <span class="entry-name">${esc(ex.name)}${ex.bodyPart ? `<span class="tag">${BODY_PARTS[ex.bodyPart]}</span>` : ''}</span>
      <span class="entry-sub">${weekItem.sets}セット × ${weekItem.reps}${weekItem.unit}${weight} ・ 休憩${weekItem.restSec}秒${g?.compound ? '' : ' ・ 単関節'}</span>
    </div>
    <button type="button" class="btn-ghost" data-action="swap" data-t="${tIndex}" data-i="${iIndex}">${swapping ? 'やめる' : '入れ替え'}</button>
    ${
      swapping
        ? `<div class="prog-swap">${
            options.length
              ? options.map((x) => `<button type="button" class="chip link" data-action="swap-to" data-t="${tIndex}" data-i="${iIndex}" data-id="${x.id}">${esc(x.name)}</button>`).join('')
              : '<span class="entry-sub">同じ部位で入れ替えられる種目がありません</span>'
          }</div>`
        : ''
    }
  </li>`;
}

function previewHtml() {
  const { result, config } = cur;
  const week = result.weeks[cur.week];
  const saved = getState().program;
  const summary = `${GOALS[config.goal]} ・ ${config.weeks}週 ・ 週${result.templates.length}回 ・ ${config.minutes}分 ・ ${LEVELS[config.level]}`;
  return `<div class="sheet">
    <header class="sheet-head">
      <button type="button" class="btn-ghost" data-action="close">閉じる</button>
      <h2>プログラムの確認</h2>
      <button type="button" class="btn-primary" data-action="save">保存</button>
    </header>
    <div class="sheet-body">
      <p class="prev"><b>内容</b>${summary}</p>
      <section class="group"><h3>なぜこのメニューか</h3>
        <ul class="bullets">${result.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      </section>

      <div class="week-nav">
        <button type="button" class="icon-btn" data-action="week" data-dir="-1" ${cur.week === 0 ? 'disabled' : ''} aria-label="前の週">‹</button>
        <b>第${cur.week + 1}週 / ${config.weeks}週${week.deload ? '<span class="tag deload">軽めの週</span>' : ''}</b>
        <button type="button" class="icon-btn" data-action="week" data-dir="1" ${cur.week === config.weeks - 1 ? 'disabled' : ''} aria-label="次の週">›</button>
      </div>
      <div class="week-strip" aria-label="週の一覧">${result.weeks
        .map((w) => `<button type="button" class="${w.index === cur.week ? 'on' : ''} ${w.deload ? 'deload' : ''}" data-action="goto-week" data-week="${w.index}" aria-label="第${w.index + 1}週${w.deload ? '(軽めの週)' : ''}">${w.index + 1}</button>`)
        .join('')}</div>

      ${week.sessions
        .map(
          (s, tIndex) => `<section class="group prog-session">
            <h3>${tIndex + 1}回目 ${esc(s.label)}${s.gym ? '<span class="tag">ジム</span>' : ''}<small>約${s.minutes}分</small></h3>
            <ul class="prog-list">${result.templates[tIndex].items.map((it, iIndex) => itemHtml(result.templates[tIndex], tIndex, it, iIndex, s.items[iIndex])).join('')}</ul>
          </section>`,
        )
        .join('')}
      ${week.runs.length ? `<section class="group"><h3>ランニング</h3><p>週 ${week.runs.length} 回 ・ 1回 ${week.runs[0]}km</p></section>` : ''}

      <button type="button" class="btn-ghost wide" data-action="regenerate">作り直す(別の種目の組み合わせ)</button>
      <button type="button" class="btn-ghost wide" data-action="back">入力内容を変える</button>
      <button type="button" class="btn-primary wide" data-action="save">${saved ? 'このプログラムに置き換えて保存' : 'このプログラムを保存'}</button>
      ${saved && cur.viewing ? '<button type="button" class="btn-danger wide" data-action="delete">保存したプログラムを削除</button>' : ''}
    </div>
  </div>`;
}

// ---- 共通 ----

function render(keepScroll = true) {
  const scroll = keepScroll ? dlg.querySelector('.sheet-body')?.scrollTop ?? 0 : 0;
  mannequin?.dispose();
  mannequin = null;
  dlg.innerHTML = cur.mode === 'form' ? formHtml() : previewHtml();
  dlg.querySelector('.sheet-body').scrollTop = scroll;
  if (cur.mode === 'form' && cur.f.showMap) mountMap();
}

function generate(seed) {
  const { config, error } = toConfig(cur.f, seed);
  if (error) {
    cur.f.error = error;
    return render();
  }
  cur.f.error = '';
  cur.config = config;
  cur.result = generateProgram(config, context());
  if (!cur.result.templates.length) {
    cur.f.error = 'この条件では入れられる種目がありません。器具・レベル・「鍛えない」の指定を見直してください';
    return render();
  }
  cur.mode = 'preview';
  cur.week = 0;
  cur.swapping = null;
  render(false);
}

function close() {
  mannequin?.dispose();
  mannequin = null;
  const { onChange } = cur;
  dlg.close();
  cur = null;
  onChange();
}

function setup() {
  dlg = document.getElementById('program-dialog');

  dlg.addEventListener('input', (ev) => {
    const key = ev.target.dataset.input;
    if (key) cur.f[key] = ev.target.value;
  });

  dlg.addEventListener('change', (ev) => {
    if (ev.target.dataset.check !== 'runOn') return;
    cur.f.runOn = ev.target.checked;
    render();
  });

  dlg.addEventListener('click', (ev) => {
    const f = cur.f;
    const set = ev.target.closest('[data-set]');
    if (set) {
      const key = set.dataset.set;
      const numeric = ['perWeek', 'minutes', 'gymSessions', 'runPerWeek'].includes(key);
      f[key] = numeric ? Number(set.dataset.value) : set.dataset.value;
      return render();
    }
    const part = ev.target.closest('[data-part]');
    if (part) {
      f.parts[part.dataset.part] = NEXT_STATE[f.parts[part.dataset.part]];
      return render();
    }
    const equip = ev.target.closest('[data-equip]');
    if (equip) {
      const k = equip.dataset.equip;
      if (f.equipment.has(k)) f.equipment.delete(k);
      else f.equipment.add(k);
      return render();
    }
    const exclude = ev.target.closest('[data-exclude]');
    if (exclude) {
      const id = exclude.dataset.exclude;
      if (f.excluded.has(id)) f.excluded.delete(id);
      else f.excluded.add(id);
      return render();
    }
    const t = ev.target.closest('[data-action]');
    if (!t) return;
    switch (t.dataset.action) {
      case 'close':
        close();
        break;
      case 'toggle-map':
        f.showMap = !f.showMap;
        render();
        break;
      case 'week':
        cur.week += Number(t.dataset.dir);
        cur.swapping = null;
        render();
        break;
      case 'goto-week':
        cur.week = Number(t.dataset.week);
        cur.swapping = null;
        render();
        break;
      case 'swap': {
        const key = `${t.dataset.t}:${t.dataset.i}`;
        cur.swapping = cur.swapping === key ? null : key;
        render();
        break;
      }
      case 'swap-to': {
        // 種目を入れ替えて、週ごとの回数・重さと説明を作り直す
        cur.result.templates[Number(t.dataset.t)].items[Number(t.dataset.i)].exerciseId = t.dataset.id;
        Object.assign(cur.result, describe(cur.result.templates, cur.config, context()));
        cur.swapping = null;
        toast(`${getExercise(t.dataset.id).name} に入れ替えました`);
        render();
        break;
      }
      case 'regenerate':
        generate((cur.config.seed || 0) + 1);
        break;
      case 'back':
        cur.mode = 'form';
        render(false);
        break;
      case 'save': {
        const c = cur.config;
        setProgram({
          id: makeId('prog'),
          name: `${GOALS[c.goal]} ${c.weeks}週(週${cur.result.templates.length}回)`,
          createdAt: toDateStr(new Date()),
          config: c,
          templates: cur.result.templates,
        });
        toast('プログラムを保存しました');
        close();
        break;
      }
      case 'delete':
        if (!confirm('保存したプログラムを削除しますか？(これまでの記録は消えません)')) break;
        setProgram(null);
        toast('プログラムを削除しました');
        close();
        break;
    }
  });

  dlg.addEventListener('submit', (ev) => {
    ev.preventDefault();
    generate(cur.config?.seed || 1);
  });

  dlg.addEventListener('cancel', (ev) => {
    ev.preventDefault();
    close();
  });
}

// view: true なら、保存してあるプログラムの確認画面を開く。false なら入力画面から始める。
export function openProgram({ view = false, onChange }) {
  if (!dlg) setup();
  const saved = getState().program;
  cur = { mode: 'form', f: initialForm(), config: null, result: null, week: 0, swapping: null, viewing: false, onChange };
  if (view && saved) {
    // 保存した種目のうち、種目マスタから消えたものがあれば、その分は外して表示する
    const templates = saved.templates
      .map((t) => ({ ...t, items: t.items.filter((it) => getExercise(it.exerciseId)).map((it) => ({ ...it })) }))
      .filter((t) => t.items.length);
    cur.config = saved.config;
    cur.result = { templates, ...describe(templates, saved.config, context()) };
    cur.mode = 'preview';
    cur.viewing = true;
  }
  render(false);
  dlg.showModal();
}
