// Chart.js の共通設定。色は CSS 変数から読むのでライト/ダークに追従する。
import { toDateStr, dayNumber, dayNumberToDateStr, formatShortDate, formatDateJa } from '../logic/dates.js';

export const PERIODS = [
  { key: '1m', label: '1ヶ月', days: 30 },
  { key: '3m', label: '3ヶ月', days: 90 },
  { key: 'all', label: '全期間', days: null },
];

export const todayNumber = () => dayNumber(toDateStr(new Date()));

// 期間の開始日(通し日数)。全期間なら -Infinity。
export function periodStart(key) {
  const p = PERIODS.find((x) => x.key === key);
  return p.days ? todayNumber() - p.days + 1 : -Infinity;
}

export function periodButtons(current) {
  return `<div class="segmented" role="group" aria-label="期間">${PERIODS.map(
    (p) =>
      `<button type="button" data-action="period" data-key="${p.key}" aria-pressed="${p.key === current}">${p.label}</button>`,
  ).join('')}</div>`;
}

export function theme() {
  const s = getComputedStyle(document.documentElement);
  const v = (n) => s.getPropertyValue(n).trim();
  return {
    line: v('--line'),
    muted: v('--muted'),
    surface: v('--surface'),
    series: [1, 2, 3, 4, 5, 6].map((i) => v(`--chart-${i}`)),
  };
}

const baseOptions = (t) => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { display: false } },
});

// 日付軸の目盛りを、整数の日(=日付)に最大5本そろえて置く
export function dateTicks(axis) {
  const lo = Math.ceil(axis.min);
  const hi = Math.floor(axis.max);
  const step = Math.max(1, Math.ceil((hi - lo) / 4));
  const ticks = [];
  for (let v = hi; v >= lo; v -= step) ticks.unshift({ value: v });
  axis.ticks = ticks;
}

// 日付を横軸にした折れ線。series: [{ label, color, points: [{ x: 通し日数, y }] }]
export function lineChart(canvas, { series, from, fmt, yTick = (v) => v, beginAtZero = false }) {
  const t = theme();
  const xs = series.flatMap((s) => s.points.map((p) => p.x));
  const xMin = (Number.isFinite(from) ? from : Math.min(...xs)) - 0.5;
  const xMax = Math.max(todayNumber(), ...xs) + 0.5;
  const opts = baseOptions(t);
  return new window.Chart(canvas, {
    type: 'line',
    data: {
      datasets: series.map((s) => ({
        label: s.label,
        data: s.points,
        borderColor: s.color,
        backgroundColor: s.color,
        borderWidth: 2,
        pointRadius: s.points.length > 45 ? 0 : 3,
        pointHoverRadius: 5,
        pointBorderColor: t.surface,
        pointBorderWidth: 1,
        tension: 0.2,
      })),
    },
    options: {
      ...opts,
      scales: {
        x: {
          type: 'linear',
          min: xMin,
          max: xMax,
          grid: { display: false },
          border: { color: t.line },
          afterBuildTicks: dateTicks,
          ticks: { color: t.muted, maxRotation: 0, callback: (v) => formatShortDate(dayNumberToDateStr(v)) },
        },
        y: {
          beginAtZero,
          grace: '8%',
          grid: { color: t.line },
          border: { display: false },
          ticks: { color: t.muted, maxTicksLimit: 5, callback: yTick },
        },
      },
      plugins: {
        ...opts.plugins,
        tooltip: {
          callbacks: {
            title: (items) => (items.length ? formatDateJa(dayNumberToDateStr(items[0].parsed.x)) : ''),
            label: (item) => ` ${item.dataset.label} ${fmt(item.parsed.y)}`,
          },
        },
      },
    },
  });
}

// 週ごとの棒。weeks: 月曜の日付の配列 / datasets: [{ label, color, data }]
export function weeklyBarChart(canvas, { weeks, datasets, stacked = false, fmt, yTick = (v) => v }) {
  const t = theme();
  const opts = baseOptions(t);
  return new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels: weeks.map(formatShortDate),
      datasets: datasets.map((d) => ({
        label: d.label,
        data: d.data,
        backgroundColor: d.color,
        borderColor: t.surface,
        borderWidth: stacked ? 1 : 0,
        borderRadius: stacked ? 2 : 4,
        maxBarThickness: 28,
      })),
    },
    options: {
      ...opts,
      scales: {
        x: {
          stacked,
          grid: { display: false },
          border: { color: t.line },
          ticks: { color: t.muted, maxRotation: 0, autoSkipPadding: 12 },
        },
        y: {
          stacked,
          beginAtZero: true,
          grid: { color: t.line },
          border: { display: false },
          ticks: { color: t.muted, maxTicksLimit: 5, precision: 0, callback: yTick },
        },
      },
      plugins: {
        ...opts.plugins,
        tooltip: {
          filter: (item) => item.parsed.y > 0,
          itemSort: (a, b) => b.datasetIndex - a.datasetIndex, // 積み上げの上から順に
          callbacks: {
            title: (items) => (items.length ? `${items[0].label}〜の週` : ''),
            label: (item) => ` ${item.dataset.label} ${fmt(item.parsed.y)}`,
          },
        },
      },
    },
  });
}
