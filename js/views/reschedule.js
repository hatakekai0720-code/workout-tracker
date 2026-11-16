// サボった日の振り替え: 起動時の自動振り替えと、ホームのバナー(元に戻す・休んだ・スキップ・再開プラン)。
// 計画は js/logic/reschedule.js、元に戻すための記録は js/data/reschedule-log.js。
import { getState, getExercise, applySessionMoves, markSkipped, adjustPlans, restorePlans } from '../data/store.js';
import { loadLog, saveLog } from '../data/reschedule-log.js';
import {
  findMissed, daysSinceMissed, planReschedule, restartShift, restartWindow, lightenPlan, nextSessionEntries,
  RESTART_DAYS, RETURN_LIGHT, RESTART_LIGHT,
} from '../logic/reschedule.js';
import { toDateStr, formatShortDate } from '../logic/dates.js';
import { WEEKDAYS, weekdayOf } from '../logic/schedule.js';
import { esc, toast } from '../ui/util.js';

const day = (d) => `${formatShortDate(d)}(${WEEKDAYS[weekdayOf(d)]})`;
const when = (d, t) => `${day(d)}${t ? ` ${t}` : ''}`;

function ctx() {
  const s = getState();
  const now = new Date();
  const partsOf = new Map(s.exercises.filter((x) => x.kind === 'strength').map((x) => [x.id, x.bodyPart]));
  const today = toDateStr(now);
  const programId = s.program?.id || null;
  const log = loadLog();
  const missed = findMissed(s.entries, today, programId, partsOf);
  // もう未実施でない回は、動かさない一覧から外す
  const keys = new Set(missed.map((m) => m.key));
  log.hold = log.hold.filter((k) => keys.has(k));
  return { s, today, nowMin: now.getHours() * 60 + now.getMinutes(), partsOf, programId, log, missed, hold: new Set(log.hold) };
}

// 振り替えを計画して保存する。held は動かさない過去の回。返り値: 動かした回の数
function run(c, mode, { held = c.hold, shiftDays = 0 } = {}) {
  const { s } = c;
  const { moves } = planReschedule({
    entries: s.entries, events: s.events, settings: s.settings, programId: c.programId, partsOf: c.partsOf, today: c.today, nowMin: c.nowMin,
    timeOfDay: s.program?.config?.timeOfDay || 'any', separateRun: s.program?.config?.separateRun === true, held, shiftDays,
  });
  if (!moves.length) return 0;
  applySessionMoves(moves);
  let adjusted = [];
  if (mode === 'restart') {
    const keys = restartWindow(moves, c.today);
    const targets = getState().entries.filter((e) => e.status === 'planned' && keys.has(`${e.sessionKey}|${e.date}`));
    adjusted = lighten(targets, RESTART_LIGHT, 'restart');
  }
  c.log.last = { at: Date.now(), mode, moves, adjusted, choices: {}, dismissed: false };
  saveLog(c.log);
  return moves.length;
}

function lighten(entries, rule, reason) {
  const step = getState().settings.weightStepKg;
  const changes = entries.filter((e) => !e.basePlan).map((e) => ({ id: e.id, plan: lightenPlan(getExercise(e.exerciseId), e.plan, rule, step) }));
  return changes.length ? adjustPlans(changes, reason) : [];
}

// 休んだあとの1回目(今日以降でいちばん早い予定)を軽くする
function lightenNext(c) {
  const ids = lighten(nextSessionEntries(getState().entries, c.today), RETURN_LIGHT, 'return');
  if (c.log.last) c.log.last.adjusted = [...c.log.last.adjusted, ...ids];
  return ids.length;
}

// 直近の振り替えを元に戻す。戻した過去の回は、自動では動かさない一覧に入れる。
function undo(c, { hold = true } = {}) {
  const last = c.log.last;
  if (!last) return;
  applySessionMoves(
    last.moves.slice().reverse().map((m) => ({ sessionKey: m.sessionKey, fromDate: m.toDate, toDate: m.fromDate, toTime: m.fromTime, durationMin: m.fromDuration })),
  );
  restorePlans(last.adjusted);
  if (hold) c.log.hold = [...new Set([...c.log.hold, ...last.moves.filter((m) => m.fromDate < c.today).map((m) => m.key)])];
  c.log.last = null;
  saveLog(c.log);
}

const pendingProgram = (c) => c.missed.filter((m) => m.program && !c.hold.has(m.key));

