/**
 * 底部 tab bar 占用高度。和 components/tab-bar 的尺寸保持一致。
 */

const watchers = [];
const EDGE_RPX = 32;

function rpxToPx(rpx, windowWidth) {
  const width = windowWidth || wx.getSystemInfoSync().windowWidth || 375;
  return (Number(rpx) / 750) * width;
}

function readWindow() {
  return wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
}

/**
 * 底栏到屏幕下/左/右三边的统一间距（px）。
 * 取 32rpx 与底部安全区较大值，保证各机型三边相同且不压到 Home 条。
 * @returns {number}
 */
function tabEdgeGap() {
  const info = readWindow();
  const windowWidth = info.windowWidth || 375;
  const windowHeight = info.windowHeight || 667;
  let safeBottom = 0;
  if (info.safeAreaInsets && typeof info.safeAreaInsets.bottom === "number") {
    safeBottom = Math.max(0, info.safeAreaInsets.bottom);
  } else if (info.safeArea && typeof info.safeArea.bottom === "number") {
    safeBottom = Math.max(0, windowHeight - info.safeArea.bottom);
  }
  return Math.ceil(Math.max(rpxToPx(EDGE_RPX, windowWidth), safeBottom));
}

/**
 * 按 tab bar 的 CSS 尺寸估算内容区需要的底部留白（px）。
 * @returns {number}
 */
function estimateTabClearance() {
  const info = readWindow();
  const windowWidth = info.windowWidth || 375;
  const bottomGap = tabEdgeGap();
  const barHeight = rpxToPx(88, windowWidth);
  const aiRise = rpxToPx(36, windowWidth);
  return Math.ceil(bottomGap + barHeight + aiRise + 16);
}

/**
 * 用实测的 bar 或 AI 圆上沿校正留白。
 * @param {number} top 元素顶部相对窗口的 y
 * @returns {number}
 */
function clearanceFromTop(top) {
  const info = readWindow();
  const windowHeight = info.windowHeight || 667;
  if (typeof top !== "number" || !(top >= 0)) {
    return estimateTabClearance();
  }
  return Math.ceil(Math.max(0, windowHeight - top) + 16);
}

/**
 * 写入全局 tabClearance，并通知订阅者。
 * @param {number} value
 */
function setTabClearance(value) {
  const app = getApp();
  const next = Math.max(80, Math.ceil(Number(value) || estimateTabClearance()));
  if (!app.globalData) {
    app.globalData = {};
  }
  if (app.globalData.tabClearance === next) {
    return next;
  }
  app.globalData.tabClearance = next;
  watchers.slice().forEach((fn) => {
    try {
      fn(next);
    } catch (error) {
      console.error("更新底部留白失败", error);
    }
  });
  return next;
}

/**
 * 读取当前留白；没有时先估算并写入。
 * @returns {number}
 */
function getTabClearance() {
  const app = getApp();
  if (app.globalData && app.globalData.tabClearance) {
    return app.globalData.tabClearance;
  }
  return setTabClearance(estimateTabClearance());
}

/**
 * 订阅底部留白变化。返回取消订阅函数。
 * @param {(value: number) => void} fn
 * @returns {() => void}
 */
function watchTabClearance(fn) {
  if (typeof fn !== "function") {
    return () => {};
  }
  watchers.push(fn);
  return () => {
    const index = watchers.indexOf(fn);
    if (index >= 0) {
      watchers.splice(index, 1);
    }
  };
}

module.exports = {
  rpxToPx,
  tabEdgeGap,
  estimateTabClearance,
  clearanceFromTop,
  setTabClearance,
  getTabClearance,
  watchTabClearance,
};
