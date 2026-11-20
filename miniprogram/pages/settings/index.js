/** 已经用到的权限集中在这里查看。拒绝后不能再自动弹窗，只能从这里打开。 */
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
  },

  onShow() {
    this.refresh();
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
});
