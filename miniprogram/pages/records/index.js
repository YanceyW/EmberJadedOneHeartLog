const app = getApp();
const { addDays, anniversaryIndex, anniversaryOn, chineseDate, diffDays, displayDate, nextOccurrence, pad, todayString } = require("../../utils/date");
const { birthdayPhrase } = require("../../utils/birthday");
const { birthFrom, birthText, buildBirth, indexFromBirth } = require("../../utils/lunar");
const { getTabClearance, watchTabClearance } = require("../../utils/layout");
const { defaultRemind, normalizeRemind } = require("../../utils/remind");
const subscribe = require("../../utils/subscribe");

const TYPES = [
  { key: "anniversary", name: "纪念日" },
  { key: "birthday", name: "生日" },
  { key: "period", name: "经期" },
  { key: "schedule", name: "日程" },
  { key: "wish", name: "心愿" },
];

const ADD_TYPES = TYPES.concat([{ key: "decision", name: "一起决定" }]);
const DECISION_NAMES = { eat: "吃什么", go: "去哪", do: "做什么", other: "一起决定" };

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
  if (!date) {
    return 200000;
  }
  const days = diffDays(today, date);
  return days >= 0 ? days : 100000 - days;
}

Component({
  data: {
    types: TYPES,
    shown: { anniversary: true, birthday: true, period: true, schedule: true, wish: true },
    sortMode: "date",
    rows: [],
    sheet: "",
    form: {},
    canSeePeriod: false,
    addOpen: false,
    addTypes: [],
    managing: false,
    picked: {},
    pickedCount: 0,
    defaultDate: "",
    decisions: [],
    df: { id: "", title: "", options: ["", ""] },
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
      subscribe.preload();
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
        defaultDate: todayString(),
        types: TYPES.filter((item) => item.key !== "period" || canSeePeriod),
        addTypes: ADD_TYPES.filter((item) => item.key !== "period" || canSeePeriod),
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
      (this.session.wishes || []).forEach((item) => {
        rows.push({
          id: item._id,
          kind: "wish",
          kindName: "心愿",
          date: item.targetDate || "",
          title: item.title,
          label: item.targetDate ? `想在 ${displayDate(item.targetDate)}` : "还没定日子",
        });
      });
      const order = { anniversary: 0, birthday: 1, period: 2, schedule: 3, wish: 4 };
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
      this.setData({ rows: grouped, decisions: this.buildDecisions() });
    },

    buildDecisions() {
      const session = this.session || {};
      const me = session.user ? session.user.openid : "";
      const list = (session.decisions || []).slice().sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
      const open = list.filter((item) => item.state !== "done");
      const done = list.filter((item) => item.state === "done").slice(0, 3);
      return open.concat(done).slice(0, 8).map((item) => {
        const votes = item.votes || {};
        return {
          id: item._id,
          title: item.title,
          categoryName: DECISION_NAMES[item.category] || "一起决定",
          own: item.creatorOpenid === me,
          result: item.result || null,
          options: (item.options || []).map((option) => ({
            id: option.id,
            text: option.text,
            count: Object.keys(votes).filter((key) => votes[key] === option.id).length,
            mine: votes[me] === option.id,
            win: !!(item.result && item.result.optionId === option.id),
          })),
        };
      });
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
      if (this.data.managing) {
        this.togglePick(kind, id);
        return;
      }
      if (kind === "period") this.openPeriod(id);
      if (kind === "birthday") this.openBirthday(id);
      if (kind === "anniversary") this.openAnniversary(id);
      if (kind === "schedule") this.openSchedule(id);
      if (kind === "wish") this.openWish(id);
    },

    openAdd() {
      this.setData({ addOpen: true });
    },

    closeAdd() {
      this.setData({ addOpen: false });
    },

    pickAdd(event) {
      const kind = event.currentTarget.dataset.kind;
      this.setData({ addOpen: false });
      if (kind === "period") this.openPeriod("");
      if (kind === "birthday") this.openBirthday("");
      if (kind === "anniversary") this.openAnniversary("");
      if (kind === "schedule") this.openSchedule("");
      if (kind === "wish") this.openWish("");
      if (kind === "decision") this.openDecision();
    },

    toggleManage() {
      if (this.data.managing) {
        this.setData({ managing: false, picked: {}, pickedCount: 0 });
        return;
      }
      this.setData({ managing: true, picked: {}, pickedCount: 0 });
    },

    togglePick(kind, id) {
      const key = `${kind}-${id}`;
      const picked = { ...this.data.picked, [key]: !this.data.picked[key] };
      const pickedCount = Object.keys(picked).filter((item) => picked[item]).length;
      this.setData({ picked, pickedCount });
    },

    confirmBatchDelete() {
      const keys = Object.keys(this.data.picked).filter((key) => this.data.picked[key]);
      if (!keys.length) {
        wx.showToast({ title: "先选中要删除的记录", icon: "none" });
        return;
      }
      wx.showModal({
        title: "要删除吗",
        content: `要删除选中的 ${keys.length} 条吗`,
        success: async (res) => {
          if (!res.confirm) {
            return;
          }
          const items = keys.map((key) => {
            const split = key.indexOf("-");
            return { kind: key.slice(0, split), id: key.slice(split + 1) };
          });
          const result = await app.call("deleteRecords", { items });
          if (!result.ok) {
            wx.showToast({ title: result.message, icon: "none" });
            return;
          }
          this.setData({ managing: false, picked: {}, pickedCount: 0 });
          this.applySession(result);
          const skipped = result.skipped || 0;
          wx.showToast({
            title: skipped ? `删了 ${result.deleted} 条，${skipped} 条是对方的` : `已删除 ${result.deleted} 条`,
            icon: "none",
          });
        },
      });
    },

    openPeriod(id) {
      if (!this.session || !this.session.canEditPeriod) {
        wx.showToast({ title: "当前不能修改经期", icon: "none" });
        return;
      }
      const found = (this.session.periods || []).find((item) => item._id === id);
      if (found) {
        this.setData({
          sheet: "period",
          form: {
            id: found._id,
            startDate: found.startDate,
            endDate: found.endDate,
            notes: found.notes || [],
          },
        });
        return;
      }
      const start = todayString();
      const length = (this.session.user && this.session.user.periodLength) || 5;
      this.setData({
        sheet: "period",
        form: { startDate: start, endDate: addDays(start, length - 1), notes: [] },
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

    noop() {},

    onForm(event) {
      const key = event.currentTarget.dataset.key;
      this.setData({ [`form.${key}`]: event.detail.value });
      if (key === "date") {
        this.syncRemindDate();
      }
    },

    setForm(event) {
      const key = event.currentTarget.dataset.key;
      let value = event.currentTarget.dataset.value;
      if (value === "true") value = true;
      if (value === "false") value = false;
      this.setData({ [`form.${key}`]: value });
      if (key === "yearly" || key === "calendar") {
        this.syncRemindDate();
      }
    },

    /** picker 的日期列要按目标日排，日期一改就得重算。 */
    remindDateFor(sheet, form) {
      const today = todayString();
      if (sheet === "schedule") {
        return /^\d{4}-\d{2}-\d{2}$/.test(form.date || "") ? form.date : "";
      }
      if (sheet === "birthday") {
        if (form.calendar === "lunar" || !form.month || !form.day) {
          return "";
        }
        return nextOccurrence(form.month, form.day, today);
      }
      if (sheet === "anniversary") {
        if (!form.month || !form.day) {
          return "";
        }
        if (form.yearly === false) {
          return anniversaryOn(form.year || Number(today.slice(0, 4)), form.month, form.day);
        }
        return nextOccurrence(form.month, form.day, today);
      }
      return "";
    },

    syncRemindDate() {
      this.setData({ "form.remindDate": this.remindDateFor(this.data.sheet, this.data.form || {}) });
    },

    onRemind(event) {
      this.setData({ "form.remind": event.detail });
    },

    openBirthday(id) {
      const found = (this.session.birthdays || []).find((item) => item._id === id);
      const today = todayString();
      const year = found ? found.year : Number(today.slice(0, 4));
      const month = found ? found.month : Number(today.slice(5, 7));
      const day = found ? found.day : Number(today.slice(8, 10));
      const calendar = found && found.calendar === "lunar" ? "lunar" : "solar";
      const leap = !!(found && found.leap);
      const code = calendar === "lunar" ? `${year}-${leap ? "L" : ""}${pad(month)}-${pad(day)}` : `${year}-${pad(month)}-${pad(day)}`;
      const birthIndex = indexFromBirth(calendar, code) || buildBirth([0, 80, 0, 0]).index;
      const built = buildBirth(birthIndex);
      this.setData({
        sheet: "birthday",
        form: {
          ...(found || {}),
          id: found ? found._id : "",
          title: found ? found.title : "",
          year,
          month,
          day,
          calendar,
          leap,
          dateText: calendar === "lunar" ? birthText("lunar", code) : chineseDate(year, month, day),
          anniversaryDate: `${year}-${pad(month)}-${pad(day)}`,
          birthRange: built.range,
          birthIndex: built.index,
          remind: found ? normalizeRemind(found.remind) : defaultRemind(0),
        },
      });
      this.syncRemindDate();
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
      this.syncRemindDate();
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
      this.syncRemindDate();
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
      this.syncRemindDate();
    },

    openAnniversary(id) {
      const found = (this.session.anniversaries || []).find((item) => item._id === id);
      const today = todayString();
      const year = found && found.year ? found.year : Number(today.slice(0, 4));
      const month = found ? found.month : Number(today.slice(5, 7));
      const day = found ? found.day : Number(today.slice(8, 10));
      this.setData({
        sheet: "anniversary",
        form: {
          ...(found || {}),
          id: found ? found._id : "",
          title: found ? found.title : "",
          year,
          month,
          day,
          yearly: found ? found.yearly !== false : true,
          dateText: chineseDate(year, month, day),
          anniversaryDate: `${year}-${pad(month)}-${pad(day)}`,
          remind: found ? normalizeRemind(found.remind) : defaultRemind(0),
        },
      });
      this.syncRemindDate();
    },

    openSchedule(id) {
      const found = (this.session.schedules || []).find((item) => item._id === id);
      this.setData({
        sheet: "schedule",
        form: found
          ? { ...found, id: found._id, remind: normalizeRemind(found.remind) }
          : { title: "", date: todayString(), note: "", visibility: "both", remind: defaultRemind(1) },
      });
      this.syncRemindDate();
    },

    openWish(id) {
      const found = (this.session.wishes || []).find((item) => item._id === id);
      this.setData({
        sheet: "wish",
        form: found
          ? { ...found, id: found._id }
          : { title: "", targetDate: "", visibility: "both" },
      });
    },

    openDecision() {
      this.setData({ sheet: "decision", form: {}, df: { id: "", title: "", options: ["", ""] } });
    },

    onDecisionTitle(event) {
      this.setData({ "df.title": event.detail.value });
    },

    onDecisionOption(event) {
      const index = Number(event.currentTarget.dataset.index);
      const options = (this.data.df.options || []).slice();
      options[index] = event.detail.value;
      this.setData({ "df.options": options });
    },

    addDecisionOption() {
      const options = (this.data.df.options || []).slice();
      if (options.length >= 6) {
        return;
      }
      options.push("");
      this.setData({ "df.options": options });
    },

    removeDecisionOption(event) {
      const index = Number(event.currentTarget.dataset.index);
      const options = (this.data.df.options || []).slice();
      if (options.length <= 2) {
        return;
      }
      options.splice(index, 1);
      this.setData({ "df.options": options });
    },

    async saveDecision() {
      const result = await app.call("saveDecision", this.data.df);
      this.afterSave(result);
    },

    async voteOption(event) {
      if (this.data.managing) {
        return;
      }
      const id = event.currentTarget.dataset.id;
      const optionId = event.currentTarget.dataset.opt;
      const decision = this.data.decisions.find((item) => item.id === id);
      if (!decision || decision.result) {
        return;
      }
      const asked = subscribe.request(["decision"]);
      await asked;
      const result = await app.call("voteDecision", { id, optionId });      if (!result.ok) {
        wx.showToast({ title: result.message, icon: "none" });
        return;
      }
      this.applySession(result);
    },

    async finishDecision(event) {
      const id = event.currentTarget.dataset.id;
      const mode = event.currentTarget.dataset.mode;
      // 先把额度加上，紧接着的结果推送才找得到接收方
      await subscribe.request(["decision"]);
      const result = await app.call("finishDecision", { id, mode });
      if (!result.ok) {
        wx.showToast({ title: result.message, icon: "none" });
        return;
      }
      this.applySession(result);
    },

    deleteDecision(event) {
      const id = event.currentTarget.dataset.id;
      wx.showModal({
        title: "要删除吗",
        content: "删掉这个决定和上面的投票",
        success: async (res) => {
          if (!res.confirm) {
            return;
          }
          const result = await app.call("deleteDecision", { id });
          if (!result.ok) {
            wx.showToast({ title: result.message, icon: "none" });
            return;
          }
          this.applySession(result);
        },
      });
    },

    async saveBirthday() {
      const asked = subscribe.request(["birthday"]);
      this.afterSave(await app.call("saveBirthday", this.data.form));
      await asked;
    },

    async saveAnniversary() {
      const asked = subscribe.request(["anniversary"]);
      this.afterSave(await app.call("saveAnniversary", this.data.form));
      await asked;
    },

    async saveSchedule() {
      const asked = subscribe.request(["schedule", "note"]);
      this.afterSave(await app.call("saveSchedule", this.data.form));
      await asked;
    },

    async saveWish() {
      this.afterSave(await app.call("saveWish", this.data.form));
    },

    askDelete() {
      const name = { anniversary: "纪念日", birthday: "生日", period: "经期", schedule: "日程", wish: "心愿" }[this.data.sheet] || "记录";
      wx.showModal({
        title: "要删除吗",
        content: `要删除这个${name}吗`,
        success: (res) => {
          if (res.confirm) this.removeCurrent();
        },
      });
    },

    async removeCurrent() {
      const action = { anniversary: "deleteAnniversary", birthday: "deleteBirthday", period: "deletePeriod", schedule: "deleteSchedule", wish: "deleteWish" }[this.data.sheet];
      this.afterSave(await app.call(action, { id: this.data.form.id }));
    },

    applySession(result) {
      app.globalData.session = result;
      this.session = result;
      this.render();
    },

    afterSave(result) {
      if (!result.ok) {
        wx.showToast({ title: result.message, icon: "none" });
        return;
      }
      this.setData({ sheet: "" });
      this.applySession(result);
    },

  },
});
