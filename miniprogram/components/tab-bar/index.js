Component({
  properties: {
    current: {
      type: Number,
      value: 0,
    },
  },
  methods: {
    go(event) {
      const index = Number(event.currentTarget.dataset.index);
      if (index === this.data.current) {
        return;
      }
      this.triggerEvent("change", { index });
    },
  },
});
