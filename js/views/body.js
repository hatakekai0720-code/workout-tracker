// プロフィールと体の記録(体重・体脂肪率)、体重グラフ。
import { getState, setProfile, getBodyLog, upsertBodyLog, deleteBodyLog } from '../store.js';
import { toDateStr, formatShortDate, formatDateJa, dayNumber, dayNumberToDateStr, movingAverage, bmi } from '../calc.js';
import { PERIODS, dateTicks } from '../charts.js';
import { esc } from '../util.js';

const LIST_STEP = 14;

const str = (v) => (v == null ? '' : String(v));
const num = (s) => (String(s).trim() === '' ? NaN : Number(s));
const kg = (n) => n.toFixed(1);
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(1)}`;

export function mountBody(root) {
  const ui = { period: '1m', listCount: LIST_STEP, form: null, message: '', error: '' };
  let chart = null;

  function loadForm(date) {
    const log = getBodyLog(date);
    ui.form = { date, weight: str(log?.weightKg), fat: str(log?.bodyFatPct) };
  }

  function tiles(logs, avg, profile) {
    const latest = logs.at(-1);
    const latestAvg = avg.at(-1);
    const target = profile.targetWeightKg;
    const b = latest ? bmi(latest.weightKg, profile.heightCm) : null;
    const tile = (label, value, unit, note) => `<div class="tile">
        <span class="tile-label">${label}</span>
        <span class="tile-value">${value}<small>${value === '—' ? '' : unit}</small></span>
        <span class="tile-note">${note}</span>
      </div>`;
    return `<div class="tiles">
      ${tile('最新の体重', latest ? kg(latest.weightKg) : '—', 'kg', latest ? formatShortDate(latest.date) : '記録なし')}
      ${tile('7日平均', latestAvg ? kg(latestAvg.value) : '—', 'kg', latest ? `${formatShortDate(latest.date)}時点` : '')}
      ${tile(
        '目標まで',
        latest && target ? signed(target - latest.weightKg) : '—',
        'kg',
        target ? `目標 ${kg(target)}kg` : '目標は未設定',
      )}
      ${tile('BMI', b ? b.toFixed(1) : '—', '', profile.heightCm ? `身長 ${profile.heightCm}cm` : '身長は未設定')}
    </div>`;
  }

  function logList(logs) {
    if (!logs.length) return '<p class="empty">記録はまだありません</p>';
    const rows = logs
      .slice(-ui.listCount)
      .reverse()
      .map(
        (l) => `<li><button type="button" class="log-row" data-action="edit" data-date="${l.date}">
          <span class="log-date">${formatDateJa(l.date)}</span>
          <span class="log-weight">${kg(l.weightKg)}<small>kg</small></span>
          <span class="log-fat">${l.bodyFatPct != null ? `${l.bodyFatPct.toFixed(1)}%` : ''}</span>
        </button></li>`,
      )
      .join('');
    const more =
      logs.length > ui.listCount ? '<button type="button" class="btn-ghost wide" data-action="more">もっと見る</button>' : '';
    return `<ul class="log-list">${rows}</ul>${more}`;
  }

  function render() {
    const { bodyLogs: logs, profile } = getState();
    if (!ui.form) loadForm(toDateStr(new Date()));
    const avg = movingAverage(logs);
    const existing = getBodyLog(ui.form.date);

    root.innerHTML = `
      <header class="page-head"><h1>体の記録</h1></header>
      ${tiles(logs, avg, profile)}

      <section class="card">
        <h2>記録する</h2>
        <form data-form="log" novalidate>
          <label class="field"><span>日付</span>
            <input type="date" data-field="date" value="${ui.form.date}" max="${toDateStr(new Date())}"></label>
          <div class="row">
            <label class="field"><span>体重 (kg)</span>
              <input type="number" inputmode="decimal" step="0.1" min="0" data-field="weight" value="${esc(ui.form.weight)}"></label>
            <label class="field"><span>体脂肪率 (%・任意)</span>
              <input type="number" inputmode="decimal" step="0.1" min="0" data-field="fat" value="${esc(ui.form.fat)}"></label>
          </div>
          <p class="error" role="alert" ${ui.error ? '' : 'hidden'}>${esc(ui.error)}</p>
          <p class="saved" role="status" ${ui.message ? '' : 'hidden'}>${esc(ui.message)}</p>
          <button type="submit" class="btn-primary wide">${existing ? 'この日の記録を更新' : '保存'}</button>
          ${existing ? '<button type="button" class="btn-danger wide" data-action="delete">この日の記録を削除</button>' : ''}
        </form>
      </section>

      <section class="card">
        <div class="card-head">
          <h2>体重の推移</h2>
          <div class="segmented" role="group" aria-label="期間">
            ${PERIODS.map(
              (p) =>
                `<button type="button" data-action="period" data-key="${p.key}" aria-pressed="${p.key === ui.period}">${p.label}</button>`,
            ).join('')}
          </div>
        </div>
        <div class="chart-legend">
          <span><i class="lg-dot"></i>体重</span>
          <span><i class="lg-line"></i>7日移動平均</span>
          ${profile.targetWeightKg ? '<span><i class="lg-dash"></i>目標</span>' : ''}
        </div>
        <div class="chart-box"><canvas aria-label="体重と7日移動平均のグラフ" role="img"></canvas>
          <p class="empty chart-empty" hidden>この期間の記録はありません</p></div>
      </section>

      <section class="card">
        <h2>記録一覧</h2>
        ${logList(logs)}
      </section>

      <section class="card">
        <h2>プロフィール</h2>
        <div class="row">
          <label class="field"><span>身長 (cm)</span>
            <input type="number" inputmode="decimal" step="0.1" min="0" data-profile="heightCm" value="${esc(str(profile.heightCm))}"></label>
          <label class="field"><span>目標体重 (kg)</span>
            <input type="number" inputmode="decimal" step="0.1" min="0" data-profile="targetWeightKg" value="${esc(str(profile.targetWeightKg))}"></label>
        </div>
        <p class="error" role="alert" data-profile-error hidden></p>
      </section>`;

    drawChart(logs, avg, profile.targetWeightKg);
  }

  function drawChart(logs, avg, target) {
    chart?.destroy();
    chart = null;
    const period = PERIODS.find((p) => p.key === ui.period);
    const today = dayNumber(toDateStr(new Date()));
    const from = period.days ? today - period.days + 1 : -Infinity;
    const raw = [];
    const mean = [];
    logs.forEach((l, i) => {
      const x = dayNumber(l.date);
      if (x < from) return;
      raw.push({ x, y: l.weightKg });
      mean.push({ x, y: avg[i].value });
    });
    const canvas = root.querySelector('canvas');
    if (!raw.length) {
      canvas.hidden = true;
      root.querySelector('.chart-empty').hidden = false;
      return;
    }

    const css = getComputedStyle(document.documentElement);
    const c = (name) => css.getPropertyValue(name).trim();
    // 端の点が切れないよう半日ぶん余白を取る
    const xMin = (period.days ? from : raw[0].x) - 0.5;
    const xMax = Math.max(today, raw.at(-1).x) + 0.5;
    const ys = raw.map((p) => p.y).concat(target ? [target] : []);
    const datasets = [
      {
        label: '7日移動平均',
        data: mean,
        borderColor: c('--chart-1'),
        backgroundColor: c('--chart-1'),
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.25,
        order: 1,
      },
      {
        label: '体重',
        data: raw,
        showLine: false,
        borderColor: c('--surface'),
        backgroundColor: c('--chart-raw'),
        borderWidth: 1,
        pointRadius: raw.length > 60 ? 2.5 : 3.5,
        pointHoverRadius: 5,
        order: 2,
      },
    ];
    if (target) {
      datasets.push({
        label: '目標',
        data: [
          { x: xMin, y: target },
          { x: xMax, y: target },
        ],
        borderColor: c('--muted'),
        borderWidth: 1.5,
        borderDash: [5, 4],
        pointRadius: 0,
        pointHoverRadius: 0,
        order: 3,
      });
    }

    chart = new window.Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            type: 'linear',
            min: xMin,
            max: xMax,
            grid: { display: false },
            border: { color: c('--line') },
            afterBuildTicks: dateTicks,
            ticks: { color: c('--muted'), maxRotation: 0, callback: (v) => formatShortDate(dayNumberToDateStr(v)) },
          },
          y: {
            suggestedMin: Math.floor(Math.min(...ys) - 0.5),
            suggestedMax: Math.ceil(Math.max(...ys) + 0.5),
            grid: { color: c('--line') },
            border: { display: false },
            ticks: { color: c('--muted'), maxTicksLimit: 6, callback: (v) => `${v}kg` },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: (item) => item.dataset.label !== '目標',
            itemSort: (a, b) => b.datasetIndex - a.datasetIndex,
            callbacks: {
              title: (items) => (items.length ? formatDateJa(dayNumberToDateStr(items[0].parsed.x)) : ''),
              label: (item) => ` ${item.dataset.label} ${item.parsed.y.toFixed(1)}kg`,
            },
          },
        },
      },
    });
  }

  root.addEventListener('input', (ev) => {
    const f = ev.target.dataset.field;
    if (f === 'weight' || f === 'fat') ui.form[f] = ev.target.value;
  });

  root.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.field === 'date' && t.value) {
      loadForm(t.value);
      ui.message = ui.error = '';
      render();
    } else if (t.dataset.profile) {
      const key = t.dataset.profile;
      const raw = t.value.trim();
      const v = raw === '' ? null : Number(raw);
      const [lo, hi, name] = key === 'heightCm' ? [100, 250, '身長'] : [20, 300, '目標体重'];
      if (v !== null && !(v >= lo && v <= hi)) {
        const el = root.querySelector('[data-profile-error]');
        el.textContent = `${name}は${lo}〜${hi}の範囲で入力してください`;
        el.hidden = false;
        return;
      }
      setProfile({ [key]: v });
      render();
    }
  });

  root.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const w = num(ui.form.weight);
    const fatRaw = ui.form.fat.trim();
    const fat = fatRaw === '' ? null : Number(fatRaw);
    ui.message = '';
    if (!(w >= 20 && w <= 300)) ui.error = '体重は20〜300kgの範囲で入力してください';
    else if (fat !== null && !(fat >= 1 && fat <= 70)) ui.error = '体脂肪率は1〜70%の範囲で入力してください';
    else {
      ui.error = '';
      upsertBodyLog({ date: ui.form.date, weightKg: w, bodyFatPct: fat });
      ui.message = `${formatDateJa(ui.form.date)}の記録を保存しました`;
    }
    render();
  });

  root.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-action]');
    if (!t) return;
    switch (t.dataset.action) {
      case 'period':
        ui.period = t.dataset.key;
        break;
      case 'more':
        ui.listCount += LIST_STEP;
        break;
      case 'edit':
        loadForm(t.dataset.date);
        ui.message = ui.error = '';
        render();
        root.querySelector('[data-form="log"]').scrollIntoView({ block: 'center' });
        return;
      case 'delete':
        if (!confirm(`${formatDateJa(ui.form.date)}の記録を削除しますか？`)) return;
        deleteBodyLog(ui.form.date);
        loadForm(ui.form.date);
        ui.message = ui.error = '';
        break;
    }
    render();
  });

  return {
    render() {
      ui.message = ui.error = '';
      render();
    },
  };
}
