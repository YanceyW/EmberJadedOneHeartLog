const app = getApp();
const { anniversaryIndex, anniversaryOn, chineseDate, diffDays, displayDate, pad, todayString } = require("../../utils/date");
const { birthdayPhrase } = require("../../utils/birthday");
const { birthFrom, birthText, buildBirth, indexFromBirth } = require("../../utils/lunar");
const { getTabClearance, watchTabClearance } = require("../../utils/layout");

const TYPES = [
  { key: "anniversary", name: "纪念日" },
  { key: "birthday", name: "生日" },
  { key: "period", name: "经期" },
  { key: "schedule", name: "日程" },
];

function readChineseDate(text) {
  const matched = /(\d{4})\D+(\d{1,2})\D+(\d{1,2})/.exec(String(text || ""));
  if (!matched) return null;
  return { year: Number(matched[1]), month: Number(matched[2]), day: Number(matched[3]) };
}

function storageKey(openid) {
  return `records-view:${openid || "local"}`;
}

function loadView(openid) {
  const saved = wx.getStorageSync(storageKey(openid)) || {};
  const shown = {};
  TYPES.forEach((item) => {
    shown[item.key] = saved[item.key] !== false;
  });
  if (!TYPES.some((item) => shown[item.key])) {
    shown.anniversary = true;
  }
  return { shown, sortMode: saved.sortMode === "type" ? "type" : "date" };
}

function rank(today, date) {
  const days = diffDays(today, date || today);
  return days >= 0 ? days : 100000 - days;
}

