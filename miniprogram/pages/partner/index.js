const app = getApp();

Page({
  data: {
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
    const partner = result.partner;
    let partnerText = "还没有对象";
    if (partner && result.mutual) {
      partnerText = `已和 ${partner.nickName || "未命名"} 互为对象`;
    } else if (partner) {
      partnerText = `已选择 ${partner.nickName || "未命名"}，等待对方确认`;
    }
    const people = await app.call("listPeople");
    this.setData({
      partnerText,
      chosenOpenid: result.user.chosenOpenid,
      people: people.ok ? people.people : [],
    });
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