// 起動時・ホームを開いたときに呼ぶ。自動の設定なら、未実施の回を振り替える(7日以上空いていたら動かさない)。
// 返り値: 動かした回の数
export function checkMissed() {
  const c = ctx();
  saveLog(c.log);
  if (c.s.settings.autoReschedule === 'manual') return 0;
  const pending = pendingProgram(c);
  if (!pending.length || daysSinceMissed(pending, c.today) >= RESTART_DAYS) return 0;
  return run(c, 'auto');
}

// ---- バナー ----

function rowLabel(m) {
  if (m.label) return m.label;
  const names = getState().entries.filter((e) => m.entryIds?.includes(e.id)).map((e) => getExercise(e.exerciseId)?.name).filter(Boolean);
  return names.length ? names.slice(0, 3).join('・') + (names.length > 3 ? ' ほか' : '') : '予定';
}

function choiceButtons(key, { move = false, chosen = null } = {}) {
  if (chosen === 'sick') return '<span class="rs-chosen">休んだ ✓(次の1回は軽め)</span>';
  return `<span class="rs-btns">
      ${move ? `<button type="button" class="btn-ghost" data-action="rs-move" data-key="${esc(key)}">振り替える</button>` : ''}
      <button type="button" class="btn-ghost" data-action="rs-sick" data-key="${esc(key)}">休んだ</button>
      <button type="button" class="btn-ghost" data-action="rs-skip" data-key="${esc(key)}">スキップ</button>
    </span>`;
}

export function rescheduleBannerHtml() {
  const c = ctx();
  const parts = [];
  const auto = c.s.settings.autoReschedule !== 'manual';
  const pending = pendingProgram(c);
  const restart = pending.length && daysSinceMissed(pending, c.today) >= RESTART_DAYS;

  if (restart) {
    parts.push(`<div class="rs-box">
      <p class="rs-title">📅 予定から${daysSinceMissed(pending, c.today)}日空きました</p>
      <p class="hint">未実施のプログラム ${pending.length}回は、自動では動かしていません。再開プランを作ると、残りの予定を今日からの日程にまとめてずらし、最初の1週間は軽め(重さ8割・セット−1)にします。</p>
      <button type="button" class="btn-primary wide" data-action="rs-restart">再開プランを作る</button>
      <button type="button" class="btn-ghost wide" data-action="rs-restart-no">今回はしない(予定はそのまま)</button>
    </div>`);
  }

  const last = c.log.last;
  if (last && !last.dismissed) {
    const past = last.moves.filter((m) => m.fromDate < c.today);
    const pushed = last.moves.length - past.length;
    const title = last.mode === 'restart' ? `再開プランを作りました(${last.moves.length}回を移動)` : `未実施の${past.length}回を振り替えました`;
    parts.push(`<div class="rs-box">
      <p class="rs-title">🔁 ${title}</p>
      <ul class="rs-list">${(last.mode === 'restart' ? last.moves.slice(0, 5) : past)
        .map((m) => `<li><span class="rs-what"><b>${esc(m.label || 'プログラム')}</b>
            <span>${when(m.fromDate, m.fromTime)} → <b>${when(m.toDate, m.toTime)}</b></span>
            ${m.warnings.length ? `<span class="rs-warn">⚠ ${esc(m.warnings.join('。'))}</span>` : ''}</span>
            ${last.mode === 'restart' ? '' : choiceButtons(m.key, { chosen: last.choices[m.key] })}</li>`)
        .join('')}</ul>
      ${last.mode === 'restart' && last.moves.length > 5 ? `<p class="hint">ほか ${last.moves.length - 5}回も同じだけずらしています。</p>` : ''}
      ${last.mode !== 'restart' && pushed ? `<p class="hint">順番を保つため、後ろの予定 ${pushed}回も後ろにずらしました。</p>` : ''}
      ${last.mode !== 'restart' ? '<p class="hint">「休んだ」は体調不良などで休んだとき(継続日数は途切れず、次の1回を少し軽めにします)。「スキップ」はその回をやらずに飛ばします。</p>' : ''}
      <div class="wo-row">
        <button type="button" class="btn-ghost" data-action="rs-undo">元に戻す</button>
        <button type="button" class="btn-ghost" data-action="rs-dismiss">閉じる</button>
      </div>
    </div>`);
  }

  // 自動で動かさなかった未実施の予定(手で入れた予定・一部だけやった回・元に戻した回・手動の設定)
  const rest = c.missed.filter((m) => !(m.program && !c.hold.has(m.key) && (auto || restart)));
  if (rest.length) {
    parts.push(`<div class="rs-box">
      <p class="rs-title">📋 未実施の予定が${rest.length}件あります</p>
      <ul class="rs-list">${rest
        .map((m) => `<li><span class="rs-what"><b>${esc(rowLabel(m))}</b><span>${when(m.date, m.time)}${m.partial ? ' ・ 一部だけ実施' : ''}</span></span>
          ${choiceButtons(m.key, { move: m.program })}</li>`)
        .join('')}</ul>
      ${!auto && rest.filter((m) => m.program).length > 1 ? '<button type="button" class="btn-primary wide" data-action="rs-move-all">プログラムの予定をまとめて振り替える</button>' : ''}
    </div>`);
  }
  return parts.length ? `<section class="card reschedule">${parts.join('')}</section>` : '';
}

