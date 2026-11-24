const app = getApp();
const { buildMarks } = require("../../utils/cycle");
const { addDays, anniversaryOn, anniversaryIndex, chineseDate, diffDays, displayDate, pad, todayString } = require("../../utils/date");
const { getTabClearance, watchTabClearance } = require("../../utils/layout");

function readChineseDate(text) {
  const matched = /(\d{4})\D+(\d{1,2})\D+(\d{1,2})/.exec(String(text || ""));
  if (!matched) {
    return null;
  }
  return { year: Number(matched[1]), month: Number(matched[2]), day: Number(matched[3]) };
}
const { loadFilter, saveFilter } = require("../../utils/filter");
const { markDay, birthText, birthFrom, buildBirth, indexFromBirth, ganZhiPillars } = require("../../utils/lunar");
const { dayAlmanac } = require("../../utils/almanac");
const { birthdayPhrase, occursOn } = require("../../utils/birthday");

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

Component({
  data: {
    week: WEEK,
    title: "",
    cells: [],
    expanded: false,
    offsetY: 0,
    sheetY: 640,
    sheetUp: false,
    sheetDrag: false,
    dragging: false,
    monthAnim: "",
    upcoming: [],
    filter: { period: true, fertile: true, anniversary: true, birthday: true, schedule: true },
    showFilter: false,
    sheet: "",
    menuLeft: 12,
    menuTop: 12,
    menuStep: 0,
    filterStep: 0,
    popLeft: 12,
    popTop: 80,
    popHeight: 180,
    popShift: 0,
    dayItems: [],
    dayLunar: "",
    dayYi: "",
    dayJi: "",
    selectedDate: "",
    form: {},
    canEditPeriod: false,
    hint: "",
    todayYi: "",
    todayJi: "",
    almanacHint: "正在整理今天",
    almanacNote: "",
    almanacOpen: false,
    almanacHeight: 320,
    almanacShift: 0,
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
      if (value && this.year) {
        this.reload();
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
      this.onShow();
    },
  },
  methods: {
  onShow() {
    this.setData({ tabClearance: getTabClearance() });
    if (!this.year) {
      const now = new Date();
      this.year = now.getFullYear();
      this.month = now.getMonth() + 1;
    }
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
      hint: result.user.gender ? "" : "请先在「编辑资料」里选择性别，才能记录经期",
    });
    this.render();
    this.loadToday();
  },

  loadToday() {
    this.showDate(todayString());
  },

  showDate(date) {
    const [year, month, day] = String(date || "").split("-").map((item) => Number(item));
    const marked = markDay(year, month, day);
    const lunarTitle = String(marked.lunarFull || "").replace(/^\d+年/, "");
    const week = "日一二三四五六"[new Date(year, month - 1, day).getDay()] || "";
    const almanac = dayAlmanac(year, month, day);
    const pillars = ganZhiPillars(year, month, day, new Date().getHours());
    this.setData({
      focusDate: date,
      selectedDate: date,
      focusLunar: lunarTitle,
      focusWeek: week ? `星期${week}` : "",
      dayItems: this.itemsOn(date),
      pillars,
      todayYi: almanac ? almanac.yi : "",
      todayJi: almanac ? almanac.ji : "",
      almanacHint: almanac ? "" : "这一年不显示黄历",
    });
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
    if (filter.birthday && this.birthdaysOn(date).length) icons.push("birthday");
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

  birthdaysOn(date) {
    return (this.session.birthdays || []).filter((item) => occursOn(item, date));
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
      const marked = markDay(this.year, this.month, day);
      cells.push({
        key: date,
        empty: false,
        day,
        date,
        today: date === todayString(),
        lunar: marked.lunar,
        lunarFull: marked.lunarFull,
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
      preview: this.buildUpcoming(marks).slice(0, 3),
    });
    this.measureMonth();
  },

  buildUpcoming(marks) {
    const today = todayString();
    const end = addDays(today, 30);
    const items = [];
    if (marks.predictedStart && marks.predictedStart >= today && marks.predictedStart <= end) {
      items.push({ id: "period", kind: "period", date: marks.predictedStart, title: "预计经期开始" });
    }
    const todayYear = Number(today.slice(0, 4));
    (this.session.anniversaries || []).forEach((item) => {
      if (item.yearly === false && new Date(item.createdAt || 0).getFullYear() !== todayYear) {
        return;
      }
      const thisYear = anniversaryOn(todayYear, item.month, item.day);
      const next = item.yearly === false ? thisYear : thisYear >= today ? thisYear : anniversaryOn(todayYear + 1, item.month, item.day);
      if (next >= today && next <= end) {
        const count = item.yearly !== false ? anniversaryIndex(item.year, item.month, item.day, today) : 0;
        items.push({
          id: item._id,
          kind: "anniversary",
          date: next,
          title: count ? `${item.title} · 第${count}个` : item.title,
        });
      }
    });
    (this.session.birthdays || []).forEach((item) => {
      const info = birthdayPhrase(item, today);
      if (info.date && info.date >= today && info.date <= end) {
        items.push({ id: item._id, kind: "birthday", date: info.date, title: item.title, label: info.text });
      }
    });
    (this.session.schedules || []).forEach((item) => {
      if (item.date >= today && item.date <= end) {
        items.push({ id: item._id, kind: "schedule", date: item.date, title: item.title });
      }
    });
    items.sort((left, right) => (left.date < right.date ? -1 : 1));
    return items.map((item) => ({
      ...item,
      label: item.label || `${displayDate(item.date)} · 还有 ${diffDays(today, item.date)} 天`,
    }));
  },

  onMonthStart(event) {
    this.axis = "";
    this.onTouchStart(event);
  },

  onMonthMove(event) {
    if (!this.gesture) return;
    const dy = event.touches[0].clientY - this.touchY;
    const dx = event.touches[0].clientX - this.touchX;
    if (!this.axis) {
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
      this.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
  },

  onMonthEnd(event) {
    if (!this.gesture) return;
    const dx = event.changedTouches[0].clientX - this.touchX;
    const horizontal = this.axis === "x";
    this.gesture = false;
    this.axis = "";
    if (!horizontal) return;
    if (dx <= -60) this.shiftBy(1);
    else if (dx >= 60) this.shiftBy(-1);
  },

  onTouchStart(event) {
    if (this.data.sheet) {
      return;
    }
    this.touchX = event.touches[0].clientX;
    this.touchY = event.touches[0].clientY;
    this.gesture = true;
  },

  onTouchMove(event) {
    if (!this.gesture) {
      return;
    }
    const dy = event.touches[0].clientY - this.touchY;
    const dx = event.touches[0].clientX - this.touchX;
    if (Math.abs(dy) < 12 || Math.abs(dy) <= Math.abs(dx)) {
      return;
    }
    const base = this.data.expanded ? -(this.monthHeight || 0) : 0;
    let offsetY = base + dy;
    const limit = -(this.monthHeight || 0);
    if (offsetY > 0) offsetY = 0;
    if (offsetY < limit) offsetY = limit;
    this.setData({ offsetY, dragging: true });
  },

  onTouchEnd(event) {
    if (!this.gesture) {
      return;
    }
    this.gesture = false;
    const dy = event.changedTouches[0].clientY - this.touchY;
    if (!this.data.dragging && Math.abs(dy) < 12) {
      return;
    }
    let expanded = this.data.expanded;
    if (!expanded && dy < -80) expanded = true;
    if (expanded && dy > 80) expanded = false;
    this.setData({
      expanded,
      offsetY: expanded ? -(this.monthHeight || 0) : 0,
      dragging: false,
    });
  },

  measureMonth() {
    const query = wx.createSelectorQuery().in(this);
    query.select(".page").boundingClientRect();
    query.select(".month-shell").boundingClientRect();
    query.exec((res) => {
      const page = res && res[0];
      const month = res && res[1];
      if (!month || !month.height || !page) return;
      this.monthHeight = month.height;
      this.restShift = Math.max(0, month.top - page.top + month.height);
      if (!this.data.sheetUp && !this.data.sheetDrag) {
        this.setData({ sheetY: this.restShift });
      }
    });
  },

  onBelowScroll(event) {
    this.belowTop = (event.detail && event.detail.scrollTop) || 0;
  },

  onGrabStart(event) {
    if (this.data.sheet) return;
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    this.grabY = touch.clientY;
    this.grabBase = this.data.sheetY;
    this.grabbing = true;
  },

  onGrabMove(event) {
    if (!this.grabbing) return;
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    const limit = this.restShift || this.monthHeight || 0;
    if (!limit) return;
    if (this.data.sheetUp && (this.belowTop || 0) > 8 && touch.clientY > this.grabY) return;
    let next = this.grabBase + (touch.clientY - this.grabY);
    if (next < 0) next = 0;
    if (next > limit) next = limit;
    this.setData({ sheetY: next, sheetDrag: true });
  },

  onGrabEnd() {
    if (!this.grabbing) return;
    this.grabbing = false;
    const limit = this.restShift || this.monthHeight || 0;
    const up = this.data.sheetY < limit * 0.55;
    this.setData({
      sheetUp: up,
      sheetY: up ? 0 : limit,
      sheetDrag: false,
    });
  },

  shiftMonth(event) {
    this.shiftBy(Number(event.currentTarget.dataset.step));
  },

  shiftBy(step) {
    this.setData({ monthAnim: step > 0 ? "to-left" : "to-right" });
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
    this.render();
  },

  toggleFilter() {
    const showFilter = !this.data.showFilter;
    this.setData({ showFilter, sheet: "", filterStep: 0 });
    if (!showFilter) {
      return;
    }
    setTimeout(() => this.setData({ filterStep: 1 }), 30);
    setTimeout(() => this.setData({ filterStep: 2 }), 110);
    setTimeout(() => this.setData({ filterStep: 3 }), 190);
    setTimeout(() => this.setData({ filterStep: 4 }), 270);
    setTimeout(() => this.setData({ filterStep: 5 }), 350);
  },

  changeFilter(event) {
    const key = event.currentTarget.dataset.key;
    const filter = { ...this.data.filter, [key]: !this.data.filter[key] };
    saveFilter(this.session.user.openid, filter);
    this.setData({ filter });
    this.render();
  },

  openDay(event) {
    if (this.longPressed) {
      this.longPressed = false;
      return;
    }
    const date = event.currentTarget.dataset.date;
    if (!date) {
      return;
    }
    this.showDate(date);
  },

  itemsOn(date) {
    const marks = this.marks();
    const items = [];
    const mine = this.session && this.session.user ? this.session.user.openid : "";
    const period = (this.session && this.session.periods || []).find((item) => item.startDate <= date && item.endDate >= date);
    if (period) {
      const note = (period.notes || []).find((item) => item.date === date);
      items.push({ kind: "period", id: period._id, title: "经期", extra: this.noteText(note) });
    } else if (marks.predicted.has(date)) {
      items.push({ kind: "text", id: `predicted-${date}`, title: "预测经期" });
    }
    if (marks.ovulation.has(date)) items.push({ kind: "text", id: `ovulation-${date}`, title: "排卵日，仅供参考" });
    else if (marks.fertile.has(date)) items.push({ kind: "text", id: `fertile-${date}`, title: "易孕期，仅供参考" });
    this.anniversariesOn(date).forEach((item) => {
      const count = item.yearly !== false ? anniversaryIndex(item.year, item.month, item.day, todayString()) : 0;
      items.push({
        kind: "anniversary",
        id: item._id,
        title: count ? `${item.title} · 第${count}个` : item.title,
        mine: item.creatorOpenid === mine,
      });
    });
    this.birthdaysOn(date).forEach((item) => {
      const info = birthdayPhrase(item, todayString());
      items.push({ kind: "birthday", id: item._id, title: item.title, extra: info.text });
    });
    this.schedulesOn(date).forEach((item) => {
      items.push({ kind: "schedule", id: item._id, title: item.title, mine: item.creatorOpenid === mine });
    });
    return items;
  },

  openMenu(event) {
    const date = event.currentTarget.dataset.date;
    if (!date) return;
    this.longPressed = true;
    this.openedAt = Date.now();
    this.setData({ selectedDate: date });
    const touch = (event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0]) || {};
    const info = wx.getWindowInfo ? wx.getWindowInfo() : { windowWidth: 375, windowHeight: 700 };
    const menuWidth = 168;
    const menuHeight = 220;
    let left = touch.clientX || event.detail.x || 24;
    let top = touch.clientY || event.detail.y || 24;
    if (left + menuWidth > info.windowWidth - 12) left = info.windowWidth - menuWidth - 12;
    if (left < 12) left = 12;
    if (top + menuHeight > info.windowHeight - 96) top = info.windowHeight - menuHeight - 96;
    if (top < 12) top = 12;
    this.setData({ sheet: "menu", showFilter: false, menuLeft: left, menuTop: top, menuStep: 0 });
    setTimeout(() => this.setData({ menuStep: 1 }), 30);
    setTimeout(() => this.setData({ menuStep: 2 }), 110);
    setTimeout(() => this.setData({ menuStep: 3 }), 190);
    setTimeout(() => this.setData({ menuStep: 4 }), 270);
  },

  noteText(note) {
    if (!note) return "";
    const flow = { light: "流量少", medium: "流量中", heavy: "流量多" }[note.flow] || "";
    const pain = { none: "不痛", mild: "轻微痛", strong: "痛得明显" }[note.pain] || "";
    return [flow, pain].filter(Boolean).join("，");
  },

  dismissPop() {
    if (this.openedAt && Date.now() - this.openedAt < 350) {
      return;
    }
    this.closeSheet();
  },

  openDayItem(event) {
    const kind = event.currentTarget.dataset.kind;
    const id = event.currentTarget.dataset.id;
    if (kind !== "period" && kind !== "anniversary" && kind !== "schedule" && kind !== "birthday") {
      return;
    }
    const item = (this.data.dayItems || []).find((entry) => entry.id === id) || {};
    this.setData({
      sheet: "detail",
      detailId: id,
      detailKind: kind,
      detailTitle: item.title || "",
      detailLabel: item.extra || this.data.selectedDate,
      canManage: true,
    });
  },

  openRecords() {
    this.triggerEvent("jumpto", { index: 3 });
  },

  openUpcoming(event) {
    const id = event.currentTarget.dataset.id;
    const kind = event.currentTarget.dataset.kind;
    const item = (this.data.upcoming || []).find((entry) => entry.id === id);
    if (!item) {
      return;
    }
    this.setData({
      sheet: "detail",
      detailId: id,
      detailKind: kind,
      detailTitle: item.title,
      detailLabel: item.label,
      canManage: item.id !== "period",
    });
  },

  editDetail() {
    const id = this.data.detailId;
    const kind = this.data.detailKind;
    if (kind === "period") {
      this.startPeriod({ currentTarget: { dataset: { id } } });
      return;
    }
    if (kind === "anniversary") {
      this.startAnniversary({ currentTarget: { dataset: { id } } });
      return;
    }
    if (kind === "birthday") {
      this.startBirthday({ currentTarget: { dataset: { id } } });
      return;
    }
    if (kind === "schedule") {
      this.startSchedule({ currentTarget: { dataset: { id } } });
    }
  },

  askDelete() {
    const name = { anniversary: "纪念日", birthday: "生日", period: "经期", schedule: "日程" }[this.data.detailKind] || "记录";
    wx.showModal({
      title: "要删除吗",
      content: `要删除这个${name}吗`,
      success: (res) => {
        if (res.confirm) {
          this.removeDetail();
        }
      },
    });
  },

  async removeDetail() {
    const action = { anniversary: "deleteAnniversary", birthday: "deleteBirthday", period: "deletePeriod", schedule: "deleteSchedule" }[this.data.detailKind];
    const result = await app.call(action, { id: this.data.detailId });
    this.afterSave(result);
  },

  closeSheet() {
    this.setData({ sheet: "", popShift: 0 });
  },

  startPeriod(event) {
    if (!this.data.canEditPeriod) {
      wx.showToast({ title: "当前不能记录经期", icon: "none" });
      return;
    }
    const owner = this.ownerProfile();
    const length = (owner && owner.periodLength) || 5;
    const id = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id;
    const existing = id
      ? (this.session.periods || []).find((item) => item._id === id)
      : (this.session.periods || []).find(
          (item) => item.startDate <= this.data.selectedDate && item.endDate >= this.data.selectedDate
        );
    this.setData({
      sheet: "period",
      form: existing
        ? { id: existing._id, startDate: existing.startDate, endDate: existing.endDate, flow: "", pain: "" }
        : { startDate: this.data.selectedDate, endDate: addDays(this.data.selectedDate, length - 1), flow: "", pain: "" },
    });
  },

  startBirthday(event) {
    const found = (this.session.birthdays || []).find((item) => item._id === event.currentTarget.dataset.id);
    const date = this.data.selectedDate || todayString();
    const calendar = found && found.calendar === "lunar" ? "lunar" : "solar";
    const year = found ? found.year : Number(date.slice(0, 4));
    const month = found ? found.month : Number(date.slice(5, 7));
    const day = found ? found.day : Number(date.slice(8, 10));
    const leap = !!(found && found.leap);
    const code = calendar === "lunar" ? `${year}-${leap ? "L" : ""}${pad(month)}-${pad(day)}` : `${year}-${pad(month)}-${pad(day)}`;
    const birthIndex = indexFromBirth(calendar, code) || buildBirth([calendar === "lunar" ? 1 : 0, 80, 0, 0]).index;
    const built = buildBirth(birthIndex);
    this.setData({
      sheet: "birthday",
      form: {
        id: found ? found._id : "",
        title: found ? found.title : "",
        calendar,
        year,
        month,
        day,
        leap,
        dateText: calendar === "lunar" ? birthText("lunar", code) : chineseDate(year, month, day),
        anniversaryDate: `${year}-${pad(month)}-${pad(day)}`,
        visibility: found ? found.visibility : "both",
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
    if (!matched || picked.calendar !== "lunar") {
      return;
    }
    this.setData({
      "form.calendar": "lunar",
      "form.year": Number(matched[1]),
      "form.month": Number(matched[3]),
      "form.day": Number(matched[4]),
      "form.leap": !!matched[2],
      "form.dateText": birthText("lunar", picked.date),
      "form.birthIndex": picked.index,
    });
  },

  startAnniversary(event) {
    const found = (this.session.anniversaries || []).find((item) => item._id === event.currentTarget.dataset.id);
    const date = this.data.selectedDate;
    const year = found && found.year ? found.year : Number(date.slice(0, 4));
    const month = found ? found.month : Number(date.slice(5, 7));
    const day = found ? found.day : Number(date.slice(8, 10));
    this.setData({
      sheet: "anniversary",
      form: {
        ...(found || {}),
        id: found ? found._id : "",
        title: found ? found.title : "",
        year,
        month,
        day,
        dateText: chineseDate(year, month, day),
        anniversaryDate: `${year}-${pad(month)}-${pad(day)}`,
        yearly: found ? found.yearly !== false : true,
        visibility: found ? found.visibility : "both",
      },
    });
  },

  startSchedule(event) {
    const found = (this.session.schedules || []).find((item) => item._id === event.currentTarget.dataset.id);
    this.setData({
      sheet: "schedule",
      form: found ? { ...found, id: found._id } : { title: "", note: "", date: this.data.selectedDate, visibility: "both", remind: "dayBefore" },
    });
  },

  onAnniversaryDate(event) {
    const value = event.detail.value || "";
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    this.setData({
      "form.year": year,
      "form.month": month,
      "form.day": day,
      "form.anniversaryDate": value,
      "form.dateText": chineseDate(year, month, day),
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

  async saveBirthday() {
    const result = await app.call("saveBirthday", this.data.form);
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
  },
});
