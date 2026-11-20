/** 经期预测。结果只在打开页面时计算，不写入数据库。 */
const { addDays, diffDays, todayString } = require("./date");

/**
 * 根据已记录的开始日推算下一次开始日。
 * 有两次及以上时，用最近最多 6 次间隔的平均值；只有一次时用周期长度。
 * @param {Array<{startDate: string}>} periods
 * @param {number} cycleLength
 * @returns {string} 空字符串表示还不能预测
 */
function nextStart(periods, cycleLength) {
  const starts = periods
    .map((item) => item.startDate)
    .filter(Boolean)
    .sort();
  if (!starts.length) {
    return "";
  }
  if (starts.length === 1) {
    return addDays(starts[0], cycleLength || 28);
  }
  const gaps = [];
  for (let index = 1; index < starts.length; index += 1) {
    gaps.push(diffDays(starts[index - 1], starts[index]));
  }
  const recent = gaps.slice(-6).filter((gap) => gap > 0);
  const average = recent.length
    ? Math.round(recent.reduce((sum, gap) => sum + gap, 0) / recent.length)
    : cycleLength || 28;
  let cursor = starts[starts.length - 1];
  const today = todayString();
  while (cursor < today) {
    cursor = addDays(cursor, average);
  }
  return cursor;
}

function rangeSet(start, length) {
  const result = new Set();
  const days = Math.max(1, length || 5);
  for (let offset = 0; offset < days; offset += 1) {
    result.add(addDays(start, offset));
  }
  return result;
}

/**
 * 汇总某一段经期数据对应的图标日期。
 * @param {Array} periods
 * @param {number} cycleLength
 * @param {number} periodLength
 */
function buildMarks(periods, cycleLength, periodLength) {
  const actual = new Set();
  periods.forEach((period) => {
    if (!period.startDate || !period.endDate || period.endDate < period.startDate) {
      return;
    }
    let cursor = period.startDate;
    while (cursor <= period.endDate) {
      actual.add(cursor);
      cursor = addDays(cursor, 1);
    }
  });

  const predictedStart = nextStart(periods, cycleLength);
  const predicted = predictedStart ? rangeSet(predictedStart, periodLength || 5) : new Set();
  predicted.forEach((date) => {
    if (actual.has(date)) {
      predicted.delete(date);
    }
  });

  const ovulation = new Set();
  const fertile = new Set();
  if (predictedStart) {
    const ovulationDate = addDays(predictedStart, -14);
    ovulation.add(ovulationDate);
    for (let offset = -5; offset <= 1; offset += 1) {
      const date = addDays(ovulationDate, offset);
      if (date !== ovulationDate) {
        fertile.add(date);
      }
    }
  }

  return { actual, predicted, ovulation, fertile, predictedStart };
}

module.exports = {
  nextStart,
  buildMarks,
};
