// 純粋な計算・整形関数。DOM や保存先には触れない(node --test でテストする)。

const pad2 = (n) => String(n).padStart(2, '0');

// ---- 日付 ("YYYY-MM-DD" のローカル日付文字列で扱う) ----

export function toDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

export function formatDateJa(s) {
  const d = parseDateStr(s);
  return `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAYS_JA[d.getDay()]})`;
}

export function formatShortDate(s) {
  const d = parseDateStr(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 月曜始まりの月カレンダー。週ごとの配列で、各日は { date, day, inMonth }。
export function monthGrid(year, monthIndex) {
  const first = new Date(year, monthIndex, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const weekCount = Math.ceil((offset + daysInMonth) / 7);
  const weeks = [];
  for (let w = 0; w < weekCount; w++) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(year, monthIndex, 1 - offset + w * 7 + i);
      week.push({ date: toDateStr(d), day: d.getDate(), inMonth: d.getMonth() === first.getMonth() });
    }
    weeks.push(week);
  }
  return weeks;
}

// ---- ランニング ----

export function paceSecPerKm(distanceKm, durationSec) {
  if (!(distanceKm > 0) || !(durationSec > 0)) return null;
  return durationSec / distanceKm;
}

export function formatPace(secPerKm) {
  if (secPerKm == null) return '—';
  const t = Math.round(secPerKm);
  return `${Math.floor(t / 60)}:${pad2(t % 60)}/km`;
}

export function formatDuration(sec) {
  const t = Math.round(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

// ---- 前回の記録 ----

// 指定日より前で最も新しい、同じ種目の実施済み記録。同じ日に複数あれば後に登録した方。
export function findPrevious(entries, exerciseId, date) {
  let best = null;
  for (const e of entries) {
    if (e.status !== 'done' || e.exerciseId !== exerciseId || !(e.date < date)) continue;
    if (!best || e.date >= best.date) best = e;
  }
  return best;
}

// ---- 表示用の要約 ----

function describeRun(r) {
  const parts = [`${r.distanceKm}km`];
  if (r.durationSec > 0) {
    parts.push(formatDuration(r.durationSec));
    parts.push(formatPace(paceSecPerKm(r.distanceKm, r.durationSec)));
  }
  return parts.join(' ・ ');
}

const unitOf = (ex) => (ex.loadType === 'timed' ? '秒' : '回');

function weightPrefix(ex, weightKg) {
  if (ex.loadType === 'weighted') return `${weightKg}kg × `;
  if (ex.loadType === 'bodyweight' && weightKg > 0) return `+${weightKg}kg × `;
  return '';
}

export function describePlan(ex, plan) {
  if (ex.kind === 'run') return describeRun(plan);
  return `${weightPrefix(ex, plan.weightKg)}${plan.reps}${unitOf(ex)} × ${plan.sets}セット`;
}

export function describeActual(ex, actual) {
  if (ex.kind === 'run') return describeRun(actual);
  const sets = actual.sets;
  if (!sets.length) return '—';
  const unit = unitOf(ex);
  const sameWeight = sets.every((s) => s.weightKg === sets[0].weightKg);
  const sameReps = sets.every((s) => s.reps === sets[0].reps);
  if (sameWeight && sameReps) {
    return `${weightPrefix(ex, sets[0].weightKg)}${sets[0].reps}${unit} × ${sets.length}セット`;
  }
  if (sameWeight) {
    return `${weightPrefix(ex, sets[0].weightKg)}${sets.map((s) => s.reps).join('・')}${unit}`;
  }
  const label = (s) =>
    ex.loadType === 'weighted' ? `${s.weightKg}kg` : s.weightKg > 0 ? `+${s.weightKg}kg` : '自重';
  return sets.map((s) => `${label(s)}×${s.reps}`).join(' / ');
}

// ---- 体の記録 ----

// 日付 → 通し日数(グラフの横軸や日数差の計算に使う)
export function dayNumber(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export function dayNumberToDateStr(n) {
  const d = new Date(n * 86400000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export const addDays = (dateStr, n) => dayNumberToDateStr(dayNumber(dateStr) + n);

// 各記録日について、その日を含む直近 days 日間(暦日)の体重の平均。
// 記録のない日は飛ばして、ある分だけで平均する。logs は日付の昇順。
export function movingAverage(logs, days = 7) {
  const out = [];
  let start = 0;
  let sum = 0;
  for (let i = 0; i < logs.length; i++) {
    sum += logs[i].weightKg;
    const from = dayNumber(logs[i].date) - (days - 1);
    while (dayNumber(logs[start].date) < from) sum -= logs[start++].weightKg;
    out.push({ date: logs[i].date, value: sum / (i - start + 1) });
  }
  return out;
}

export function bmi(weightKg, heightCm) {
  if (!(weightKg > 0) || !(heightCm > 0)) return null;
  return weightKg / (heightCm / 100) ** 2;
}
