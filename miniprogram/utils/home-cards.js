/**
 * 首页卡片。每人一份，存本机（和 weather-city、filter 一样，不同步到云端）。
 * 存的是 { list: [可见的 key], removed: [主动删掉的 key] }：
 * removed 用来记住"是我不要的"，这样以后新增卡片类型时不会被强行加回来。
 */
const CARDS = [
  { key: "hello", name: "问候", desc: "问候语和今天的日期" },
  { key: "lesson", name: "今天的课", desc: "现在上什么课、今天还剩几节" },
  { key: "weather", name: "天气", desc: "天气、逐时预报和穿衣建议" },
  { key: "note", name: "对方的留言", desc: "TA 留给你的一句话" },
  { key: "ai", name: "今日建议", desc: "按生日生成的每日建议" },
  { key: "remind", name: "生活提醒", desc: "没有今日建议时的那条提醒" },
  { key: "next", name: "临近安排", desc: "最近一项日程或纪念日" },
];

const DEFAULT_ORDER = CARDS.map((item) => item.key);

function storageKey(openid) {
  return `home-cards:${openid || "guest"}`;
}

function isKnown(key) {
  return DEFAULT_ORDER.indexOf(key) >= 0;
}

/**
 * 归一化：丢掉不认识的、去重；removed 记着的不要；
 * 新版本新增的卡片类型自动补到末尾（除非用户删过）。
 */
function normalize(value) {
  const raw = value && typeof value === "object" ? value : {};
  const list = Array.isArray(raw.list) ? raw.list : Array.isArray(value) ? value : null;
  const removed = Array.isArray(raw.removed) ? raw.removed.filter(isKnown) : [];
  const kept = [];
  (list || DEFAULT_ORDER).forEach((key) => {
    if (isKnown(key) && kept.indexOf(key) < 0 && kept.length < CARDS.length) {
      kept.push(key);
    }
  });
  DEFAULT_ORDER.forEach((key) => {
    if (kept.indexOf(key) < 0 && removed.indexOf(key) < 0) {
      kept.push(key);
    }
  });
  return { list: kept, removed: removed.filter((key) => kept.indexOf(key) < 0) };
}

function load(openid) {
  try {
    const stored = wx.getStorageSync(storageKey(openid));
    return normalize(stored);
  } catch (error) {
    return normalize(null);
  }
}

function save(openid, value) {
  const next = normalize(value);
  try {
    wx.setStorageSync(storageKey(openid), next);
  } catch (error) {
    // 存不进去也不影响这次使用
  }
  return next;
}

/** 从列表里删一张，并记住是主动删的。 */
function removeCard(value, key) {
  const next = normalize(value);
  return {
    list: next.list.filter((item) => item !== key),
    removed: next.removed.indexOf(key) < 0 ? next.removed.concat(key) : next.removed,
  };
}

/** 加回一张（同时从 removed 里划掉）。 */
function addCard(value, key) {
  const next = normalize(value);
  if (next.list.indexOf(key) >= 0) {
    return next;
  }
  return {
    list: next.list.concat(key),
    removed: next.removed.filter((item) => item !== key),
  };
}

/** 把第 from 张挪到第 to 张。 */
function moveCard(value, from, to) {
  const next = normalize(value);
  const list = next.list.slice();
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) {
    return next;
  }
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  return { list, removed: next.removed };
}

function reset() {
  return normalize(null);
}

/** 设置页和编辑态里展示用：带上名称和说明。 */
function describe(list) {
  return list
    .map((key) => CARDS.find((item) => item.key === key))
    .filter(Boolean);
}

function hidden(value) {
  const next = normalize(value);
  return CARDS.filter((item) => next.list.indexOf(item.key) < 0);
}

module.exports = {
  CARDS,
  DEFAULT_ORDER,
  normalize,
  load,
  save,
  removeCard,
  addCard,
  moveCard,
  reset,
  describe,
  hidden,
};
