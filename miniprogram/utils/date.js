/** 日期工具。全部按手机本地日期计算，避免时区把日子提前或推后一天。节气用农历库。 */
const { solarTermName } = require("./lunar");

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function todayString() {
  return formatDate(new Date());
}

function parseDate(text) {
  const [year, month, day] = text.split("-").map((item) => Number(item));
  return new Date(year, month - 1, day);
}

function addDays(text, count) {
  const date = parseDate(text);
  date.setDate(date.getDate() + count);
  return formatDate(date);
}

/** 从 start 到 end 的天数，end 晚于 start 时为正。 */
function diffDays(start, end) {
  const ms = parseDate(end).getTime() - parseDate(start).getTime();
  return Math.round(ms / 86400000);
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * 纪念日在某一年对应的日期。2 月 29 日在非闰年落到 2 月 28 日。
 */
function anniversaryOn(year, month, day) {
  if (month === 2 && day === 29 && !isLeapYear(year)) {
    return `${year}-02-28`;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** 今年的这个日子，已经过了就取明年。提醒时机按它算。 */
function nextOccurrence(month, day, today) {
  const year = Number(String(today).slice(0, 4));
  const thisYear = anniversaryOn(year, month, day);
  return thisYear >= today ? thisYear : anniversaryOn(year + 1, month, day);
}

/** 下一次纪念日是第几个。没填开始年份时返回 0。 */
function anniversaryIndex(startYear, month, day, today) {  const year = Number(startYear);
  if (!year) {
    return 0;
  }
  const nowYear = Number(String(today).slice(0, 4));
  const thisDate = anniversaryOn(nowYear, month, day);
  const markYear = thisDate >= today ? nowYear : nowYear + 1;
  const count = markYear - year;
  return count > 0 ? count : 0;
}

function chineseDate(year, month, day) {
  if (year) {
    return `${year}年${Number(month)}月${Number(day)}日`;
  }
  return `${Number(month)}月${Number(day)}日`;
}

function displayDate(text) {
  const [year, month, day] = text.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

module.exports = {
  pad,
  formatDate,
  todayString,
  parseDate,
  addDays,
  diffDays,
  anniversaryOn,
  anniversaryIndex,
  nextOccurrence,
  chineseDate,
  displayDate,
  solarTermName,
};
