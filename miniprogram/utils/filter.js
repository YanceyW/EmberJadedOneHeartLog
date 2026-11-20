/** 月历筛选只存在本机，并按微信 openid 分开，避免同一台手机上的两个人互相覆盖。 */

const DEFAULT_FILTER = {
  period: true,
  fertile: true,
  anniversary: true,
  schedule: true,
};

function storageKey(openid) {
  return `calendar-filter:${openid || "local"}`;
}

function loadFilter(openid) {
  try {
    const saved = wx.getStorageSync(storageKey(openid));
    if (saved && typeof saved === "object") {
      return { ...DEFAULT_FILTER, ...saved };
    }
  } catch (error) {
    console.error("读取月历筛选失败", error);
  }
  return { ...DEFAULT_FILTER };
}

function saveFilter(openid, filter) {
  try {
    wx.setStorageSync(storageKey(openid), filter);
  } catch (error) {
    console.error("保存月历筛选失败", error);
  }
}

module.exports = {
  DEFAULT_FILTER,
  loadFilter,
  saveFilter,
};
