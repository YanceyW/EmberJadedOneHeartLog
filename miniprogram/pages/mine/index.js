const app = getApp();
const { getTabClearance, watchTabClearance } = require("../../utils/layout");
const { addDays, todayString } = require("../../utils/date");
const { defaultRemind } = require("../../utils/remind");
const subscribe = require("../../utils/subscribe");

const SEGS = [
  { key: "album", name: "相册", hint: "相册还没开始做，等这一版骨架定了再填" },
  { key: "capsule", name: "时光胶囊", hint: "把一段话封存给以后的你们" },
  { key: "footprint", name: "足迹", hint: "一起去过的地方会记在这里，还没做" },
  { key: "review", name: "年度回顾", hint: "一年结束时生成一张总结卡，还没做" },
];

Component({
  data: {
    nickName: "未命名",
    initial: "我",
    partnerText: "还没有对象",
    segs: SEGS,
    seg: "album",
    segHint: SEGS[0].hint,
    capsules: [],
    capOpen: false,
    cf: null,
    capView: null,
    capRemindDate: "",
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
        partnerText = `已选 ${partner.nickName || "未命名"}，等对方确认`;
      }
      const nickName = result.user.nickName || "未命名";
      this.setData({
        nickName,
        initial: nickName.slice(0, 1),
        partnerText,
        capsules: result.capsules || [],
      });
    },

    pickSeg(event) {
      const key = event.currentTarget.dataset.key;
      const found = SEGS.find((item) => item.key === key);
      if (!found) {
        return;
      }
      this.setData({ seg: key, segHint: found.hint });
    },

    openProfile() {
      wx.navigateTo({ url: "/pages/profile/index" });
    },

    openSettings() {
      wx.navigateTo({ url: "/pages/settings/index" });
    },

    noop() {},
    openCapsuleNew() {
      const openAt = addDays(todayString(), 365);
      this.setData({
        capOpen: true,
        capView: null,
        capRemindDate: openAt,
        cf: { title: "", content: "", openAt, visibility: "both", remind: defaultRemind(0) },
      });
    },

    closeCap() {
      this.setData({ capOpen: false, cf: null, capView: null });
    },

    openCapsuleItem(event) {
      const id = event.currentTarget.dataset.id;
      const found = (this.data.capsules || []).find((item) => item.id === id);
      if (!found) {
        return;
      }
      if (!found.due) {
        wx.showToast({ title: `还有 ${found.daysLeft} 天才能打开`, icon: "none" });
        return;
      }
      app.call("openCapsule", { id }).then((result) => {
        if (!result.ok) {
          wx.showToast({ title: result.message, icon: "none" });
          return;
        }
        this.setData({ capOpen: true, cf: null, capView: { title: found.title, content: result.content } });
      });
    },

    onCapTitle(event) {
      this.setData({ "cf.title": event.detail.value });
    },

    onCapContent(event) {
      this.setData({ "cf.content": event.detail.value });
    },

    onCapVisibility(event) {
      this.setData({ "cf.visibility": event.currentTarget.dataset.value });
    },

    onCapDate(event) {
      const openAt = event.detail.value;
      this.setData({ "cf.openAt": openAt, capRemindDate: openAt });
    },

    onCapRemind(event) {
      this.setData({ "cf.remind": event.detail });
    },

    saveCapsule() {
      const form = this.data.cf;
      if (!form) {
        return;
      }
      // 订阅要在这个点击回调里同步发起，落库之后再看结果
      const asked = subscribe.request(["capsule"]);
      this.writeCapsule(form, asked);
    },

    async writeCapsule(form, asked) {
      const result = await app.call("saveCapsule", form);
      if (asked) {
        await asked;
      }
      if (!result.ok) {
        wx.showToast({ title: result.message, icon: "none" });
        return;
      }
      app.globalData.session = result;
      this.setData({ capOpen: false, cf: null, capsules: result.capsules || [] });
      wx.showToast({ title: "已封存", icon: "none" });
    },

    deleteCapsuleItem(event) {
      const id = event.currentTarget.dataset.id;
      wx.showModal({
        title: "要销毁吗",
        content: "这个胶囊和里面的内容都会删掉，删了不能恢复",
        confirmColor: "#c0555f",
        success: async (res) => {
          if (!res.confirm) {
            return;
          }
          const result = await app.call("deleteCapsule", { id });
          if (!result.ok) {
            wx.showToast({ title: result.message, icon: "none" });
            return;
          }
          app.globalData.session = result;
          this.setData({ capsules: result.capsules || [] });
        },
      });
    },
  },
});
