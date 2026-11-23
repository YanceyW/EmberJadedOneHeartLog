const {
  clearanceFromTop,
  estimateTabClearance,
  getTabClearance,
  rpxToPx,
  setTabClearance,
  tabEdgeGap,
} = require("../../utils/layout");

Component({
  properties: {
    // swiper 页码：0 首页 / 1 日历 / 2 AI / 3 记录 / 4 我
    current: {
      type: Number,
      value: 0,
    },
  },
  data: {
    slot: 0,
    showSlider: true,
    edgeGap: 16,
  },
  observers: {
    current(value) {
      const index = Number(value);
      if (index === 2) {
        this.setData({ showSlider: false, slot: 2 });
        return;
      }
      this.setData({ showSlider: true, slot: index });
    },
  },
  lifetimes: {
    attached() {
      this.setData({ edgeGap: tabEdgeGap() });
    },
    ready() {
      this.setData({ edgeGap: tabEdgeGap() });
      setTabClearance(estimateTabClearance());
      this.measureClearance();
    },
  },
  pageLifetimes: {
    show() {
      this.setData({ edgeGap: tabEdgeGap() });
      this.measureClearance();
    },
  },
  methods: {
    measureClearance() {
      const run = () => {
        const query = this.createSelectorQuery();
        query.select(".ai").boundingClientRect();
        query.select(".bar").boundingClientRect();
        query.exec((parts) => {
          const ai = parts && parts[0];
          const bar = parts && parts[1];
          if (ai && typeof ai.top === "number") {
            setTabClearance(clearanceFromTop(ai.top));
            return;
          }
          if (bar && typeof bar.top === "number") {
            const rise = rpxToPx(36);
            setTabClearance(clearanceFromTop(bar.top - rise));
            return;
          }
          setTabClearance(getTabClearance() || estimateTabClearance());
        });
      };
      if (typeof wx.nextTick === "function") {
        wx.nextTick(run);
      } else {
        setTimeout(run, 0);
      }
    },

    go(event) {
      const index = Number(event.currentTarget.dataset.index);
      if (index === Number(this.data.current)) {
        return;
      }
      this.triggerEvent("change", { index });
    },

    openAsk() {
      if (Number(this.data.current) === 2) {
        return;
      }
      this.triggerEvent("ask");
    },
  },
});
