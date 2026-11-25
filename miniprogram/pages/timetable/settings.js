const app = getApp();
const { addDays, todayString } = require("../../utils/date");

const GROUP_NAME_LIMIT = 6;
const GROUP_LIMIT = 8;

function defaultGroups() {
  return [
    { key: "morning", name: "早自习" },
    { key: "am", name: "上午" },
    { key: "pm", name: "下午" },
    { key: "evening", name: "晚自习" },
  ];
}

const PERIOD_LIMIT = 16;

function mondayOf(text) {
  const [year, month, day] = String(text || todayString()).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const back = (date.getDay() + 6) % 7;
  return back ? addDays(text, -back) : text;
}

function defaultPeriods() {
  return [
    { name: "晨读", start: "06:40", end: "07:05", group: "morning" },
    { name: "1", start: "08:00", end: "08:45", group: "am" },
    { name: "2", start: "08:55", end: "09:40", group: "am" },
    { name: "3", start: "10:10", end: "10:50", group: "am" },
    { name: "4", start: "11:00", end: "11:35", group: "am" },
    { name: "5", start: "14:00", end: "14:40", group: "pm" },
    { name: "6", start: "14:50", end: "15:30", group: "pm" },
    { name: "7", start: "15:40", end: "16:20", group: "pm" },
    { name: "8", start: "16:50", end: "17:30", group: "pm" },
    { name: "9", start: "17:40", end: "18:15", group: "pm" },
    { name: "晚一", start: "19:05", end: "19:45", group: "evening" },
    { name: "晚二", start: "19:55", end: "20:35", group: "evening" },
  ];
}