// バナーのボタン。処理したら true(呼び出し側で描き直す)。
export function handleRescheduleAction(t) {
  const action = t.dataset.action;
  if (!action?.startsWith('rs-')) return false;
  const c = ctx();
  const key = t.dataset.key;
  const last = c.log.last;
  const inLast = last && last.moves.some((m) => m.key === key && m.fromDate < c.today);
  const row = c.missed.find((m) => m.key === key);
  switch (action) {
    case 'rs-undo':
      undo(c);
      toast('振り替えを元に戻しました');
      break;
    case 'rs-dismiss':
      if (last) last.dismissed = true;
      saveLog(c.log);
      break;
    case 'rs-restart': {
      const pending = pendingProgram(c);
      const n = run(c, 'restart', { shiftDays: restartShift(pending, c.today) });
      toast(n ? '再開プランを作りました' : '動かせる予定がありませんでした');
      break;
    }
    case 'rs-restart-no':
      c.log.hold = [...new Set([...c.log.hold, ...pendingProgram(c).map((m) => m.key)])];
      saveLog(c.log);
      break;
    case 'rs-move':
    case 'rs-move-all': {
      // 指定した回(まとめての場合は、動かさない一覧以外のすべて)だけを動かす
      const held = new Set(c.missed.filter((m) => (action === 'rs-move' ? m.key !== key : c.hold.has(m.key))).map((m) => m.key));
      c.log.hold = c.log.hold.filter((k) => !(action === 'rs-move' ? k === key : false));
      const n = run(c, 'manual', { held });
      toast(n ? '振り替えました' : '空き時間が見つかりませんでした');
      break;
    }
    case 'rs-sick':
      if (inLast) {
        last.choices[key] = 'sick';
        lightenNext(c);
        saveLog(c.log);
      } else if (row?.program) {
        // 振り替えてから、次の1回を軽くする
        const held = new Set(c.missed.filter((m) => m.key !== key).map((m) => m.key));
        c.log.hold = c.log.hold.filter((k) => k !== key);
        run(c, 'manual', { held });
        if (c.log.last) c.log.last.choices[key] = 'sick';
        lightenNext(c);
        saveLog(c.log);
      } else if (row) {
        markSkipped(row.entryIds, 'sick');
        lightenNext(c);
        saveLog(c.log);
      }
      toast('休んだ日にしました。次の1回は少し軽めにします');
      break;
    case 'rs-skip':
      if (inLast) {
        // いったん元に戻してその回をスキップにし、残りを振り替え直す(「休んだ」の選択は引き継ぐ)
        const { choices, mode, moves } = last;
        undo(c, { hold: false });
        const r = ctx().missed.find((m) => m.key === key);
        if (r) markSkipped(r.entryIds, 'skip');
        const c2 = ctx();
        // 手動で振り替えた回だけを振り替え直す(それ以外の未実施の回は動かさない)
        const moved = new Set(moves.map((m) => m.key));
        const held = mode === 'manual' ? new Set([...c2.hold, ...c2.missed.filter((m) => !moved.has(m.key)).map((m) => m.key)]) : c2.hold;
        run(c2, mode === 'manual' ? 'manual' : 'auto', { held });
        if (c2.log.last) {
          for (const [k, v] of Object.entries(choices)) if (k !== key && c2.log.last.moves.some((m) => m.key === k)) c2.log.last.choices[k] = v;
          if (Object.values(c2.log.last.choices).includes('sick')) lightenNext(c2);
          saveLog(c2.log);
        }
      } else if (row) {
        markSkipped(row.entryIds, 'skip');
        c.log.hold = c.log.hold.filter((k) => k !== key);
        saveLog(c.log);
      }
      toast('スキップにしました');
      break;
    default:
      return false;
  }
  return true;
}
