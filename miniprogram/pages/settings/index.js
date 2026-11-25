/** 已经用到的权限、订阅提醒和清空数据集中在这里。拒绝后不能再自动弹窗，只能从这里打开。 */
const app = getApp();
const subscribe = require("../../utils/subscribe");

const ITEMS = [
  {
    scope: "scope.userLocation",
    name: "位置权限",
    desc: "查询当地天气。坐标不保存，也不给对方看",
  },
];

Page({
  data: {
    items: [],
    notifySummary: "看看还剩几条额度",
  },

  onShow() {
    this.refresh();
    this.loadNotify();
  },

  async loadNotify() {
    const templates = await subscribe.preload();
    if (!templates.length) {
      this.setData({ notifySummary: "看看还剩几条额度" });
      return;
    }
    const on = templates.filter((item) => item.enabled !== false);
    const remain = on.reduce((sum, item) => sum + (item.remain || 0), 0);
    this.setData({ notifySummary: `${on.length} 项开着 · 还剩 ${remain} 条额度` });
  },

  openNotify() {
    wx.navigateTo({ url: "/pages/notify/index" });
  },

  refresh() {
    wx.getSetting({
      success: (res) => {
        const auth = res.authSetting || {};
        this.setData({
          items: ITEMS.map((item) => ({
            ...item,
            status: this.statusText(auth[item.scope]),
            granted: auth[item.scope] === true,
          })),
        });
      },
    });
  },

  statusText(value) {
    if (value === true) return "已允许";
    if (value === false) return "已拒绝";
    return "还未询问";
  },

  onItem(event) {
    const scope = event.currentTarget.dataset.scope;
    wx.getSetting({
      success: (res) => {
        const current = (res.authSetting || {})[scope];
        if (current === false) {
          wx.openSetting({ complete: () => this.refresh() });
          return;
        }
        if (current === true) {
          wx.openSetting({ complete: () => this.refresh() });
          return;
        }
        wx.authorize({
          scope,
          complete: () => this.refresh(),
        });
      },
    });
  },

  askClearData() {
    wx.showModal({
      title: "清空我的数据",
      content: "会删除你自己的记录、留言和聊天记录。对象关系和资料保留，删了不能恢复。",
      cancelText: "取消",
      confirmText: "继续",
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        this.confirmClear();
      },
    });
  },

  confirmClear() {
    wx.showModal({
      title: "再确认一次",
      editable: true,
      placeholderText: "输入「清空」两个字",
      cancelText: "取消",
      confirmText: "确认清空",
      confirmColor: "#c0555f",
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        if (res.content !== undefined && String(res.content).trim() !== "清空") {
          wx.showToast({ title: "没有输入「清空」，已取消", icon: "none" });
          return;
        }
        this.clearMyData();
      },
    });
  },

  async clearMyData() {
    const result = await app.call("clearMyData");
    if (!result.ok) {
      wx.showToast({ title: result.message, icon: "none" });
      return;
    }
    app.globalData.session = result;
    wx.removeStorageSync("reading-cache");
    wx.showToast({ title: "已清空", icon: "none" });
  },
});