const CLOCK_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 6:40 / 06:40 / 640 / 0640 / 6：40 都认，归一成 06:40；认不出返回空串。 */
function normalizeTime(text) {
  const raw = String(text || "")
    .trim()
    .replace(/[：.．]/g, ":");
  if (!raw) {
    return "";
  }
  if (CLOCK_RE.test(raw)) {
    return raw;
  }
  let hour;
  let minute;
  const colon = raw.match(/^(\d{1,2}):(\d{1,2})$/);
  if (colon) {
    hour = Number(colon[1]);
    minute = Number(colon[2]);
  } else {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 3 || digits.length > 4) {
      return "";
    }
    const padded = digits.padStart(4, "0");
    hour = Number(padded.slice(0, 2));
    minute = Number(padded.slice(2));
  }
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) {
    return "";
  }
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(hour)}:${pad(minute)}`;
}

Page({
  data: {
    loading: true,
    built: false,
    mine: true,
    tab: "weekday",
    weekendSplit: false,
    visibility: "both",
    periods: [],
    weekdayCount: 0,
    weekendCount: 0,
    homeCycle: { enabled: false, everyWeeks: 2, homeIndex: 2, anchor: "" },
    everyOptions: [],
    everyIndex: 0,
    homeOptions: [],
    homePickIndex: 0,
    overrideText: "",
    saving: false,
    maxPeriods: PERIOD_LIMIT,
    groups: [],
    canAddGroup: true,
  },

  onLoad(query) {
    this.ownerOpenid = query && query.owner ? query.owner : "";
    this.initialTab = query && query.tab === "weekend" ? "weekend" : "weekday";
    this.load();
  },

  async load() {
    const payload = this.ownerOpenid ? { ownerOpenid: this.ownerOpenid } : {};
    const res = await app.call("getTimetable", payload);
    if (!res.ok) {
      this.setData({ loading: false });
      wx.showToast({ title: res.message || "没读到课表", icon: "none" });
      return;
    }
    this.timetable = res.timetable;
    if (!res.timetable) {
      this.sets = { weekday: defaultPeriods(), weekend: [] };
      this.groups = defaultGroups();
      this.colors = {};
      this.lessons = [];
      this.weekStates = {};
      this.ownerOpenid = "";
      this.cycle = { enabled: false, everyWeeks: 2, homeIndex: 2, anchor: mondayOf(todayString()) };
    } else {
      this.sets = {
        weekday: res.timetable.periods.map((item) => ({ ...item })),
        weekend: (res.timetable.weekendPeriods || []).map((item) => ({ ...item })),
      };
      this.groups = (res.timetable.groups || []).map((item) => ({ ...item }));
      this.colors = { ...(res.timetable.colors || {}) };
      this.lessons = res.timetable.lessons.map((item) => ({ ...item }));
      this.weekStates = { ...(res.timetable.weekStates || {}) };
      this.ownerOpenid = res.timetable.ownerOpenid;
      this.cycle = res.timetable.homeCycle;
    }
    const weekendSplit = this.sets.weekend.length > 0;
    this.setData({
      loading: false,
      built: !!res.timetable,
      mine: res.mine !== false,
      weekendSplit,
      visibility: res.timetable && res.timetable.visibility === "self" ? "self" : "both",
      tab: this.initialTab || "weekday",
    });
    this.sets.weekday.forEach((item) => {
      item.id = this.stampId();
    });
    this.sets.weekend.forEach((item) => {
      item.id = this.stampId();
    });
    this.applyCycle(this.cycle);
    this.renderGroups();
    this.renderPeriods();
  },

  /** 谁能看：仅自己 / 双方可见。 */
  pickVisibility(event) {
    const value = event.currentTarget.dataset.value === "self" ? "self" : "both";
    this.setData({ visibility: value });
  },

  /** 当前正在编辑的那一套节次。 */
  currentSet() {
    return this.data.tab === "weekend" ? this.sets.weekend : this.sets.weekday;
  },

  /** 这一套管哪几天。改节次时只重排这几天已经填的课。 */
  daysOf(tab) {
    return tab === "weekend" ? [6, 7] : [1, 2, 3, 4, 5];
  },

  switchTab(event) {
    const tab = event.currentTarget.dataset.tab === "weekend" ? "weekend" : "weekday";
    if (tab === this.data.tab) {
      return;
    }
    this.setData({ tab });
    this.renderPeriods();
  },

  /** 关掉就和工作日共用一套；打开时把工作日那份复制过来，再自己删改。 */
  toggleWeekendSplit(event) {
    const split = event.detail.value;
    if (split && !this.sets.weekend.length) {
      this.sets.weekend = this.sets.weekday.map((item) => ({ ...item, id: this.stampId() }));
    }
    this.setData({ weekendSplit: split });
    this.renderPeriods();
  },

  stampId() {
    this.uid = (this.uid || 0) + 1;
    return `p${this.uid}`;
  },

  everyOptions() {
    return [2, 3, 4, 5, 6, 7, 8].map((value) => `每 ${value} 周`);
  },

  homeOptions(everyWeeks) {
    const list = [];
    for (let index = 1; index <= everyWeeks; index += 1) {
      list.push(`第 ${index} 周`);
    }
    return list;
  },

  applyCycle(cycle) {
    const everyOptions = this.everyOptions();
    const everyWeeks = Math.min(8, Math.max(2, Number(cycle.everyWeeks) || 2));
    const homeOptions = this.homeOptions(everyWeeks);
    const homeIndex = Math.min(everyWeeks, Math.max(1, Number(cycle.homeIndex) || everyWeeks));
    this.setData({
      homeCycle: {
        enabled: cycle.enabled === true,
        everyWeeks,
        homeIndex,
        anchor: mondayOf(cycle.anchor || todayString()),
      },
      everyOptions,
      everyIndex: Math.max(0, everyOptions.indexOf(`每 ${everyWeeks} 周`)),
      homeOptions,
      homePickIndex: Math.max(0, homeOptions.indexOf(`第 ${homeIndex} 周`)),
      overrideText: this.overrideText(this.weekStates),
    });
  },

  overrideText(weekStates) {
    const count = Object.keys(weekStates || {}).length;
    return count ? `已手动改过 ${count} 周` : "还没有手动调整过某一周";
  },

  renderPeriods() {
    const set = this.currentSet();
    const total = set.length;
    this.setData({
      periods: set.map((item, index) => ({
        ...item,
        groupName: this.groupName(item.group),
        first: index === 0,
        last: index === total - 1,
      })),
      weekdayCount: this.sets.weekday.length,
      weekendCount: this.sets.weekend.length,
    });
  },

  /* ---------------- 回家周 ---------------- */

  toggleHome(event) {
    this.setData({ "homeCycle.enabled": event.detail.value });
  },

  onEvery(event) {
    const everyWeeks = Number(this.data.everyOptions[event.detail.value].replace(/\D/g, ""));
    const homeOptions = this.homeOptions(everyWeeks);
    const homeIndex = Math.min(everyWeeks, this.data.homeCycle.homeIndex);
    this.setData({
      "homeCycle.everyWeeks": everyWeeks,
      "homeCycle.homeIndex": homeIndex,
      everyIndex: event.detail.value,
      homeOptions,
      homePickIndex: Math.max(0, homeOptions.indexOf(`第 ${homeIndex} 周`)),
    });
  },

  onHomePick(event) {
    const homeIndex = event.detail.value + 1;
    this.setData({ "homeCycle.homeIndex": homeIndex, homePickIndex: event.detail.value });
  },

  onAnchor(event) {
    this.setData({ "homeCycle.anchor": mondayOf(event.detail.value) });
  },

  clearOverrides() {
    if (!Object.keys(this.weekStates || {}).length) {
      return;
    }
    wx.showModal({
      title: "清空手动调整",
      content: "之前单独改过的那几周会回到按轮换推算的状态。",
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        this.weekStates = {};
        this.setData({ overrideText: this.overrideText(this.weekStates) });
      },
    });
  },

  /* ---------------- 节次 ---------------- */

  onName(event) {
    const index = Number(event.currentTarget.dataset.index);
    const set = this.currentSet();
    if (!set[index]) {
      return;
    }
    const name = event.detail.value.slice(0, 10);
    set[index].name = name;
    // 同步到视图里的那一份，避免别处刷新时把正在输入的字退回去
    this.setData({ [`periods[${index}].name`]: name });
  },

  /** 点开滚轮之前记下原来的值，输入不合法时好还原。 */
  onTimeFocus(event) {
    const index = Number(event.currentTarget.dataset.index);
    const key = event.currentTarget.dataset.key;
    const set = this.currentSet();
    this.timeBackup = set[index] ? set[index][key] : "";
  },

  /** 边输入边记在内存里，先不动界面，免得光标跳动。 */
  onTimeInput(event) {
    const index = Number(event.currentTarget.dataset.index);
    const key = event.currentTarget.dataset.key;
    const set = this.currentSet();
    if (set[index]) {
      set[index][key] = event.detail.value;
    }
  },

  /** 离开输入框时归一成 06:40；认不出就退回原值并提示。 */
  onTimeBlur(event) {
    const index = Number(event.currentTarget.dataset.index);
    const key = event.currentTarget.dataset.key;
    const set = this.currentSet();
    if (!set[index]) {
      return;
    }
    const typed = String(event.detail.value || "").trim();
    const fixed = normalizeTime(typed);
    if (fixed) {
      set[index][key] = fixed;
    } else {
      set[index][key] = this.timeBackup || set[index][key];
      if (typed) {
        wx.showToast({ title: "时间像 6:40 这样写", icon: "none" });
      }
    }
    this.renderPeriods();
  },

  onTime(event) {
    const index = Number(event.currentTarget.dataset.index);
    const key = event.currentTarget.dataset.key;
    const set = this.currentSet();
    if (!set[index]) {
      return;
    }
    set[index][key] = event.detail.value;
    this.renderPeriods();
  },

  /**
   * 分组表：顺序就是课表页分组标题的顺序。改名、加分组都改这里，
   * 节次上只存 key，所以改名不影响已经排好的节次。
   */
  groupList() {
    return this.groups && this.groups.length ? this.groups : defaultGroups();
  },

  groupName(key) {
    const found = this.groupList().find((item) => item.key === key);
    return found ? found.name : "上午";
  },

  /** 新增分组用：取第一个没用过的 g1、g2… */
  freeGroupKey() {
    const used = new Set(this.groupList().map((item) => item.key));
    for (let index = 1; index <= GROUP_LIMIT; index += 1) {
      const key = `g${index}`;
      if (!used.has(key)) {
        return key;
      }
    }
    return "";
  },

  renderGroups() {
    const groups = this.groupList().map((item) => ({
      key: item.key,
      name: item.name,
    }));
    this.setData({ groups, canAddGroup: groups.length < GROUP_LIMIT });
  },

  addGroup() {
    if (this.groupList().length >= GROUP_LIMIT) {
      wx.showToast({ title: `最多 ${GROUP_LIMIT} 个分组`, icon: "none" });
      return;
    }
    const key = this.freeGroupKey();
    if (!key) {
      return;
    }
    wx.showModal({
      title: "新分组",
      editable: true,
      placeholderText: "比如 午休、课间操",
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        const name = String(res.content || "").trim().slice(0, GROUP_NAME_LIMIT);
        if (!name) {
          wx.showToast({ title: "给分组起个名字", icon: "none" });
          return;
        }
        this.groups = this.groupList().concat([{ key, name }]);
        this.renderGroups();
        this.renderPeriods();
      },
    });
  },

  renameGroup(event) {
    const key = event.currentTarget.dataset.key;
    const group = this.groupList().find((item) => item.key === key);
    if (!group) {
      return;
    }
    wx.showModal({
      title: "分组名字",
      editable: true,
      content: group.name,
      placeholderText: "最多 6 个字",
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        const name = String(res.content || "").trim().slice(0, GROUP_NAME_LIMIT);
        if (!name) {
          wx.showToast({ title: "名字不能空着", icon: "none" });
          return;
        }
        this.groups = this.groupList().map((item) => (item.key === key ? { key, name } : item));
        this.renderGroups();
        this.renderPeriods();
      },
    });
  },

  removeGroup(event) {
    const key = event.currentTarget.dataset.key;
    const group = this.groupList().find((item) => item.key === key);
    if (!group) {
      return;
    }
    const used = this.sets.weekday
      .concat(this.sets.weekend)
      .filter((item) => item.group === key).length;
    if (used) {
      wx.showToast({ title: `还有 ${used} 节在这个分组，先挪走`, icon: "none" });
      return;
    }
    this.groups = this.groupList().filter((item) => item.key !== key);
    this.renderGroups();
  },

  cycleGroup(event) {
    const index = Number(event.currentTarget.dataset.index);
    const set = this.currentSet();
    const period = set[index];
    if (!period) {
      return;
    }
    const keys = this.groupList().map((item) => item.key);
    const next = (keys.indexOf(period.group) + 1) % keys.length;
    period.group = keys[next];
    this.renderPeriods();
  },

  /** 节次换了位置，这几天已经填的课跟着走；另一套节次的天不受影响。 */
  remap(moved) {
    const set = this.currentSet();
    const days = this.daysOf(this.data.tab);
    this.lessons = this.lessons
      .map((lesson) => {
        if (days.indexOf(lesson.day) < 0) {
          return lesson;
        }
        const target = moved[lesson.period];
        const next = target ? set.indexOf(target) : -1;
        return next < 0 ? null : { ...lesson, period: next };
      })
      .filter(Boolean);
  },

  movePeriod(event) {
    const index = Number(event.currentTarget.dataset.index);
    const delta = Number(event.currentTarget.dataset.delta);
    const set = this.currentSet();
    const to = index + delta;
    if (to < 0 || to >= set.length) {
      return;
    }
    const moved = set.slice();
    const [item] = set.splice(index, 1);
    set.splice(to, 0, item);
    this.remap(moved);
    this.renderPeriods();
  },

  removePeriod(event) {
    const index = Number(event.currentTarget.dataset.index);
    const set = this.currentSet();
    if (set.length <= 1) {
      wx.showToast({ title: "至少留一节", icon: "none" });
      return;
    }
    const weekend = this.data.tab === "weekend";
    const scope = weekend ? "周六日" : "周一到周五";
    const other = weekend ? "周一到周五" : "周六日";
    wx.showModal({
      title: `删掉${scope}的这一节？`,
      content: `只从「${scope}」这套里删，${other}不受影响。这一节里已经填的课也会一起删掉。`,
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        const moved = set.slice();
        set.splice(index, 1);
        this.remap(moved);
        this.renderPeriods();
      },
    });
  },

  addPeriod() {
    const set = this.currentSet();
    if (set.length >= PERIOD_LIMIT) {
      wx.showToast({ title: `最多 ${PERIOD_LIMIT} 节`, icon: "none" });
      return;
    }
    const last = set[set.length - 1];
    const start = last ? last.end : "08:00";
    const [hour, minute] = start.split(":").map(Number);
    const endMinutes = hour * 60 + minute + 40;
    const pad = (value) => String(value).padStart(2, "0");
    set.push({
      id: this.stampId(),
      name: `第${set.length + 1}节`,
      start,
      end: `${pad(Math.floor(endMinutes / 60) % 24)}:${pad(endMinutes % 60)}`,
      group: last ? last.group : "am",
    });
    this.renderPeriods();
  },

  resetPeriods() {
    const isWeekend = this.data.tab === "weekend";
    wx.showModal({
      title: "用默认节次？",
      content: `${isWeekend ? "周六日" : "周一到周五"}这份节次会被换成默认的作息，${isWeekend ? "这两天" : "这五天"}已经填好的课可能会对不上。`,
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        const days = this.daysOf(this.data.tab);
        const fresh = defaultPeriods();
        fresh.forEach((item) => {
          item.id = this.stampId();
        });
        // 默认节次用到早自习、晚自习这些 key，用户可能已经把分组删了，补回来免得标题对不上。
        const known = new Set(this.groupList().map((item) => item.key));
        defaultGroups().forEach((item) => {
          if (!known.has(item.key)) {
            known.add(item.key);
            this.groups = this.groupList().concat([item]);
          }
        });
        if (isWeekend) {
          this.sets.weekend = fresh;
        } else {
          this.sets.weekday = fresh;
        }
        this.lessons = this.lessons.filter((item) => days.indexOf(item.day) < 0 || item.period < fresh.length);
        this.renderGroups();
        this.renderPeriods();
      },
    });
  },

  /** 保存前把两套时间都归一，避免云端回落成默认值后跟界面对不上。 */
  normalizeSets() {
    const fix = (list) =>
      list.map((item) => ({
        ...item,
        start: normalizeTime(item.start) || "08:00",
        end: normalizeTime(item.end) || "08:40",
      }));
    this.sets.weekday = fix(this.sets.weekday);
    this.sets.weekend = fix(this.sets.weekend);
  },

  async save() {
    if (this.data.saving) {
      return;
    }
    if (!this.sets.weekday.length) {
      wx.showToast({ title: "先加一节", icon: "none" });
      return;
    }
    if (this.data.weekendSplit && !this.sets.weekend.length) {
      wx.showToast({ title: "周六日至少留一节", icon: "none" });
      return;
    }
    this.normalizeSets();
    this.setData({ saving: true });
    const res = await app.call("saveTimetable", {
      ownerOpenid: this.ownerOpenid,
      visibility: this.data.visibility,
      groups: this.groupList(),
      periods: this.sets.weekday,
      weekendPeriods: this.data.weekendSplit ? this.sets.weekend : [],
      lessons: this.lessons,
      colors: this.colors,
      homeCycle: this.data.homeCycle,
      weekStates: this.weekStates,
    });
    this.setData({ saving: false });
    if (!res.ok) {
      wx.showToast({ title: res.message || "没存上", icon: "none" });
      return;
    }
    // 用云端返回的那一份重建界面：万一有字段被规范化，当场就能看到，下次进来也不会"变样"。
    this.applySaved(res.timetable);
    wx.showToast({ title: "已保存", icon: "none" });
    setTimeout(() => wx.navigateBack(), 400);
  },

  applySaved(timetable) {
    this.ownerOpenid = timetable.ownerOpenid;
    this.timetable = timetable;
    this.sets = {
      weekday: timetable.periods.map((item) => ({ ...item })),
      weekend: (timetable.weekendPeriods || []).map((item) => ({ ...item })),
    };
    this.sets.weekday.forEach((item) => {
      item.id = this.stampId();
    });
    this.sets.weekend.forEach((item) => {
      item.id = this.stampId();
    });
    this.lessons = timetable.lessons.map((item) => ({ ...item }));
    this.groups = (timetable.groups || []).map((item) => ({ ...item }));
    this.colors = { ...(timetable.colors || {}) };
    this.weekStates = { ...(timetable.weekStates || {}) };
    this.setData({
      weekendSplit: this.sets.weekend.length > 0,
      visibility: timetable.visibility === "self" ? "self" : "both",
    });
    this.applyCycle(timetable.homeCycle);
    this.renderGroups();
    this.renderPeriods();
  },
});
