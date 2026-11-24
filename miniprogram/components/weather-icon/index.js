const KINDS = ["sun", "cloud", "rain", "snow", "fog", "storm"];

/** 天色一变，同样的天气换个画法：夜里出月亮，日出日落是半落的太阳。 */
const TONED = {
  sun: { night: "moon", dawn: "sunrise", dusk: "sunset" },
  cloud: { night: "cloudmoon" },
};

Component({
  properties: {
    kind: {
      type: String,
      value: "cloud",
    },
    tone: {
      type: String,
      value: "",
    },
    size: {
      type: Number,
      value: 36,
    },
  },
  data: {
    shape: "cloud",
  },
  observers: {
    kind(value) {
      this.pickShape(value, this.data.tone);
    },
    tone(value) {
      this.pickShape(this.data.kind, value);
    },
  },
  lifetimes: {
    attached() {
      this.pickShape(this.data.kind, this.data.tone);
    },
  },
  methods: {
    pickShape(kind, tone) {
      const base = KINDS.indexOf(kind) >= 0 ? kind : "cloud";
      const toned = TONED[base];
      const shape = (toned && toned[tone]) || base;
      if (shape !== this.data.shape) this.setData({ shape });
    },
  },
});
