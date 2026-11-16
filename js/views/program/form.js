// 自動メニュー作成: 入力画面(条件の入力と、筋肉マップでの重点部位の指定)。
import { getState, BODY_PARTS } from '../../data/store.js';
import { guideFor, groupByCategory, ownedEquipment, EQUIPMENT, LEVELS } from '../../data/guides.js';
import { MUSCLES } from '../../logic/muscles.js';
import { createMannequin } from '../../mannequin/index.js';
import { GOALS, TIMES_OF_DAY, MUSCLE_PART, autoLevel } from '../../logic/program.js';
import { esc, toast } from '../../ui/util.js';
import { ui } from './state.js';

const PART_STATES = { normal: '普通', focus: '重点', avoid: '鍛えない' };
export const NEXT_STATE = { normal: 'focus', focus: 'avoid', avoid: 'normal' };
const PART_COLORS = { focus: '#eb6834', avoid: '#77756a' };

// ---- 入力内容 ----

export function initialForm() {
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
    separateRun: p ? p.separateRun === true : true, // 新しく作るときは「分ける」が最初から入っている
    timeOfDay: p?.timeOfDay || 'any',
    showMap: false,
    error: '',
  };
}

export function toConfig(f, seed) {
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
      ...(f.runOn && f.separateRun ? { separateRun: true } : {}), // 任意。ランを筋トレと別の日にする
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

export function formHtml() {
  const f = ui.cur.f;
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
               <label class="field"><span>1回の距離の目安 (km)</span><input type="number" inputmode="decimal" min="0" step="0.5" data-input="runKm" value="${esc(f.runKm)}"></label>
               <label class="check"><input type="checkbox" data-check="separateRun" ${f.separateRun ? 'checked' : ''}><span>筋トレと同じ日にしない</span></label>
               <p class="hint">日程に入れるとき、ランは筋トレのない日に置きます。空いている日が足りない週だけ、同じ日の別の時間になります。</p>`
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
    const st = ui.cur.f.parts[part];
    if (st !== 'normal') colors[muscle] = PART_COLORS[st];
  }
  return colors;
}

export async function mountMap() {
  ui.mannequin?.dispose();
  ui.mannequin = null;
  const stage = ui.dlg.querySelector('[data-program-stage]');
  if (!stage) return;
  const view = await createMannequin(stage, {
    onSelect(muscle) {
      if (!muscle) return;
      const part = MUSCLE_PART[muscle];
      ui.cur.f.parts[part] = NEXT_STATE[ui.cur.f.parts[part]];
      // マネキンを作り直さずに、色と部位ボタンだけ更新する
      view.setColors(partColors());
      const chip = ui.dlg.querySelector(`[data-part="${part}"]`);
      chip.className = `chip part-${ui.cur.f.parts[part]}`;
      chip.querySelector('small').textContent = PART_STATES[ui.cur.f.parts[part]];
      toast(`${MUSCLES[muscle]} → ${BODY_PARTS[part]}: ${PART_STATES[ui.cur.f.parts[part]]}`);
    },
  });
  if (ui.cur?.mode !== 'form' || !stage.isConnected) return view.dispose();
  ui.mannequin = view;
  view.setColors(partColors());
}
