const { buildPicker, describe, fromPicker, normalizeRemind } = require("../../utils/remind");

Component({
  properties: {
    value: {
      type: null,
      value: null,
    },
    targetDate: {
      type: String,
      value: "",
    },
    hint: {
      type: String,
      value: "",
    },
  },
  data: {
    enabled: false,
    text: "不提醒",
    range: [[], [], []],
    dates: [],
    index: [0, 9, 0],
    ready: false,
  },
  observers: {
    "value, targetDate": function (value, targetDate) {
      this.refresh(value, targetDate);
    },
  },
  lifetimes: {
    attached() {
      this.refresh(this.data.value, this.data.targetDate);
    },
  },
  methods: {
    refresh(value, targetDate) {
      const remind = normalizeRemind(value);
      const built = buildPicker(remind, targetDate);
      this.remind = remind;
      this.target = built.target;
      this.setData({
        enabled: remind.enabled,
        text: describe(remind),
        range: built.range,
        dates: built.dates,
        index: built.index,
        ready: /^\d{4}-\d{2}-\d{2}$/.test(String(targetDate || "")),
      });
    },

    emit(next) {
      const remind = normalizeRemind(next);
      this.remind = remind;
      this.setData({ enabled: remind.enabled, text: describe(remind) });
      this.triggerEvent("change", remind);
    },

    toggle() {
      this.emit({ ...this.remind, enabled: !this.remind.enabled });
    },

    onPick(event) {
      this.emit(fromPicker(this.data.dates, event.detail.value, this.target));
    },
  },
});
