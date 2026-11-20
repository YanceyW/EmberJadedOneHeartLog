/** 日期工具。全部按手机本地日期计算，避免时区把日子提前或推后一天。 */

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

/** 下一次纪念日是第几个。没填开始年份时返回 0。 */
function anniversaryIndex(startYear, month, day, today) {
  const year = Number(startYear);
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

const SOLAR_FESTIVALS = {
  "1-1": "元旦",
  "2-14": "情人节",
  "5-1": "劳动节",
  "6-1": "儿童节",
  "10-1": "国庆节",
  "12-25": "圣诞节",
};

const TERM_NAMES = ["小寒", "大寒", "立春", "雨水", "惊蛰", "春分", "清明", "谷雨", "立夏", "小满", "芒种", "夏至", "小暑", "大暑", "立秋", "处暑", "白露", "秋分", "寒露", "霜降", "立冬", "小雪", "大雪", "冬至"];
const TERM_INFO = [0, 21208, 42467, 63836, 85337, 107014, 128867, 150921, 173149, 195551, 218072, 240693, 263343, 285989, 308563, 331033, 353350, 375494, 397447, 419210, 440795, 462224, 483532, 504758];

function solarTermName(year, month, day) {
  for (let index = 0; index < 24; index += 1) {
    if (Math.floor(index / 2) + 1 !== month) {
      continue;
    }
    const moment = new Date(31556925974.7 * (year - 1900) + TERM_INFO[index] * 60000 + Date.UTC(1900, 0, 6, 2, 5));
    if (moment.getUTCDate() === day) {
      return TERM_NAMES[index];
    }
  }
  return "";
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
  chineseDate,
  displayDate,
  solarTermName,
  SOLAR_FESTIVALS,
};
