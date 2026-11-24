/**
 * 量出当前面板里卡片或月历的整块矩形，交给主页面。
 * 滚动时立刻量，不再隔一段时间才跟上。
 */
module.exports = Behavior({
  properties: {
    hit: {
      type: String,
      value: "",
    },
    edgeSelector: {
      type: String,
      value: ".card",
    },
    circleSelector: {
      type: String,
      value: "",
    },
    edgePill: {
      type: Boolean,
      value: false,
    },
    edgeShelf: {
      type: Boolean,
      value: true,
    },
    coverSelector: {
      type: String,
      value: "",
    },
  },

  observers: {
    hit() {
      this.readEdges();
    },
  },

  lifetimes: {
    attached() {
      this.readEdges();
    },
    detached() {
      this.edgeQuery = false;
      this.edgeAgain = false;
    },
  },

  pageLifetimes: {
    show() {
      this.readEdges();
    },
  },

  methods: {
    readEdges() {
      if (!this.data.hit) return;
      if (this.edgeQuery) {
        this.edgeAgain = true;
        return;
      }
      this.edgeQuery = true;
      const selector = this.data.edgeSelector || ".card";
      const coverSelector = this.data.coverSelector || "";
      const circleSelector = this.data.circleSelector || "";
      const overlaySelector = ".mask, .sheet, .pop, .filter-mask, .filter-pop, .sheet-mask";
      const info = wx.getWindowInfo ? wx.getWindowInfo() : { windowHeight: 800, windowWidth: 375 };
      const viewHeight = info.windowHeight || 800;
      const viewWidth = info.windowWidth || 375;
      const query = this.createSelectorQuery();
      query.selectAll(selector).boundingClientRect();
      query.selectAll(overlaySelector).boundingClientRect();
      if (coverSelector) query.selectAll(coverSelector).boundingClientRect();
      if (circleSelector) query.select(circleSelector).boundingClientRect();
      query.exec((res) => {
        this.edgeQuery = false;
        let cursor = 0;
        const found = (res && res[cursor]) || [];
        cursor += 1;
        const overlays = (res && res[cursor]) || [];
        cursor += 1;
        const covers = coverSelector ? (res && res[cursor]) || [] : [];
        if (coverSelector) cursor += 1;
        const circleRect = circleSelector ? res && res[cursor] : null;
        const circle = circleRect && circleRect.width ? {
          cx: circleRect.left + circleRect.width / 2,
          cy: circleRect.top + circleRect.height / 2,
          r: circleRect.width / 2,
        } : null;
        const list = [];
        let seen = 0;
        const pushRect = (rect, shelf) => {
          if (!rect || rect.width < 8 || !rect.height) return;
          seen += 1;
          const right = rect.right === undefined ? rect.left + rect.width : rect.right;
          const bottom = rect.bottom === undefined ? rect.top + rect.height : rect.bottom;
          if (bottom <= 0 || rect.top >= viewHeight) return;
          if (right <= 0 || rect.left >= viewWidth) return;
          const cardRadius = Math.round(viewWidth / 750 * 32);
          const topOnScreen = rect.top >= -2 && rect.top <= viewHeight - 10;
          const pill = !!(shelf && this.data.edgePill);
          list.push({
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            pill,
            shelf: !!(shelf && this.data.edgeShelf !== false && topOnScreen),
            radius: pill ? Math.min(rect.width, rect.height) / 2 : cardRadius,
            circle: shelf ? circle : null,
          });
        };
        for (let index = 0; index < found.length; index += 1) pushRect(found[index], true);
        for (let index = 0; index < overlays.length; index += 1) pushRect(overlays[index], false);
        for (let index = 0; index < covers.length; index += 1) pushRect(covers[index], false);
        if (!seen) {
          this.edgeMiss = (this.edgeMiss || 0) + 1;
          if (this.edgeMiss < 8) setTimeout(() => this.readEdges(), 48);
          return;
        }
        this.edgeMiss = 0;
        this.triggerEvent("edges", { list });
        if (this.edgeAgain) {
          this.edgeAgain = false;
          this.readEdges();
        }
      });
    },

    /** 滚动时先按位移挪洞，停稳后再重新量，避免洞一跳一跳。 */
    onScroll(event) {
      const top = (event.detail && event.detail.scrollTop) || 0;
      if (this.scrollBase === undefined) this.scrollBase = top;
      this.liveScroll = top;
      this.triggerEvent("scrollshift", { delta: this.scrollBase - top });
      if (this.scrollTimer) clearTimeout(this.scrollTimer);
      this.scrollTimer = setTimeout(() => {
        this.scrollBase = this.liveScroll;
        this.readEdges();
      }, 90);
    },

    onSkyStart(event) {
      this.emitSky("start", event);
    },

    onSkyMove(event) {
      this.emitSky("move", event);
    },

    onSkyEnd() {
      this.triggerEvent("skytouch", { phase: "end" });
    },

    emitSky(phase, event) {
      const touch = event.touches && event.touches[0];
      if (!touch) return;
      this.triggerEvent("skytouch", {
        phase,
        x: touch.clientX,
        y: touch.clientY,
      });
    },
  },
});
