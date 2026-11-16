// 日付の計算・整形(「YYYY-MM-DD」のローカル日付文字列で扱う)。DOM や保存先には触れない(node --test でテストする)。

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

// その週の月曜日
export function weekStart(dateStr) {
  const n = dayNumber(dateStr);
  return dayNumberToDateStr(n - ((n + 3) % 7)); // 通し日数 0 (1970-01-01) は木曜
}

// from 〜 to の週(月曜の日付)を空の週も含めて並べる
export function weekRange(fromWeek, toWeek) {
  const out = [];
  for (let n = dayNumber(fromWeek); n <= dayNumber(toWeek); n += 7) out.push(dayNumberToDateStr(n));
  return out;
}
