/**
 * 1900 到 2100 年的农历月大小和闰月。
 * 由已核对过的农历库压缩成位图，月历和生日滚轮都用这份小表。
 */
const INFO = [
  19416, 19168, 42352, 21717, 53856, 55632, 91476, 22176, 39632, 21970,
  19168, 42422, 42192, 53840, 119381, 46400, 54944, 44450, 38320, 84343,
  18800, 42160, 46261, 27216, 27968, 109396, 11104, 38256, 21234, 18800,
  25958, 54432, 59984, 92821, 23248, 11104, 100067, 37600, 116951, 51536,
  54432, 120998, 46416, 22176, 107956, 9680, 37584, 53938, 43344, 46423,
  27808, 46416, 86869, 19872, 42416, 83315, 21168, 43432, 59728, 27296,
  44710, 43856, 19296, 43748, 42352, 21088, 62051, 55632, 23383, 22176,
  38608, 19925, 19152, 42192, 54484, 53840, 54616, 46400, 46752, 103846,
  38320, 18864, 43380, 42160, 45690, 27216, 27968, 44870, 43872, 38256,
  19189, 18800, 25776, 29859, 59984, 27480, 23232, 43872, 38613, 37600,
  51552, 55636, 54432, 55888, 30034, 22176, 43959, 9680, 37584, 51893,
  43344, 46240, 47780, 44368, 21977, 19360, 42416, 86390, 21168, 43312,
  31060, 27296, 44368, 23378, 19296, 42726, 42208, 53856, 60005, 54576,
  23200, 30371, 38608, 19195, 19152, 42192, 118966, 53840, 54560, 56645,
  46496, 22224, 21938, 18864, 42359, 42160, 43600, 111189, 27936, 44448,
  84835, 37744, 18936, 18800, 25776, 92326, 59984, 27424, 108228, 43744,
  37600, 53987, 51552, 54615, 54432, 55888, 23893, 22176, 42704, 21972,
  21200, 43448, 43344, 46240, 46758, 44368, 21920, 43940, 42416, 21168,
  45683, 26928, 29495, 27296, 44368, 84821, 19296, 42352, 21732, 53600,
  59752, 54560, 55968, 92838, 22224, 19168, 43476, 41680, 53584, 62034,
  54560,
];

const FIRST_YEAR = 1920;
const MONTH_NAMES = ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"];
const DAY_NAMES = ["初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十", "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十", "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"];

function pad(number) {
  return String(number).padStart(2, "0");
}

function yearsUntilNow() {
  const end = Math.min(new Date().getFullYear(), 2100);
  const years = [];
  for (let year = FIRST_YEAR; year <= end; year += 1) {
    years.push(year);
  }
  return years;
}

function leapMonth(year) {
  const row = INFO[year - 1900];
  return row ? row & 0xf : 0;
}

function leapDayCount(year) {
  if (!leapMonth(year)) return 0;
  return INFO[year - 1900] & 0x10000 ? 30 : 29;
}

function monthDayCount(year, month) {
  return INFO[year - 1900] & (0x10000 >> month) ? 30 : 29;
}

function yearDayCount(year) {
  let sum = 348;
  for (let bit = 0x8000; bit > 0x8; bit >>= 1) {
    if (INFO[year - 1900] & bit) sum += 1;
  }
  return sum + leapDayCount(year);
}

/** 公历换成农历。1900-01-31 是农历正月初一。 */
function solarToLunar(year, month, day) {
  if (year < 1900 || year > 2100) return null;
  let offset = (Date.UTC(year, month - 1, day) - Date.UTC(1900, 0, 31)) / 86400000;
  let index = 1900;
  let days = 0;
  for (index = 1900; index < 2101 && offset > 0; index += 1) {
    days = yearDayCount(index);
    offset -= days;
  }
  if (offset < 0) {
    offset += days;
    index -= 1;
  }
  const lunarYear = index;
  const leap = leapMonth(lunarYear);
  let isLeap = false;
  for (index = 1; index < 13 && offset > 0; index += 1) {
    if (leap > 0 && index === leap + 1 && !isLeap) {
      index -= 1;
      isLeap = true;
      days = leapDayCount(lunarYear);
    } else {
      days = monthDayCount(lunarYear, index);
    }
    if (isLeap && index === leap + 1) isLeap = false;
    offset -= days;
  }
  if (offset === 0 && leap > 0 && index === leap + 1) {
    if (isLeap) isLeap = false;
    else {
      isLeap = true;
      index -= 1;
    }
  }
  if (offset < 0) {
    offset += days;
    index -= 1;
  }
  return { year: lunarYear, month: index, day: offset + 1, isLeap };
}

function monthsOf(year) {
  if (year < 1900 || year > 2100) return [];
  const leap = leapMonth(year);
  const months = [];
  for (let month = 1; month <= 12; month += 1) {
    months.push({ key: pad(month), name: MONTH_NAMES[month - 1] + "月", days: monthDayCount(year, month) });
    if (leap === month) {
      months.push({ key: "L" + pad(month), name: "闰" + MONTH_NAMES[month - 1] + "月", days: leapDayCount(year) });
    }
  }
  return months;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value || 0, min), max);
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

const CALENDARS = ["阳历", "农历"];

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

module.exports = {
  buildBirth,
  birthFrom,
  indexFromBirth,
  birthText,
  markDay,
  solarToLunar,
  leapMonth,
};
