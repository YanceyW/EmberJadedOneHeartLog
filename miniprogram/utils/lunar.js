/**
 * 生日滚轮和月历农历。
 * 换算走 lunar-lib.js（lunar-javascript 1.7.8，MIT）。
 * 已保存的生日仍是「年-月-日」或「年-L月-日」，这里不改格式。
 */
const { Solar, LunarYear, LunarMonth } = require("./lunar-lib.js");

const FIRST_YEAR = 1920;
const LAST_YEAR = 2100;
const MONTH_NAMES = ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"];
const DAY_NAMES = ["初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十", "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十", "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"];
const CALENDARS = ["阳历", "农历"];

function pad(number) {
  return String(number).padStart(2, "0");
}

function yearsUntilNow() {
  const end = Math.min(new Date().getFullYear(), LAST_YEAR);
  const years = [];
  for (let year = FIRST_YEAR; year <= end; year += 1) {
    years.push(year);
  }
  return years;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value || 0, min), max);
}

/** 农历年的闰月。没有闰月时返回 0。 */
function leapMonth(year) {
  if (year < 1900 || year > LAST_YEAR) {
    return 0;
  }
  try {
    return LunarYear.fromYear(year).getLeapMonth() || 0;
  } catch (error) {
    return 0;
  }
}

function monthDays(year, month, leap) {
  try {
    const value = LunarMonth.fromYm(year, leap ? -month : month);
    return value ? value.getDayCount() : 30;
  } catch (error) {
    return 30;
  }
}

function monthsOf(year) {
  if (year < 1900 || year > LAST_YEAR) {
    return [];
  }
  const leap = leapMonth(year);
  const months = [];
  for (let month = 1; month <= 12; month += 1) {
    months.push({ key: pad(month), name: MONTH_NAMES[month - 1] + "月", days: monthDays(year, month, false) });
    if (leap === month) {
      months.push({ key: "L" + pad(month), name: "闰" + MONTH_NAMES[month - 1] + "月", days: monthDays(year, month, true) });
    }
  }
  return months;
}

function solarMonthCount(year) {
  const now = new Date();
  return year === now.getFullYear() ? now.getMonth() + 1 : 12;
}

function solarDayCount(year, month) {
  const count = new Date(year, month, 0).getDate();
  const now = new Date();
  if (year === now.getFullYear() && month === now.getMonth() + 1) {
    return Math.min(count, now.getDate());
  }
  return count;
}

function buildBirth(index) {
  const calendarIndex = index[0] === 1 ? 1 : 0;
  const yearList = yearsUntilNow();
  const yearIndex = clamp(index[1], 0, yearList.length - 1);
  const year = yearList[yearIndex];
  let months;
  if (calendarIndex === 0) {
    const count = solarMonthCount(year);
    months = [];
    for (let month = 1; month <= count; month += 1) {
      months.push({ key: pad(month), name: month + "月", days: solarDayCount(year, month) });
    }
  } else {
    months = monthsOf(year);
  }
  const monthIndex = clamp(index[2], 0, Math.max(months.length - 1, 0));
  const dayCount = months[monthIndex] ? months[monthIndex].days : 30;
  const days = calendarIndex === 0
    ? Array.from({ length: dayCount }, (_, day) => (day + 1) + "日")
    : DAY_NAMES.slice(0, dayCount);
  const dayIndex = clamp(index[3], 0, Math.max(days.length - 1, 0));
  return {
    range: [CALENDARS, yearList.map((item) => item + "年"), months.map((item) => item.name), days],
    index: [calendarIndex, yearIndex, monthIndex, dayIndex],
    months,
  };
}

function birthFrom(index) {
  const built = buildBirth(index);
  const year = yearsUntilNow()[built.index[1]];
  const month = built.months[built.index[2]];
  return {
    calendar: built.index[0] === 1 ? "lunar" : "solar",
    date: year + "-" + month.key + "-" + pad(built.index[3] + 1),
    index: built.index,
  };
}

function indexFrom(code) {
  const matched = /^(\d{4})-(L)?(\d{2})-(\d{2})$/.exec(code || "");
  if (!matched) return null;
  const year = Number(matched[1]);
  const yearIndex = yearsUntilNow().indexOf(year);
  if (yearIndex < 0) return null;
  const key = (matched[2] || "") + matched[3];
  const months = monthsOf(year);
  const monthIndex = months.findIndex((item) => item.key === key);
  if (monthIndex < 0) return null;
  const day = Number(matched[4]);
  if (day < 1 || day > months[monthIndex].days) return null;
  return [yearIndex, monthIndex, day - 1];
}

