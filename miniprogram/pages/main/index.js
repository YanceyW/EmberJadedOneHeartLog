function between(min, max) {
  return min + Math.random() * (max - min);
}

function makeSky(windy) {
  const drops = [];
  for (let index = 0; index < 16; index += 1) {
    const drift = windy ? between(50, 190) : between(-30, 42);
    drops.push({
      id: index,
      left: `${between(-4, 96).toFixed(1)}%`,
      delay: `${between(0, 4.5).toFixed(2)}s`,
      duration: `${between(windy ? 1.1 : 1.5, windy ? 2.4 : 3.6).toFixed(2)}s`,
      width: `${between(2, 5).toFixed(1)}rpx`,
      length: `${between(26, 72).toFixed(0)}rpx`,
      size: `${between(8, 18).toFixed(0)}rpx`,
      opacity: between(0.4, 0.9).toFixed(2),
      drift: `${drift.toFixed(0)}rpx`,
      sway: `${between(-36, 36).toFixed(0)}rpx`,
      tilt: `${between(-16, 10).toFixed(0)}deg`,
    });
  }
  const clouds = [];
  for (let index = 0; index < 4; index += 1) {
    clouds.push({
      id: index,
      top: `${between(4, 58).toFixed(0)}%`,
      width: `${between(100, 240).toFixed(0)}rpx`,
      height: `${between(40, 86).toFixed(0)}rpx`,
      delay: `${between(0, 10).toFixed(1)}s`,
      duration: `${between(16, 34).toFixed(1)}s`,
      opacity: between(0.5, 0.9).toFixed(2),
    });
  }
  const gusts = [];
  for (let index = 0; index < 5; index += 1) {
    gusts.push({
      id: index,
      top: `${between(8, 78).toFixed(0)}%`,
      width: `${between(72, 128).toFixed(0)}rpx`,
      height: `${between(16, 28).toFixed(0)}rpx`,
      delay: `${between(0, 5).toFixed(2)}s`,
      duration: `${between(5.5, 8.5).toFixed(2)}s`,
      lift: `${between(-10, 14).toFixed(0)}vh`,
      tilt: `${between(8, 18).toFixed(0)}deg`,
    });
  }
  const colors = ["#8a9a62", "#c4a24a", "#c46a55", "#6d8c4a", "#d08a3a"];
  const leaves = [];
  for (let index = 0; index < 6; index += 1) {
    leaves.push({
      id: index,
      top: `${between(6, 78).toFixed(0)}%`,
      delay: `${between(0, 4).toFixed(2)}s`,
      duration: `${between(6.4, 11.5).toFixed(2)}s`,
      size: `${between(12, 28).toFixed(0)}rpx`,
      drop: `${between(8, 28).toFixed(0)}vh`,
      spin: `${between(140, 480).toFixed(0)}deg`,
      color: colors[index % colors.length],
    });
  }
  return { drops, clouds, leaves, gusts };
}

Page({
  data: {
    // 0 首页 / 1 日历 / 2 AI / 3 记录 / 4 我
    current: 0,
    weatherKind: "",
    windy: false,
    heavy: false,
    weatherOn: true,
    drops: [],
    clouds: [],
    leaves: [],
    gusts: [],
  },

  onLoad() {
    this.setData(makeSky(false));
  },

  onShow() {
    this.setData({ weatherOn: true });
  },

  onHide() {
    this.setData({ weatherOn: false });
  },

  onChange(event) {
    this.setData({ current: event.detail.current });
  },

  onTab(event) {
    this.setData({ current: Number(event.detail.index) });
  },

  openAsk() {
    this.setData({ current: 2 });
  },

  onWeather(event) {
    const windy = !!event.detail.windy;
    this.setData(Object.assign({
      weatherKind: event.detail.kind || "",
      windy,
      heavy: !!event.detail.heavy,
    }, makeSky(windy)));
  },
});

