/**
 * 节假日与节日，全项目只在这里维护。
 *
 * 为什么单独一个文件：
 *   节气、农历、黄历、四柱干支都由 utils/lunar-lib.js 按天文算法算出来，覆盖 1900–2100，
 *   永远不会过期。唯独法定节假日是国务院每年 11 月发通知才有的，会过期，
 *   所以只把这一项（连同阳历/农历节日名）集中到这里，以后每年只改这一处。
 *
 * 数据分三层，任一层挂了都不影响使用：
 *   1. BUILTIN_SPANS：打包进小程序的内置表，离线也能用（出厂兜底，不需要每年维护）
 *   2. 云数据库 holidays：云函数每周自动抓一次，抓到新一年就生效，不用发版
 *   3. festivals-cache:v1：前端缓存，永久可用，缺年份或超过 7 天才去后台拉
 *
 * 内置表怎么加一年：照下面 2025–2027 的样子，一条假期一行，
 *   from / to 是放假的第一天和最后一天，workdays 是要上班的调休日（没有就省略）。
 *   官方原文在 https://www.gov.cn 搜「国务院办公厅关于 XXXX 年部分节假日安排的通知」。
 */

const CACHE_KEY = "festivals-cache:v1";
const CACHE_TTL = 7 * 86400000;

const SOLAR_FESTIVALS = {
  "1-1": "元旦",
  "2-14": "情人节",
  "5-1": "劳动节",
  "6-1": "儿童节",
  "10-1": "国庆节",
  "12-25": "圣诞节",
};

const LUNAR_FESTIVALS = {
  "1-1": "春节",
  "1-15": "元宵节",
  "5-5": "端午节",
  "7-7": "七夕",
  "8-15": "中秋节",
  "9-9": "重阳节",
};