Component({
  data: {
    types: TYPES,
    shown: { anniversary: true, birthday: true, period: true, schedule: true },
    sortMode: "date",
    rows: [],
    sheet: "",
    form: {},
    canSeePeriod: false,
    tabClearance: 120,
  },
  properties: {
    active: {
      type: Boolean,
      value: false,
    },
  },
  observers: {
    active(value) {
      if (value) {
        this.load();
      }
    },
  },
  lifetimes: {
    attached() {
      this.setData({ tabClearance: getTabClearance() });
      this.unwatchClearance = watchTabClearance((value) => {
        this.setData({ tabClearance: value });
      });
    },
    detached() {
      if (this.unwatchClearance) {
        this.unwatchClearance();
        this.unwatchClearance = null;
      }
    },
  },
  pageLifetimes: {
    show() {
      this.setData({ tabClearance: getTabClearance() });
      this.load();
    },
  },
  methods: {
    async load() {
      const result = await app.loadSession(true);
      if (!result.ok) {
        wx.showToast({ title: result.message, icon: "none" });
        return;
      }
      this.session = result;
      const view = loadView(result.user.openid);
      this.shown = view.shown;
      this.sortMode = view.sortMode;
      const canSeePeriod = !!(result.periods && result.periods.length) || result.canEditPeriod;
      this.setData({
        shown: view.shown,
        sortMode: view.sortMode,
        canSeePeriod,
        types: TYPES.filter((item) => item.key !== "period" || canSeePeriod),
      });
      this.render();
    },

    render() {
      const today = todayString();
      const year = Number(today.slice(0, 4));
      const rows = [];
      (this.session.anniversaries || []).forEach((item) => {
        const thisYear = anniversaryOn(year, item.month, item.day);
        const next = item.yearly === false ? thisYear : thisYear >= today ? thisYear : anniversaryOn(year + 1, item.month, item.day);
        const count = item.yearly !== false ? anniversaryIndex(item.year, item.month, item.day, today) : 0;
        rows.push({
          id: item._id,
          kind: "anniversary",
          kindName: "纪念日",
          date: next,
          title: count ? `${item.title} · 第${count}个` : item.title,
          label: displayDate(next),
        });
      });
      (this.session.birthdays || []).forEach((item) => {
        const info = birthdayPhrase(item, today);
        rows.push({
          id: item._id,
          kind: "birthday",
          kindName: "生日",
          date: info.date || today,
          title: item.title,
          label: info.text || "生日",
        });
      });
      if ((this.session.periods || []).length) {
        (this.session.periods || []).forEach((item) => {
          rows.push({
            id: item._id,
            kind: "period",
            kindName: "经期",
            date: item.startDate,
            title: "经期",
            label: `${displayDate(item.startDate)} 至 ${displayDate(item.endDate)}`,
          });
        });
      }
      (this.session.schedules || []).forEach((item) => {
        rows.push({
          id: item._id,
          kind: "schedule",
          kindName: "日程",
          date: item.date,
          title: item.title,
          label: item.note || displayDate(item.date),
        });
      });
      const order = { anniversary: 0, birthday: 1, period: 2, schedule: 3 };
      const shown = this.shown || this.data.shown;
      const sortMode = this.sortMode || this.data.sortMode;
      const visible = rows.filter((item) => shown[item.kind] !== false);
      visible.sort((left, right) => {
        if (sortMode === "type" && left.kind !== right.kind) {
          return order[left.kind] - order[right.kind];
        }
        const gap = rank(today, left.date) - rank(today, right.date);
        return gap || order[left.kind] - order[right.kind];
      });
      let lastHead = "";
      const grouped = visible.map((item) => {
        const head = sortMode === "type" ? item.kindName : this.dateHead(item.date, today);
        const showHead = head !== lastHead;
        lastHead = head;
        return { ...item, key: `${item.kind}-${item.id}`, head, showHead };
      });
      this.setData({ rows: grouped });
    },

    dateHead(date, today) {
      if (!date) {
        return "日期未定";
      }
      if (date === today) {
        return "今天";
      }
      const [year, month, day] = date.split("-");
      if (year === today.slice(0, 4)) {
        return `${Number(month)}月${Number(day)}日`;
      }
      return `${year}年${Number(month)}月${Number(day)}日`;
    },

    saveView() {
      const openid = this.session && this.session.user && this.session.user.openid;
      wx.setStorageSync(storageKey(openid), { ...(this.shown || this.data.shown), sortMode: this.sortMode || this.data.sortMode });
    },

    toggleType(event) {
      const key = event.currentTarget.dataset.key;
      const shown = { ...(this.shown || this.data.shown), [key]: !(this.shown || this.data.shown)[key] };
      if (!this.data.types.some((item) => shown[item.key])) {
        wx.showToast({ title: "至少留一种", icon: "none" });
        return;
      }
      this.shown = shown;
      this.setData({ shown });
      this.saveView();
      this.render();
    },

    setSort(event) {
      this.sortMode = event.currentTarget.dataset.mode;
      this.setData({ sortMode: this.sortMode });
      this.saveView();
      this.render();
    },

    openRow(event) {
      const kind = event.currentTarget.dataset.kind;
      const id = event.currentTarget.dataset.id;
      if (kind === "period") this.startPeriod({ currentTarget: { dataset: { id } } });
      if (kind === "birthday") this.startBirthday({ currentTarget: { dataset: { id } } });
      if (kind === "anniversary") this.startAnniversary({ currentTarget: { dataset: { id } } });
      if (kind === "schedule") this.startSchedule({ currentTarget: { dataset: { id } } });
    },

    startPeriod(event) {
      if (!this.session || !this.session.canEditPeriod) {
        wx.showToast({ title: "当前不能修改经期", icon: "none" });
        return;
      }
      const found = (this.session.periods || []).find((item) => item._id === event.currentTarget.dataset.id);
      if (!found) {
        return;
      }
      this.setData({
        sheet: "period",
        form: {
          id: found._id,
          startDate: found.startDate,
          endDate: found.endDate,
          notes: found.notes || [],
        },
      });
    },

    async savePeriod() {
      const form = this.data.form;
      const result = await app.call("savePeriod", {
        id: form.id,
        ownerOpenid: this.session.periodOwnerOpenid,
        startDate: form.startDate,
        endDate: form.endDate,
        notes: form.notes || [],
      });
      this.afterSave(result);
    },

    closeSheet() {
      this.setData({ sheet: "" });
    },

    onForm(event) {
      this.setData({ [`form.${event.currentTarget.dataset.key}`]: event.detail.value });
    },

    setForm(event) {
      let value = event.currentTarget.dataset.value;
      if (value === "true") value = true;
      if (value === "false") value = false;
      this.setData({ [`form.${event.currentTarget.dataset.key}`]: value });
    },

    startBirthday(event) {
      const found = (this.session.birthdays || []).find((item) => item._id === event.currentTarget.dataset.id);
      if (!found) return;
      const calendar = found.calendar === "lunar" ? "lunar" : "solar";
      const leap = !!found.leap;
      const code = calendar === "lunar" ? `${found.year}-${leap ? "L" : ""}${pad(found.month)}-${pad(found.day)}` : `${found.year}-${pad(found.month)}-${pad(found.day)}`;
      const birthIndex = indexFromBirth(calendar, code) || buildBirth([0, 80, 0, 0]).index;
      const built = buildBirth(birthIndex);
      this.setData({
        sheet: "birthday",
        form: {
          ...found,
          id: found._id,
          calendar,
          leap,
          dateText: calendar === "lunar" ? birthText("lunar", code) : chineseDate(found.year, found.month, found.day),
          anniversaryDate: `${found.year}-${pad(found.month)}-${pad(found.day)}`,
          birthRange: built.range,
          birthIndex: built.index,
        },
      });
    },

    onBirthdayColumn(event) {
      const birthIndex = (this.data.form.birthIndex || []).slice();
      birthIndex[event.detail.column] = event.detail.value;
      if (event.detail.column < 3) birthIndex[3] = 0;
      if (event.detail.column < 2) birthIndex[2] = 0;
      const built = buildBirth(birthIndex);
      this.setData({ "form.birthRange": built.range, "form.birthIndex": built.index });
    },

    onBirthdayLunar(event) {
      const picked = birthFrom(event.detail.value);
      const matched = /^(\d{4})-(L)?(\d{2})-(\d{2})$/.exec(picked.date || "");
      if (!matched) return;
      this.setData({
        "form.year": Number(matched[1]),
        "form.month": Number(matched[3]),
        "form.day": Number(matched[4]),
        "form.leap": !!matched[2],
        "form.dateText": birthText("lunar", picked.date),
        "form.birthIndex": picked.index,
      });
    },

    onAnniversaryDate(event) {
      const value = event.detail.value || "";
      this.setData({
        "form.year": Number(value.slice(0, 4)),
        "form.month": Number(value.slice(5, 7)),
        "form.day": Number(value.slice(8, 10)),
        "form.anniversaryDate": value,
        "form.dateText": chineseDate(Number(value.slice(0, 4)), Number(value.slice(5, 7)), Number(value.slice(8, 10))),
      });
    },

    onAnniversaryText(event) {
      const parsed = readChineseDate(event.detail.value);
      if (!parsed) {
        wx.showToast({ title: "写成 2018年11月26日", icon: "none" });
        return;
      }
      this.setData({
        "form.year": parsed.year,
        "form.month": parsed.month,
        "form.day": parsed.day,
        "form.anniversaryDate": `${parsed.year}-${pad(parsed.month)}-${pad(parsed.day)}`,
        "form.dateText": chineseDate(parsed.year, parsed.month, parsed.day),
      });
    },

    startAnniversary(event) {
      const found = (this.session.anniversaries || []).find((item) => item._id === event.currentTarget.dataset.id);
      if (!found) return;
      const year = found.year || Number(todayString().slice(0, 4));
      this.setData({
        sheet: "anniversary",
        form: {
          ...found,
          id: found._id,
          year,
          dateText: chineseDate(year, found.month, found.day),
          anniversaryDate: `${year}-${pad(found.month)}-${pad(found.day)}`,
        },
      });
    },

    startSchedule(event) {
      const found = (this.session.schedules || []).find((item) => item._id === event.currentTarget.dataset.id);
      if (!found) return;
      this.setData({ sheet: "schedule", form: { ...found, id: found._id } });
    },

    async saveBirthday() {
      this.afterSave(await app.call("saveBirthday", this.data.form));
    },

    async saveAnniversary() {
      this.afterSave(await app.call("saveAnniversary", this.data.form));
    },

    async saveSchedule() {
      this.afterSave(await app.call("saveSchedule", this.data.form));
    },

    askDelete() {
      const name = { anniversary: "纪念日", birthday: "生日", period: "经期", schedule: "日程" }[this.data.sheet] || "记录";
      wx.showModal({
        title: "要删除吗",
        content: `要删除这个${name}吗`,
        success: (res) => {
          if (res.confirm) this.removeCurrent();
        },
      });
    },

    async removeCurrent() {
      const action = { anniversary: "deleteAnniversary", birthday: "deleteBirthday", period: "deletePeriod", schedule: "deleteSchedule" }[this.data.sheet];
      this.afterSave(await app.call(action, { id: this.data.form.id }));
    },

    afterSave(result) {
      if (!result.ok) {
        wx.showToast({ title: result.message, icon: "none" });
        return;
      }
      app.globalData.session = result;
      this.session = result;
      this.setData({ sheet: "" });
      this.render();
    },
  },
});
