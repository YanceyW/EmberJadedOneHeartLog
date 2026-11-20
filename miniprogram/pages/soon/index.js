Page({
  data: {
    name: "",
  },

  onLoad(query) {
    const name = decodeURIComponent(query.name || "施工中");
    this.setData({ name });
    wx.setNavigationBarTitle({ title: name });
  },
});
