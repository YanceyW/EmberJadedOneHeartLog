// 小程序入口。云环境只在这里初始化一次。
const { estimateTabClearance } = require("./utils/layout");

App({
  globalData: {
    env: "ydsglog-d0gvifdry2da871a2",
    session: null,
    tabClearance: 120,
  },

  onLaunch() {
    this.globalData.tabClearance = estimateTabClearance();
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
      return;
    }
    wx.cloud.init({
      env: this.globalData.env,
      traceUser: true,
    });
  },

  /**
   * 调用云函数 api。
   * @param {string} action 操作名
   * @param {object} data 业务参数
   * @returns {Promise<object>}
   */
  async call(action, data = {}) {
    try {
      const res = await wx.cloud.callFunction({
        name: "api",
        data: { action, ...data },
      });
      const result = res.result || { ok: false, message: "没有返回结果" };
      if (!result.ok) {
        console.error("云函数业务失败", action, result.message);
      }
      return result;
    } catch (error) {
      console.error("云函数调用失败", action, error);
      const detail = String((error && (error.errMsg || error.message)) || error || "");
      const message = /timeout|Failed to fetch|404012/i.test(detail)
        ? "网络超时，请再试一次"
        : "云函数还没部署，或网络不可用";
      return { ok: false, message };
    }
  },

  /**
   * 读取当前用户、对象和日历数据。force 为 true 时忽略缓存。
   * @param {boolean} force
   */
  async loadSession(force) {
    if (this.globalData.session && !force) {
      return this.globalData.session;
    }
    const result = await this.call("session");
    if (result.ok) {
      this.globalData.session = result;
    }
    return result;
  },

  clearSession() {
    this.globalData.session = null;
  },
});
