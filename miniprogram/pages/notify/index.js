/** 每一项单独开关、单独攒额度。一次性订阅，一条授权换一条消息。 */
const subscribe = require("../../utils/subscribe");

const STATUS = { accept: "已允许", reject: "已拒绝", ban: "已禁止" };

Page({
  data: {
    rows: [],
    mainSwitch: true,
    loading: true,
  },

  onShow() {
    this.refresh();
  },

  async refresh() {
    const templates = await subscribe.preload();
    this.apply(templates);
    this.readSetting(templates);
  },

  apply(templates) {
    const rows = (templates || []).map((item) => ({
      key: item.key,
      name: item.name,
      enabled: item.enabled !== false,
      remain: item.remain || 0,
      ready: !!item.templateId,
      status: "还未询问",
    }));
    this.setData({ rows, loading: false });
  },

  /** 系统那边的授权状态，只有拿到模板 ID 才能对应上。 */
  readSetting(templates) {
    wx.getSetting({
      withSubscriptions: true,
      success: (res) => {
        const setting = res.subscriptionsSetting || {};
        const items = setting.itemSettings || {};
        const byKey = {};
        (templates || []).forEach((item) => {
          byKey[item.key] = item.templateId;
        });
        const rows = this.data.rows.map((row) => {
          const id = byKey[row.key];
          const value = id ? items[id] : "";
          return { ...row, status: STATUS[value] || "还未询问", allowed: value === "accept" };
        });
        this.setData({ rows, mainSwitch: setting.mainSwitch !== false });
      },
    });
  },

  async onToggle(event) {
    const key = event.currentTarget.dataset.key;
    const row = this.data.rows.find((item) => item.key === key);
    if (!row) {
      return;
    }
    const templates = await subscribe.setEnabled(key, !row.enabled);
    this.apply(templates);
    this.readSetting(templates);
  },

  async onAdd(event) {
    const key = event.currentTarget.dataset.key;
    const row = this.data.rows.find((item) => item.key === key);
    if (!row) {
      return;
    }
    if (!row.ready) {
      wx.showToast({ title: "这个模板还没配好", icon: "none" });
      return;
    }
    if (!row.enabled) {
      wx.showToast({ title: "先打开这一项", icon: "none" });
      return;
    }
    const accepted = await subscribe.request([key]);
    await this.refresh();
    wx.showToast({
      title: accepted.length ? "已经加了 1 条" : "没有加上，可能被拒绝或总开关关着",
      icon: "none",
    });
  },

  async openWechatSetting() {
    await subscribe.openSettings();
    this.refresh();
  },

  /** 试发一条，用真实模板核对 ID 和关键词，配错了这里能直接看到原因。 */
  async onTry(event) {
    const key = event.currentTarget.dataset.key;
    const row = this.data.rows.find((item) => item.key === key);
    if (!row) {
      return;
    }
    if (!row.ready) {
      wx.showToast({ title: "这个模板还没配好", icon: "none" });
      return;
    }
    if (!row.remain) {
      wx.showToast({ title: "先点 +1 攒一条", icon: "none" });
      return;
    }
    const result = await getApp().call("testPush", { key });
    if (!result.ok) {
      wx.showModal({
        title: "没发出去",
        content: result.message || "未知原因",
        showCancel: false,
      });
      return;
    }
    this.apply(subscribe.list());
    this.readSetting(subscribe.list());
    wx.showToast({ title: "已经发出，去微信看看", icon: "none" });
  },
});
