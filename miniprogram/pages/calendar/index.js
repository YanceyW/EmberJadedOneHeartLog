const app = getApp();
const { buildMarks } = require("../../utils/cycle");
const { addDays, anniversaryOn, diffDays, displayDate, pad, todayString } = require("../../utils/date");
const { loadFilter, saveFilter } = require("../../utils/filter");

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

Page({
  data: {
    week: WEEK,
    title: "",
    cells: [],
    showUpcoming: false,
    fading: true,
    upcoming: [],
    filter: { period: true, fertile: true, anniversary: true, schedule: true },
    showFilter: false,
    sheet: "",
    dayItems: [],
    selectedDate: "",
    form: {},
    canEditPeriod: false,
    hint: "",
  },

  onShow() {
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth() + 1;
    this.session = null;
    this.reload();
  },

  async reload() {
    const result = await app.loadSession(true);
    if (!result.ok) {
      wx.showToast({ title: result.message, icon: "none" });
      return;
    }
    this.session = result;
    const filter = loadFilter(result.user.openid);
    this.setData({
      filter,
      canEditPeriod: result.canEditPeriod,
      hint: result.user.gender ? "" : "请先在「我的」选择性别，才能记录经期",
    });
    this.render();
  },

  ownerProfile() {
    const session = this.session;
    if (!session) {
      return null;
    }
    if (session.user.gender === "female") {
      return session.user;
    }
    if (session.canEditPeriod) {
      return session.partner;
    }
    return null;
  },

  marks() {
    const owner = this.ownerProfile();
    if (!owner) {
      return { actual: new Set(), predicted: new Set(), ovulation: new Set(), fertile: new Set(), predictedStart: "" };
    }
    return buildMarks(this.session.periods, owner.cycleLength, owner.periodLength);
  },

  iconsFor(date, marks) {
    const filter = this.data.filter;
    const icons = [];
    if (filter.period && marks.actual.has(date)) icons.push("period");
    else if (filter.period && marks.predicted.has(date)) icons.push("predicted");
    if (filter.fertile && marks.ovulation.has(date)) icons.push("ovulation");
    else if (filter.fertile && marks.fertile.has(date)) icons.push("fertile");
    if (filter.anniversary && this.anniversariesOn(date).length) icons.push("anniversary");
    if (filter.schedule && this.schedulesOn(date).length) icons.push("schedule");
    return icons;
  },

  anniversariesOn(date) {
    const year = Number(date.slice(0, 4));
    return (this.session.anniversaries || []).filter((item) => {
      if (anniversaryOn(year, item.month, item.day) !== date) {
        return false;
      }
      if (item.yearly !== false) {
        return true;
      }
      return new Date(item.createdAt || 0).getFullYear() === year;
    });
  },

  schedulesOn(date) {
    return (this.session.schedules || []).filter((item) => item.date === date);
  },

  render() {
    const marks = this.marks();
    const first = new Date(this.year, this.month - 1, 1);
    const count = new Date(this.year, this.month, 0).getDate();
    const cells = [];
    for (let index = 0; index < first.getDay(); index += 1) {
      cells.push({ empty: true, key: `blank-${index}` });
    }
    for (let day = 1; day <= count; day += 1) {
      const date = `${this.year}-${pad(this.month)}-${pad(day)}`;
      const icons = this.iconsFor(date, marks);
      cells.push({
        key: date,
        empty: false,
        day,
        date,
        today: date === todayString(),
        icons: icons.slice(0, 3),
        more: Math.max(0, icons.length - 3),
      });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ empty: true, key: `tail-${cells.length}` });
    }
    this.setData({
      title: `${this.year}年${this.month}月`,
      cells,
      upcoming: this.buildUpcoming(marks),
    });
  },

  buildUpcoming(marks) {
    const today = todayString();
    const end = addDays(today, 30);
    const items = [];
    if (marks.predictedStart && marks.predictedStart >= today && marks.predictedStart <= end) {
      items.push({ id: "period", date: marks.predictedStart, title: "预计经期开始" });
    }
    const todayYear = Number(today.slice(0, 4));
    (this.session.anniversaries || []).forEach((item) => {
      if (item.yearly === false && new Date(item.createdAt || 0).getFullYear() !== todayYear) {
        return;
      }
      const thisYear = anniversaryOn(todayYear, item.month, item.day);
      const next = item.yearly === false ? thisYear : thisYear >= today ? thisYear : anniversaryOn(todayYear + 1, item.month, item.day);
      if (next >= today && next <= end) {
        items.push({ id: item._id, date: next, title: item.title });
      }
    });
    (this.session.schedules || []).forEach((item) => {
      if (item.date >= today && item.date <= end) {
        items.push({ id: item._id, date: item.date, title: item.title });
      }
    });
    items.sort((left, right) => (left.date < right.date ? -1 : 1));
    return items.map((item) => ({
      ...item,
      label: `${displayDate(item.date)} · 还有 ${diffDays(today, item.date)} 天`,
    }));
  },

  onTouchStart(event) {
    this.touchX = event.touches[0].clientX;
    this.touchY = event.touches[0].clientY;
  },

  onTouchEnd(event) {
    const dx = event.changedTouches[0].clientX - this.touchX;
    const dy = event.changedTouches[0].clientY - this.touchY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
      this.shiftMonth(dx < 0 ? 1 : -1);
      return;
    }
    if (dy > 80 && !this.data.showUpcoming) {
      this.setData({ showUpcoming: true });
    } else if (dy < -80 && this.data.showUpcoming) {
      this.setData({ showUpcoming: false });
    }
  },

  shiftMonth(step) {
    let month = this.month + step;
    let year = this.year;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
    if (month > 12) {
      month = 1;
      year += 1;
    }
    this.month = month;
    this.year = year;
    this.setData({ fading: false });
    this.render();
    setTimeout(() => this.setData({ fading: true }), 16);
  },

  toggleFilter() {
    this.setData({ showFilter: !this.data.showFilter, sheet: "" });
  },

  changeFilter(event) {
    const key = event.currentTarget.dataset.key;
    const filter = { ...this.data.filter, [key]: !this.data.filter[key] };
    saveFilter(this.session.user.openid, filter);
    this.setData({ filter });
    this.render();
  },

  openDay(event) {
    const date = event.currentTarget.dataset.date;
    if (!date) {
      return;
    }
    const marks = this.marks();
    const items = [];
    const mine = this.session.user.openid;
    const period = (this.session.periods || []).find((item) => item.startDate <= date && item.endDate >= date);
    if (period) {
      const note = (period.notes || []).find((item) => item.date === date);
      items.push({ kind: "period", id: period._id, title: "经期", extra: this.noteText(note) });
    } else if (marks.predicted.has(date)) {
      items.push({ kind: "text", id: `predicted-${date}`, title: "预测经期" });
    }
    if (marks.ovulation.has(date)) items.push({ kind: "text", id: `ovulation-${date}`, title: "排卵日，仅供参考" });
    else if (marks.fertile.has(date)) items.push({ kind: "text", id: `fertile-${date}`, title: "易孕期，仅供参考" });
    this.anniversariesOn(date).forEach((item) => {
      items.push({ kind: "anniversary", id: item._id, title: item.title, mine: item.creatorOpenid === mine });
    });
    this.schedulesOn(date).forEach((item) => {
      items.push({ kind: "schedule", id: item._id, title: item.title, mine: item.creatorOpenid === mine });
    });
    this.setData({ sheet: "day", selectedDate: date, dayItems: items, showFilter: false });
  },

  noteText(note) {
    if (!note) return "";
    const flow = { light: "流量少", medium: "流量中", heavy: "流量多" }[note.flow] || "";
    const pain = { none: "不痛", mild: "轻微痛", strong: "痛得明显" }[note.pain] || "";
    return [flow, pain].filter(Boolean).join("，");
  },

  closeSheet() {
    this.setData({ sheet: "" });
  },

  startPeriod() {
    if (!this.data.canEditPeriod) {
      wx.showToast({ title: "当前不能记录经期", icon: "none" });
      return;
    }
    const owner = this.ownerProfile();
    const length = (owner && owner.periodLength) || 5;
    const existing = (this.session.periods || []).find(
      (item) => item.startDate <= this.data.selectedDate && item.endDate >= this.data.selectedDate
    );
    this.setData({
      sheet: "period",
      form: existing
        ? { id: existing._id, startDate: existing.startDate, endDate: existing.endDate, flow: "", pain: "" }
        : { startDate: this.data.selectedDate, endDate: addDays(this.data.selectedDate, length - 1), flow: "", pain: "" },
    });
  },

  startAnniversary(event) {
    const found = (this.session.anniversaries || []).find((item) => item._id === event.currentTarget.dataset.id);
    const date = this.data.selectedDate;
    this.setData({
      sheet: "anniversary",
      form: found ? { ...found, id: found._id } : {
        title: "",
        month: Number(date.slice(5, 7)),
        day: Number(date.slice(8, 10)),
        yearly: true,
        visibility: "both",
      },
    });
  },

  startSchedule(event) {
    const found = (this.session.schedules || []).find((item) => item._id === event.currentTarget.dataset.id);
    this.setData({
      sheet: "schedule",
      form: found ? { ...found, id: found._id } : { title: "", note: "", date: this.data.selectedDate, visibility: "both" },
    });
  },

  onForm(event) {
    const key = event.currentTarget.dataset.key;
    const value = event.detail.value;
    this.setData({ [`form.${key}`]: value });
  },

  setForm(event) {
    const key = event.currentTarget.dataset.key;
    let value = event.currentTarget.dataset.value;
    if (value === "true") value = true;
    if (value === "false") value = false;
    this.setData({ [`form.${key}`]: value });
  },

  noop() {},

  async savePeriod() {
    const form = this.data.form;
    const noteDate = this.data.selectedDate;
    const existing = (this.session.periods || []).find((item) => item._id === form.id);
    const notes = (existing && existing.notes ? existing.notes : []).filter((item) => item.date !== noteDate);
    if (form.flow || form.pain) {
      notes.push({ date: noteDate, flow: form.flow, pain: form.pain });
    }
    const result = await app.call("savePeriod", {
      id: form.id,
      ownerOpenid: this.session.periodOwnerOpenid,
      startDate: form.startDate,
      endDate: form.endDate,
      notes,
    });
    this.afterSave(result);
  },

  async removePeriod(event) {
    const result = await app.call("deletePeriod", { id: event.currentTarget.dataset.id });
    this.afterSave(result);
  },

  async saveAnniversary() {
    const form = this.data.form;
    const result = await app.call("saveAnniversary", form);
    this.afterSave(result);
  },

  async removeAnniversary(event) {
    const result = await app.call("deleteAnniversary", { id: event.currentTarget.dataset.id });
    this.afterSave(result);
  },

  async saveSchedule() {
    const result = await app.call("saveSchedule", this.data.form);
    this.afterSave(result);
  },

  async removeSchedule(event) {
    const result = await app.call("deleteSchedule", { id: event.currentTarget.dataset.id });
    this.afterSave(result);
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
});