function indexFromBirth(calendar, date) {
  const matched = /^(\d{4})-(L)?(\d{2})-(\d{2})$/.exec(date || "");
  if (!matched) return null;
  const yearIndex = yearsUntilNow().indexOf(Number(matched[1]));
  if (yearIndex < 0) return null;
  if (calendar === "lunar") {
    const lunarIndex = indexFrom(date);
    if (!lunarIndex) return null;
    return buildBirth([1, lunarIndex[0], lunarIndex[1], lunarIndex[2]]).index;
  }
  return buildBirth([0, yearIndex, Number(matched[3]) - 1, Number(matched[4]) - 1]).index;
}

function formatLunar(code) {
  const matched = /^(\d{4})-(L)?(\d{2})-(\d{2})$/.exec(code || "");
  if (!matched) return "";
  const month = Number(matched[3]);
  const day = Number(matched[4]);
  if (month < 1 || month > 12 || day < 1 || day > 30) return "";
  return matched[1] + "年" + (matched[2] ? "闰" : "") + MONTH_NAMES[month - 1] + "月" + DAY_NAMES[day - 1];
}

function birthText(calendar, date) {
  if (!date) return "";
  if (calendar === "lunar") {
    const text = formatLunar(date);
    return text ? "农历" + text : "";
  }
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!matched) return "";
  return "阳历" + Number(matched[1]) + "年" + Number(matched[2]) + "月" + Number(matched[3]) + "日";
}

/** 公历换成农历。1900 到 2100 年。 */
function solarToLunar(year, month, day) {
  if (year < 1900 || year > LAST_YEAR) {
    return null;
  }
  try {
    const lunar = Solar.fromYmd(year, month, day).getLunar();
    const monthValue = lunar.getMonth();
    return {
      year: lunar.getYear(),
      month: Math.abs(monthValue),
      day: lunar.getDay(),
      isLeap: monthValue < 0,
    };
  } catch (error) {
    return null;
  }
}

function markDay(year, month, day) {
  const lunar = solarToLunar(year, month, day);
  if (!lunar) return { lunar: "", lunarFull: "" };
  const monthName = (lunar.isLeap ? "闰" : "") + MONTH_NAMES[lunar.month - 1];
  const dayName = DAY_NAMES[lunar.day - 1] || "";
  return {
    lunar: lunar.day === 1 ? monthName + "月" : dayName,
    lunarFull: lunar.year + "年" + monthName + "月" + dayName,
  };
}

const GAN_COLOR = {
  甲: "#3a9a4a", 乙: "#3a9a4a",
  丙: "#e05a4a", 丁: "#e05a4a",
  戊: "#c4a24a", 己: "#c4a24a",
  庚: "#8a8478", 辛: "#8a8478",
  壬: "#3a7ab5", 癸: "#3a7ab5",
  寅: "#3a9a4a", 卯: "#3a9a4a",
  巳: "#e05a4a", 午: "#e05a4a",
  辰: "#c4a24a", 戌: "#c4a24a", 丑: "#c4a24a", 未: "#c4a24a",
  申: "#8a8478", 酉: "#8a8478",
  亥: "#3a7ab5", 子: "#3a7ab5",
};

function splitPillar(name, text) {
  const value = String(text || "");
  const gan = value.slice(0, 1);
  const zhi = value.slice(1, 2);
  return {
    name,
    gan,
    zhi,
    ganColor: GAN_COLOR[gan] || "#5c463f",
    zhiColor: GAN_COLOR[zhi] || "#5c463f",
  };
}

/** 年、月、日、时的天干地支。时辰用当前钟点。 */
function ganZhiPillars(year, month, day, hour) {
  try {
    const lunar = Solar.fromYmdHms(year, month, day, hour, 0, 0).getLunar();
    return [
      splitPillar("年", lunar.getYearInGanZhi()),
      splitPillar("月", lunar.getMonthInGanZhi()),
      splitPillar("日", lunar.getDayInGanZhi()),
      splitPillar("时", lunar.getTimeInGanZhi()),
    ];
  } catch (error) {
    return [];
  }
}

/** 当天节气名。不是节气日时返回空字符串。 */
function solarTermName(year, month, day) {
  if (year < 1900 || year > LAST_YEAR) {
    return "";
  }
  try {
    return Solar.fromYmd(year, month, day).getLunar().getJieQi() || "";
  } catch (error) {
    return "";
  }
}

module.exports = {
  buildBirth,
  birthFrom,
  indexFromBirth,
  birthText,
  markDay,
  solarToLunar,
  leapMonth,
  solarTermName,
  ganZhiPillars,
};
