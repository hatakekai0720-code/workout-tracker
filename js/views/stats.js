// グラフ・統計。期間切替はページ全体に効く。
import { getState, getExercise, BODY_PARTS } from '../store.js';
import {
  toDateStr,
  dayNumber,
  dayNumberToDateStr,
  weekStart,
  weekRange,
  strengthSeries,
  runSeries,
  weeklyRunDistance,
  weeklySetsByPart,
  formatPace,
} from '../calc.js';
import { periodStart, periodButtons, theme, lineChart, weeklyBarChart } from '../charts.js';
import { esc } from '../util.js';

const PART_KEYS = Object.keys(BODY_PARTS);
const round1 = (n) => (Math.round(n * 10) / 10).toString();
const kgFmt = (v) => `${round1(v)}kg`;

export function mountStats(root) {
  const ui = { period: '1m', exerciseId: null };
  let charts = [];

  // 直近に実施した筋トレ種目を初期表示にする
  function defaultExercise(strength) {
    const ids = new Set(strength.map((x) => x.id));
    let latest = null;
    for (const e of getState().entries) {
      if (e.status === 'done' && ids.has(e.exerciseId) && (!latest || e.date >= latest.date)) latest = e;
    }
    return latest ? latest.exerciseId : strength[0]?.id ?? null;
  }

  const legend = (items) =>
    `<div class="chart-legend">${items
      .map(({ label, color }) => `<span><i class="lg-swatch" style="background:${color}"></i>${esc(label)}</span>`)
      .join('')}</div>`;

  // has が false なら空表示。legendItems は 2 系列以上のときだけ渡す。
  const chartBlock = (key, title, has, { latest = '', legendItems = null, note = '' } = {}) => `
    <div class="chart-block">
      <div class="chart-title"><h3>${title}</h3><span class="chart-latest">${has ? latest : ''}</span></div>
      ${has && legendItems ? legend(legendItems) : ''}
      ${
        has
          ? `<div class="chart-box small"><canvas data-chart="${key}" role="img" aria-label="${title}のグラフ"></canvas></div>`
          : `<p class="empty">${note || 'この期間の記録はありません'}</p>`
      }
    </div>`;

  // 表示する週の範囲。期間の開始(全期間なら最初の記録)から今週まで。
  function weeksFor(from, dataWeeks) {
    const thisWeek = weekStart(toDateStr(new Date()));
    const first = Number.isFinite(from) ? weekStart(dayNumberToDateStr(from)) : dataWeeks.sort()[0] || thisWeek;
    return weekRange(first, thisWeek);
  }

  function render() {
    const { entries, exercises, bodyLogs } = getState();
    const t = theme();
    const from = periodStart(ui.period);
    const inPeriod = (p) => dayNumber(p.date) >= from;
    const pts = (series, pick) => series.map((p) => ({ x: dayNumber(p.date), y: pick(p) }));
    const draws = [];

    // ---- 筋トレ(種目ごと) ----
    const allStrength = exercises.filter((x) => x.kind === 'strength' && (!x.archived || x.id === ui.exerciseId));
    // 種目が多いので、実施した記録のある種目だけを選択欄に出す(1つもなければ全部)
    const doneIds = new Set(entries.filter((e) => e.status === 'done').map((e) => e.exerciseId));
    const recorded = allStrength.filter((x) => doneIds.has(x.id));
    const strength = recorded.length ? recorded : allStrength;
    if (!strength.some((x) => x.id === ui.exerciseId)) ui.exerciseId = defaultExercise(strength);
    const ex = ui.exerciseId ? getExercise(ui.exerciseId) : null;
    let strengthHtml = '<p class="empty">筋トレの種目がありません</p>';
    if (ex) {
      const s = strengthSeries(entries, ex.id, bodyLogs).filter(inPeriod);
      const last = s.at(-1);
      const has = s.length > 0;
      const options = strength
        .map((x) => `<option value="${x.id}" ${x.id === ex.id ? 'selected' : ''}>${esc(x.name)}</option>`)
        .join('');
      let blocks;
      if (ex.loadType === 'weighted') {
        const ratio = s.filter((p) => p.ratio != null);
        blocks =
          chartBlock('load', '重量と推定1RM', has, {
            latest: last ? `推定1RM ${kgFmt(last.est1RM)}` : '',
            legendItems: [
              { label: '推定1RM', color: t.series[0] },
              { label: '最大重量', color: t.series[1] },
            ],
          }) +
          chartBlock('volume', '総挙上量', has, { latest: last ? `${Math.round(last.volume)}kg` : '' }) +
          chartBlock('ratio', '体重比(推定1RM ÷ 体重)', ratio.length > 0, {
            latest: ratio.length ? `${ratio.at(-1).ratio.toFixed(2)}倍` : '',
            note: has ? '体重の記録があると表示されます(「体」タブ)' : '',
          });
        if (has) {
          draws.push([
            'load',
            (c) =>
              lineChart(c, {
                from,
                fmt: kgFmt,
                yTick: (v) => `${v}kg`,
                series: [
                  { label: '推定1RM', color: t.series[0], points: pts(s, (p) => p.est1RM) },
                  { label: '最大重量', color: t.series[1], points: pts(s, (p) => p.topWeight) },
                ],
              }),
          ]);
          draws.push([
            'volume',
            (c) =>
              lineChart(c, {
                from,
                beginAtZero: true,
                fmt: (v) => `${Math.round(v)}kg`,
                yTick: (v) => `${v}kg`,
                series: [{ label: '総挙上量', color: t.series[0], points: pts(s, (p) => p.volume) }],
              }),
          ]);
        }
        if (ratio.length) {
          draws.push([
            'ratio',
            (c) =>
              lineChart(c, {
                from,
                fmt: (v) => `${v.toFixed(2)}倍`,
                yTick: (v) => `${Number(v.toFixed(2))}倍`,
                series: [{ label: '体重比', color: t.series[0], points: pts(ratio, (p) => p.ratio) }],
              }),
          ]);
        }
      } else {
        const unit = ex.loadType === 'timed' ? '秒' : '回';
        const [total, best] = ex.loadType === 'timed' ? ['合計秒数', '1セットの最長'] : ['合計回数', '1セットの最大'];
        blocks = chartBlock('reps', `${total}と${best}`, has, {
          latest: last ? `${total} ${last.totalReps}${unit}` : '',
          legendItems: [
            { label: total, color: t.series[0] },
            { label: best, color: t.series[1] },
          ],
        });
        if (has) {
          draws.push([
            'reps',
            (c) =>
              lineChart(c, {
                from,
                beginAtZero: true,
                fmt: (v) => `${v}${unit}`,
                yTick: (v) => `${v}${unit}`,
                series: [
                  { label: total, color: t.series[0], points: pts(s, (p) => p.totalReps) },
                  { label: best, color: t.series[1], points: pts(s, (p) => p.bestReps) },
                ],
              }),
          ]);
        }
      }
      strengthHtml = `<label class="field"><span>種目</span><select data-field="exercise">${options}</select></label>${blocks}`;
    }

    // ---- ランニング ----
    const runIds = new Set(exercises.filter((x) => x.kind === 'run').map((x) => x.id));
    const allRuns = runSeries(entries, runIds);
    const runs = allRuns.filter(inPeriod);
    const lastRun = runs.at(-1);
    const weeklyKm = weeklyRunDistance(allRuns);
    const runWeeks = weeksFor(from, [...weeklyKm.keys()]);
    const weeklyKmData = runWeeks.map((w) => Math.round((weeklyKm.get(w) || 0) * 100) / 100);
    const hasWeeklyKm = weeklyKmData.some((v) => v > 0);
    const runHtml =
      chartBlock('distance', '距離', runs.length > 0, { latest: lastRun ? `${round1(lastRun.distanceKm)}km` : '' }) +
      chartBlock('pace', 'ペース', runs.length > 0, { latest: lastRun ? formatPace(lastRun.pace) : '' }) +
      (runs.length ? '<p class="chart-note">ペースは下にあるほど速い</p>' : '') +
      chartBlock('weeklyKm', '週ごとの合計距離', hasWeeklyKm, {
        latest: hasWeeklyKm ? `今週 ${round1(weeklyKmData.at(-1))}km` : '',
      });
    if (runs.length) {
      draws.push([
        'distance',
        (c) =>
          lineChart(c, {
            from,
            beginAtZero: true,
            fmt: (v) => `${round1(v)}km`,
            yTick: (v) => `${v}km`,
            series: [{ label: '距離', color: t.series[2], points: pts(runs, (p) => p.distanceKm) }],
          }),
      ]);
      draws.push([
        'pace',
        (c) =>
          lineChart(c, {
            from,
            fmt: formatPace,
            yTick: (v) => formatPace(v).replace('/km', ''),
            series: [{ label: 'ペース', color: t.series[2], points: pts(runs, (p) => p.pace) }],
          }),
      ]);
    }
    if (hasWeeklyKm) {
      draws.push([
        'weeklyKm',
        (c) =>
          weeklyBarChart(c, {
            weeks: runWeeks,
            fmt: (v) => `${round1(v)}km`,
            yTick: (v) => `${v}km`,
            datasets: [{ label: '合計距離', color: t.series[2], data: weeklyKmData }],
          }),
      ]);
    }

    // ---- 部位別の週ごとのセット数 ----
    const sets = weeklySetsByPart(entries, exercises);
    const setWeeks = weeksFor(from, [...sets.keys()]);
    const hasSets = setWeeks.some((w) => sets.has(w));
    const thisW = sets.get(setWeeks.at(-1)) || {};
    const prevW = sets.get(setWeeks.at(-2)) || {};
    const partsHtml =
      chartBlock('parts', '週ごとのセット数', hasSets, {
        legendItems: PART_KEYS.map((k, i) => ({ label: BODY_PARTS[k], color: t.series[i] })),
      }) +
      (hasSets
        ? `<table class="mini-table">
            <thead><tr><th></th>${PART_KEYS.map((k) => `<th>${BODY_PARTS[k]}</th>`).join('')}</tr></thead>
            <tbody>
              <tr><th>今週</th>${PART_KEYS.map((k) => `<td>${thisW[k] || 0}</td>`).join('')}</tr>
              <tr><th>先週</th>${PART_KEYS.map((k) => `<td>${prevW[k] || 0}</td>`).join('')}</tr>
            </tbody>
          </table>`
        : '');
    if (hasSets) {
      draws.push([
        'parts',
        (c) =>
          weeklyBarChart(c, {
            weeks: setWeeks,
            stacked: true,
            fmt: (v) => `${v}セット`,
            datasets: PART_KEYS.map((k, i) => ({
              label: BODY_PARTS[k],
              color: t.series[i],
              data: setWeeks.map((w) => sets.get(w)?.[k] || 0),
            })),
          }),
      ]);
    }

    charts.forEach((c) => c.destroy());
    root.innerHTML = `
      <header class="page-head with-filter"><h1>グラフ</h1>${periodButtons(ui.period)}</header>
      <section class="card first"><h2>筋トレ</h2>${strengthHtml}</section>
      <section class="card"><h2>ランニング</h2>${runHtml}</section>
      <section class="card"><h2>部位別</h2>${partsHtml}</section>`;
    charts = draws.map(([key, draw]) => draw(root.querySelector(`[data-chart="${key}"]`)));
  }

  root.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-action="period"]');
    if (!t) return;
    ui.period = t.dataset.key;
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  });

  root.addEventListener('change', (ev) => {
    if (ev.target.dataset.field !== 'exercise') return;
    ui.exerciseId = ev.target.value;
    render();
  });

  return { render };
}
