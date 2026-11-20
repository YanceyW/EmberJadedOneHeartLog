const app = getApp();

Page({
  data: {
    nickName: "",
    gender: "",
    cycleLength: 28,
    periodLength: 5,
    partnerCycleLength: 28,
    partnerPeriodLength: 5,
    showOwnCycle: false,
    showPartnerCycle: false,
    partnerText: "还没有对象",
    people: [],
    chosenOpenid: "",
  },

  onShow() {
    this.load();
  },

  async load() {
    const result = await app.loadSession(true);
    if (!result.ok) {
      wx.showToast({ title: result.message, icon: "none" });
      return;
    }
    const user = result.user;
    const partner = result.partner;
    let partnerText = "还没有对象";
    if (partner && result.mutual) {
      partnerText = `已和 ${partner.nickName || "未命名"} 互为对象`;
    } else if (partner) {
      partnerText = `已选择 ${partner.nickName || "未命名"}，等待对方确认`;
    }
    this.setData({
      nickName: user.nickName,
      gender: user.gender,
      cycleLength: user.cycleLength,
      periodLength: user.periodLength,
      showOwnCycle: user.gender === "female",
      showPartnerCycle: user.gender === "male" && result.mutual && partner && partner.gender === "female",
      partnerCycleLength: partner ? partner.cycleLength : 28,
      partnerPeriodLength: partner ? partner.periodLength : 5,
      partnerText,
      chosenOpenid: user.chosenOpenid,
    });
    const people = await app.call("listPeople");
    if (people.ok) {
      this.setData({ people: people.people });
    }
  },

  onNick(event) {
    this.setData({ nickName: event.detail.value });
  },

  onGender(event) {
    const gender = event.currentTarget.dataset.gender;
    this.setData({ gender, showOwnCycle: gender === "female" });
  },

  onCycle(event) {
    this.setData({ cycleLength: event.detail.value });
  },

  onPeriod(event) {
    this.setData({ periodLength: event.detail.value });
  },

  onPartnerCycle(event) {
    this.setData({ partnerCycleLength: event.detail.value });
  },

  onPartnerPeriod(event) {
    this.setData({ partnerPeriodLength: event.detail.value });
  },

  async saveProfile() {
    const result = await app.call("saveProfile", {
      nickName: this.data.nickName,
      gender: this.data.gender,
      cycleLength: this.data.cycleLength,
      periodLength: this.data.periodLength,
    });
    if (!result.ok) {
      wx.showToast({ title: result.message, icon: "none" });
      return;
    }
    app.globalData.session = result;
    if (this.data.showPartnerCycle) {
      const partnerResult = await app.call("savePartnerCycle", {
        cycleLength: this.data.partnerCycleLength,
        periodLength: this.data.partnerPeriodLength,
      });
      if (!partnerResult.ok) {
        wx.showToast({ title: partnerResult.message, icon: "none" });
        return;
      }
      app.globalData.session = partnerResult;
    }
    wx.showToast({ title: "已保存" });
    this.load();
  },

  async choose(event) {
    const result = await app.call("choosePartner", { targetOpenid: event.currentTarget.dataset.openid });
    if (!result.ok) {
      wx.showToast({ title: result.message, icon: "none" });
      return;
    }
    app.globalData.session = result;
    this.load();
  },

  openSettings() {
    wx.navigateTo({ url: "/pages/settings/index" });
  },

  async clearPartner() {
    const result = await app.call("clearPartner");
    if (!result.ok) {
      wx.showToast({ title: result.message, icon: "none" });
      return;
    }
    app.globalData.session = result;
    this.load();
  },
});