/** 放假区间 + 调休上班日。只写官方通知里明说「上班」的那几天。 */
const BUILTIN_SPANS = [
  // ── 2025 ── 国办发明电〔2024〕12 号
  { name: "元旦", from: "2025-01-01", to: "2025-01-01" },
  { name: "春节", from: "2025-01-28", to: "2025-02-04", workdays: ["2025-01-26", "2025-02-08"] },
  { name: "清明节", from: "2025-04-04", to: "2025-04-06" },
  { name: "劳动节", from: "2025-05-01", to: "2025-05-05", workdays: ["2025-04-27"] },
  { name: "端午节", from: "2025-05-31", to: "2025-06-02" },
  { name: "国庆节、中秋节", from: "2025-10-01", to: "2025-10-08", workdays: ["2025-09-28", "2025-10-11"] },

  // ── 2026 ── 国办发明电〔2025〕7 号
  { name: "元旦", from: "2026-01-01", to: "2026-01-03", workdays: ["2026-01-04"] },
  { name: "春节", from: "2026-02-15", to: "2026-02-23", workdays: ["2026-02-14", "2026-02-28"] },
  { name: "清明节", from: "2026-04-04", to: "2026-04-06" },
  { name: "劳动节", from: "2026-05-01", to: "2026-05-05", workdays: ["2026-05-09"] },
  { name: "端午节", from: "2026-06-19", to: "2026-06-21" },
  { name: "中秋节", from: "2026-09-25", to: "2026-09-27" },
  { name: "国庆节", from: "2026-10-01", to: "2026-10-07", workdays: ["2026-09-20", "2026-10-10"] },

  // ── 2027 ── 国办发明电〔2026〕10 号
  { name: "元旦", from: "2027-01-01", to: "2027-01-03" },
  { name: "春节", from: "2027-02-05", to: "2027-02-13", workdays: ["2027-01-31", "2027-02-14"] },
  { name: "清明节", from: "2027-04-03", to: "2027-04-05" },
  { name: "劳动节", from: "2027-05-01", to: "2027-05-05", workdays: ["2027-05-08"] },
  { name: "端午节", from: "2027-06-09", to: "2027-06-09" },
  { name: "中秋节", from: "2027-09-15", to: "2027-09-15" },
  { name: "国庆节", from: "2027-10-01", to: "2027-10-07", workdays: ["2027-09-26", "2027-10-09"] },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad(value) {
  return String(value).padStart(2, "0");
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/** 逐日走一遍 [from, to]，YYYY-MM-DD 可以直接比大小。 */
function eachDate(from, to, visit) {
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
    return;
  }
  let [year, month, day] = from.split("-").map(Number);
  let guard = 0;
  for (;;) {
    const text = `${year}-${pad(month)}-${pad(day)}`;
    visit(text);
    guard += 1;
    if (text >= to || guard > 400) {
      break;
    }
    day += 1;
    if (day > daysInMonth(year, month)) {
      day = 1;
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
  }
}

/** 内置那种「区间 + 调休日」的形状展开成按日期索引。 */
function mapFromSpans(spans) {
  const map = {};
  (spans || []).forEach((span) => {
    if (!span || !DATE_RE.test(span.from || "") || !DATE_RE.test(span.to || "")) {
      return;
    }
    const info = { name: span.name, from: span.from, to: span.to };
    eachDate(span.from, span.to, (date) => {
      map[date] = { ...info, type: "holiday" };
    });
    (span.workdays || []).forEach((date) => {
      if (DATE_RE.test(date)) {
        map[date] = { ...info, type: "workday" };
      }
    });
  });
  return map;
}

/** 云端那种「每天一条」的形状，按节日名聚成区间再展开。 */
function mapFromDays(days) {
  const groups = {};
  (days || []).forEach((item) => {
    if (!item || !DATE_RE.test(item.date || "") || !item.name) {
      return;
    }
    if (!groups[item.name]) {
      groups[item.name] = { rest: [], work: [] };
    }
    if (item.isOffDay) {
      groups[item.name].rest.push(item.date);
    } else {
      groups[item.name].work.push(item.date);
    }
  });
  const spans = Object.keys(groups).map((name) => {
    const group = groups[name];
    const rest = group.rest.slice().sort();
    const work = group.work.slice().sort();
    return {
      name,
      from: rest[0] || work[0] || "",
      to: rest[rest.length - 1] || work[work.length - 1] || "",
      workdays: work,
    };
  });
  return mapFromSpans(spans);
}

function dropYear(map, year) {
  const prefix = `${year}-`;
  Object.keys(map).forEach((date) => {
    if (date.slice(0, 5) === prefix) {
      delete map[date];
    }
  });
}

let MAP = {};
let remote = null;
let cache = null;
let started = false;
let listeners = [];

function rebuild() {
  MAP = mapFromSpans(BUILTIN_SPANS);
  if (remote && remote.years) {
    Object.keys(remote.years).forEach((year) => {
      const item = remote.years[year];
      const days = item && Array.isArray(item.days) ? item.days : [];
      if (!days.length) {
        return;
      }
      dropYear(MAP, year);
      const cloud = mapFromDays(days);
      Object.keys(cloud).forEach((date) => {
        MAP[date] = cloud[date];
      });
    });
  }
}

function emit() {
  listeners.slice().forEach((cb) => {
    try {
      cb();
    } catch (error) {
      console.warn("节假日刷新回调出错", error);
    }
  });
}

/** 同步读本地缓存，页面可以立刻渲染。 */
function init() {
  if (started) {
    return;
  }
  started = true;
  try {
    cache = wx.getStorageSync(CACHE_KEY) || null;
  } catch (error) {
    cache = null;
  }
  if (cache && cache.years) {
    remote = cache;
  }
  rebuild();
}

function ensure() {
  if (!started) {
    init();
  }
}

function applyRemote(payload) {
  if (!payload || !payload.years) {
    return;
  }
  remote = { years: payload.years, fetchedAt: Date.now() };
  started = true;
  rebuild();
}

function writeCache() {
  if (!remote) {
    return;
  }
  try {
    wx.setStorageSync(CACHE_KEY, remote);
  } catch (error) {
    // 存不下就算了，不影响这次使用
  }
}

function hasSchedule(year) {
  ensure();
  const prefix = `${year}-`;
  return Object.keys(MAP).some((date) => date.slice(0, 5) === prefix);
}

function holidayOf(date) {
  ensure();
  return MAP[date] || null;
}

/** 这一天所在的假期。跨年的假期把 crossYear 标出来，文案上就不用硬拼区间。 */
function spanOf(date) {
  const info = holidayOf(date);
  if (!info) {
    return null;
  }
  return {
    name: info.name,
    from: info.from,
    to: info.to,
    crossYear: info.from.slice(0, 4) !== info.to.slice(0, 4),
  };
}

/** 同一年、同一次假期里要上班的调休日（可能落在假期区间之外）。 */
function workdaysOf(name, year) {
  ensure();
  if (!name) {
    return [];
  }
  const prefix = year ? `${year}-` : "";
  return Object.keys(MAP)
    .filter(
      (date) =>
        MAP[date].type === "workday" &&
        MAP[date].name === name &&
        (!prefix || date.slice(0, 5) === prefix),
    )
    .sort();
}

/**
 * 这段时间里的假期起点和调休上班日。
 * 如果今天正落在假期中间，也补一条「放假中（到 X 月 X 日）」。
 */
function nextOffDays(from, to) {
  ensure();
  const items = [];
  eachDate(from, to, (date) => {
    const info = MAP[date];
    if (!info) {
      return;
    }
    if (info.type === "workday") {
      items.push({ date, type: "workday", name: info.name, from: info.from, to: info.to });
      return;
    }
    if (date === info.from) {
      items.push({ date, type: "holiday", name: info.name, from: info.from, to: info.to });
    } else if (date === from && info.from < from && info.to >= from) {
      items.push({ date, type: "holiday", name: info.name, from: info.from, to: info.to, ongoing: true });
    }
  });
  return items;
}

function solarFestival(month, day) {
  return SOLAR_FESTIVALS[`${month}-${day}`] || "";
}

function lunarFestival(month, day) {
  return LUNAR_FESTIVALS[`${month}-${day}`] || "";
}

/**
 * 这一天该显示哪个名字。优先级：法定假期 > 农历节日 > 阳历节日。
 * lunarInfo 传 solarToLunar() 的结果（要有 month / day / isLeap）。
 */
function dayLabel(date, lunarInfo) {
  const info = holidayOf(date);
  if (info) {
    return info.type === "workday" ? `${info.name}调休` : info.name;
  }
  if (lunarInfo && !lunarInfo.isLeap) {
    const lunarName = lunarFestival(lunarInfo.month, lunarInfo.day);
    if (lunarName) {
      return lunarName;
    }
  }
  const parts = String(date || "").split("-");
  return solarFestival(Number(parts[1]), Number(parts[2]));
}

function onChange(cb) {
  if (typeof cb === "function" && listeners.indexOf(cb) < 0) {
    listeners.push(cb);
  }
}

function offChange(cb) {
  listeners = listeners.filter((item) => item !== cb);
}

/** 没缓存、超过 7 天、或云端缺今年/明年的数据，就该去后台拉一次。 */
function shouldRefresh() {
  ensure();
  if (!remote || !remote.years) {
    return true;
  }
  if (Date.now() - (remote.fetchedAt || 0) > CACHE_TTL) {
    return true;
  }
  const year = new Date().getFullYear();
  return !remote.years[String(year)] || !remote.years[String(year + 1)];
}

/** 从云函数拿云数据库里那份；拿不到就继续用现在这份，不报错。 */
async function refresh(force) {
  ensure();
  if (!force && !shouldRefresh()) {
    return false;
  }
  let app = null;
  try {
    app = getApp();
  } catch (error) {
    app = null;
  }
  if (!app || typeof app.call !== "function") {
    return false;
  }
  const res = await app.call("getHolidays");
  if (!res || !res.ok || !res.years) {
    return false;
  }
  applyRemote(res);
  writeCache();
  emit();
  return true;
}

function lastSyncText() {
  ensure();
  const at = (remote && remote.fetchedAt) || 0;
  if (!at) {
    return "";
  }
  const date = new Date(at);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

module.exports = {
  CACHE_KEY,
  SOLAR_FESTIVALS,
  LUNAR_FESTIVALS,
  BUILTIN_SPANS,
  init,
  applyRemote,
  hasSchedule,
  holidayOf,
  spanOf,
  workdaysOf,
  nextOffDays,
  solarFestival,
  lunarFestival,
  dayLabel,
  onChange,
  offChange,
  shouldRefresh,
  refresh,
  lastSyncText,
};
