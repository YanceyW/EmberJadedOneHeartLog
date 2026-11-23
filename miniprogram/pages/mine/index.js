const app = getApp();
const { getTabClearance, watchTabClearance } = require("../../utils/layout");

Component({
  data: {
    nickName: "未命名",
    partnerText: "还没有对象",
    later: ["时间日志", "相册", "时光胶囊", "年度回顾", "足迹", "心愿单", "共同菜单"],
    tabClearance: 120,
  },
  lifetimes: {
    attached() {
      this.setData({ tabClearance: getTabClearance() });
      this.unwatchClearance = watchTabClearance((value) => {
        this.setData({ tabClearance: value });
      });
    },
    detached() {
      if (this.unwatchClearance) {
        this.unwatchClearance();
        this.unwatchClearance = null;
      }
    },
  },
  pageLifetimes: {
    show() {
      this.setData({ tabClearance: getTabClearance() });
      this.load();
    },
  },
  methods: {
    async load() {
      const result = await app.loadSession(true);
      if (!result.ok) {
        wx.showToast({ title: result.message, icon: "none" });
        return;
      }
      const partner = result.partner;
      let partnerText = "还没有对象";
      if (partner && result.mutual) {
        partnerText = `已和 ${partner.nickName || "未命名"} 互为对象`;
      } else if (partner) {
        partnerText = `已选择 ${partner.nickName || "未命名"}，等待对方确认`;
      }
      this.setData({
        nickName: result.user.nickName || "未命名",
        partnerText,
      });
    },

    openProfile() {
      wx.navigateTo({ url: "/pages/profile/index" });
    },

    openPermissions() {
      wx.navigateTo({ url: "/pages/settings/index" });
    },

    openSoon(event) {
      const name = event.currentTarget.dataset.name;
      wx.navigateTo({ url: `/pages/soon/index?name=${encodeURIComponent(name)}` });
    },
  },
});
