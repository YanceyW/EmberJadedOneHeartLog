Page({
  data: {
    current: 0,
  },

  onChange(event) {
    const next = event.detail.current;
    if (next === this.data.current) return;
    this.setData({ current: next });
  },

  onTab(event) {
    this.setData({ current: Number(event.detail.index) });
  },

  openAsk() {
    this.setData({ current: 2 });
  },
});
