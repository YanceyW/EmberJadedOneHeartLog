Component({
  properties: {
    current: {
      type: String,
      value: "home",
    },
  },
  methods: {
    go(event) {
      const url = event.currentTarget.dataset.url;
      const name = event.currentTarget.dataset.name;
      if (name === this.data.current) {
        return;
      }
      wx.reLaunch({ url });
    },
  },
});
