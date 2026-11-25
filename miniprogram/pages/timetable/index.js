const app = getApp();
const { addDays, todayString } = require("../../utils/date");
const festivals = require("../../utils/festivals");

const WEEK_CHARS = ["一", "二", "三", "四", "五", "六", "日"];
const TONE_COUNT = 12;
const TONES = [];
for (let index = 0; index < TONE_COUNT; index += 1) {
  TONES.push(index);
}

function weekdayOf(text) {
  const [year, month, day] = String(text || "").split("-").map(Number);
  const week = new Date(year, month - 1, day).getDay();
  return week === 0 ? 7 : week;
}

function mondayOf(text) {
  const base = text || todayString();
  const back = weekdayOf(base) - 1;
  return back ? addDays(base, -back) : base;
}

Page({
  data: {
    loading: true,
    built: false,
    mine: true,
    state: "class",
    cycleText: "",
    weekMonday: "",
    days: [],
    rows: [],
    weekHoliday: "",
    hasLesson: false,
    weekendDiffers: false,
    weekendHidden: false,
    hiddenGroups: [],
    hintText: "",
    tones: TONES,
    toneScope: "cell",
    toneShared: false,
    editOpen: false,
    editTitle: "",
    editEmpty: false,
    form: { text: "", tone: -1 },
  },

  onShow() {
    this.load();
  },

  async load() {
    this.shownGroups = null;
    const payload = this.ownerOpenid ? { ownerOpenid: this.ownerOpenid } : {};
    const res = await app.call("getTimetable", payload);
    this.setData({ loading: false });
    if (!res.ok) {
      wx.showToast({ title: res.message || "没读到课表", icon: "none" });
      return;
    }
    this.timetable = res.timetable;
    this.ownerOpenid = res.timetable ? res.timetable.ownerOpenid : this.ownerOpenid;
    this.state = res.state;
    this.weekMonday = res.weekMonday;
    if (!res.timetable) {
      this.setData({
        built: false,
        state: res.state,
        weekMonday: res.weekMonday,
        rows: [],
        days: [],
        hasLesson: false,
        weekendDiffers: false,
        weekendHidden: false,
        hiddenGroups: [],
        hintText: "",
      });
      return;
    }
    this.setData({
      built: true,
      mine: res.mine !== false,
      state: res.state,
      weekMonday: res.weekMonday,
      cycleText: this.describeCycle(res.timetable.homeCycle),
    });
    this.autoMap = null;
    this.renderWeek();
  },

  describeCycle(cycle) {
    if (!cycle || !cycle.enabled) {
      return "";
    }
    return `每 ${cycle.everyWeeks} 周，第 ${cycle.homeIndex} 周回家`;
  },

  /** 周六日单独排过就用周末那套节次，否则和工作日一样。 */
  periodsFor(day) {
    const timetable = this.timetable || {};
    const weekend = timetable.weekendPeriods || [];
    return day >= 6 && weekend.length ? weekend : timetable.periods || [];
  },

  /** 分组表：顺序就是显示顺序。云端会下发，缺失时按内置四个兜底。 */
  groupList() {
    const groups = (this.timetable && this.timetable.groups) || [];
    if (groups.length) {
      return groups;
    }
    return [
      { key: "morning", name: "早自习" },
      { key: "am", name: "上午" },
      { key: "pm", name: "下午" },
      { key: "evening", name: "晚自习" },
    ];
  },

  /** 一套节次按分组分桶，桶里存原数组下标，前后顺序不变。 */
  groupBuckets(periods) {
    const buckets = {};
    periods.forEach((item, index) => {
      const key = item.group || "am";
      if (!buckets[key]) {
        buckets[key] = [];
      }
      buckets[key].push({ item, index });
    });
    return buckets;
  },

  /**
   * 整周铺开。左右两套节次先按分组分桶、再在组内对齐——直接按下标对会在
   * 两套节数不同时整体错位（周末少一节，晚自习就跑到下午去了）。
   * 上午、下午永远显示，其余分组整周没课就整块收起；周六日两天没课也不占列。
   */
  renderWeek() {
    const timetable = this.timetable;
    const lessons = timetable.lessons || [];
    const weekday = timetable.periods || [];
    const weekendOwn = timetable.weekendPeriods || [];
    const weekend = weekendOwn.length ? weekendOwn : weekday;

    const found = {};
    lessons.forEach((item) => {
      found[`${item.day}-${item.period}`] = item;
    });
    // 周六日有过课、或者单独排过一套作息，才给周末留两列。
    const showWeekend =
      weekendOwn.length > 0 || lessons.some((item) => Number(item.day) >= 6);

    const todayWeek = this.weekMonday === mondayOf(todayString());
    const today = weekdayOf(todayString());
    const days = WEEK_CHARS.map((char, index) => {
      const day = index + 1;
      const fullDate = addDays(this.weekMonday, index);
      const parts = fullDate.split("-").map(Number);
      const holiday = festivals.holidayOf(fullDate);
      return {
        day,
        char,
        fullDate,
        date: `${parts[1]}/${parts[2]}`,
        isToday: todayWeek && today === day,
        weekend: day >= 6,
        rest: !!holiday && holiday.type === "holiday",
        work: !!holiday && holiday.type === "workday",
        holidayName: holiday ? holiday.name : "",
      };
    });
    const shown = days.filter((day) => showWeekend || day.day < 6);

    const colors = timetable.colors || {};
    const auto = this.autoTones(lessons, colors);
    const differs = showWeekend && weekend !== weekday && this.periodsDiffer(weekday, weekend);
    this.weekendDiffers = differs;

    const wdBuckets = this.groupBuckets(weekday);
    const weBuckets = this.groupBuckets(weekend);
    const collapsed = this.shownGroups || new Set();
    const rows = [];
    const hidden = [];
    this.groupList().forEach((group) => {
      const wd = wdBuckets[group.key] || [];
      const we = weBuckets[group.key] || [];
      const count = Math.max(wd.length, we.length);
      if (!count) {
        return;
      }
      // 上午、下午是课表主体，整周空着也留着，不然没地方填第一节课。
      // 其余分组整周没课就收起，但点名字能临时展开，不然连第一节课都填不了。
      if (group.key !== "am" && group.key !== "pm" && !collapsed.has(group.key)) {
        const busy = shown.some((day) => {
          const bucket = day.weekend ? we : wd;
          return bucket.some((entry) => {
            const lesson = found[`${day.day}-${entry.index}`];
            return lesson && lesson.text;
          });
        });
        if (!busy) {
          hidden.push({ key: group.key, name: group.name });
          return;
        }
      }
      for (let i = 0; i < count; i += 1) {
        const base = wd[i];
        const own = we[i];
        if (i === 0) {
          rows.push({ type: "group", key: `g-${group.key}`, name: group.name });
        }
        const cells = shown.map((day) => {
          const entry = day.weekend ? own : base;
          if (!entry) {
            return {
              day: day.day,
              period: -1,
              disabled: true,
              text: "",
              empty: true,
              tone: -1,
              isToday: day.isToday,
            };
          }
          const lesson = found[`${day.day}-${entry.index}`];
          const text = lesson ? lesson.text || "" : "";
          return {
            day: day.day,
            period: entry.index,
            disabled: false,
            text,
            empty: !text,
            tone: text ? this.toneOf(text, lesson, colors, auto) : -1,
            isToday: day.isToday,
          };
        });
        rows.push({
          type: "row",
          key: `p-${group.key}-${i}`,
          start: base ? base.item.start : "",
          name: base ? base.item.name : "",
          weekStart: differs && own ? own.item.start : "",
          weekName: differs && own ? own.item.name : "",
          cells,
        });
      }
    });

    const weekHoliday = shown
      .filter((day) => day.rest || day.work)
      .map((day) => `周${day.char} ${day.holidayName}${day.rest ? " 放假" : "调休上班"}`)
      .join(" · ");

    const notes = [];
    if (!showWeekend) {
      notes.push("周六日没排课，已收起（去「编辑」开「周末单独排」）");
    }

    this.autoMap = auto;
    this.setData({
      days: shown,
      rows,
      weekHoliday,
      hiddenGroups: hidden,
      hasLesson: lessons.length > 0,
      weekendDiffers: differs,
      weekendHidden: !showWeekend,
      hintText: notes.length ? notes.join("；") : "",
    });
  },

  /** 被收起的分组点一下临时展开，好给它填第一节课。 */
  showGroup(event) {
    const key = event.currentTarget.dataset.key;
    if (!key) {
      return;
    }
    if (!this.shownGroups) {
      this.shownGroups = new Set();
    }
    this.shownGroups.add(key);
    this.renderWeek();
  },

  /** 周末那套和工作日是不是真不一样（节数不同，或任一节的时间/名字不同）。 */
  periodsDiffer(weekday, weekend) {
    if (weekday === weekend) {
      return false;
    }
    if (weekday.length !== weekend.length) {
      return true;
    }
    return weekend.some((item, index) => {
      const base = weekday[index];
      return !base || base.start !== item.start || base.end !== item.end || base.name !== item.name;
    });
  },

  /**
   * 同样的文字给同样的颜色。按天、按节次顺序扫一遍，第一次见到的文字领下一个号。
   * 手动指定过整体颜色的文字不占号，免得后面的课文跳着用色。
   */
  autoTones(lessons, colors) {
    const auto = {};
    let next = 0;
    lessons
      .slice()
      .sort((left, right) => left.day - right.day || left.period - right.period)
      .forEach((item) => {
        const text = item.text || "";
        if (!text || auto[text] !== undefined || typeof colors[text] === "number") {
          return;
        }
        auto[text] = next % TONE_COUNT;
        next += 1;
      });
    return auto;
  },

  /** 生效的颜色：这一格单独设过就用它，其次整段文字统一的那个，最后才是自动分配。 */
  toneOf(text, lesson, colors, auto) {
    if (lesson && typeof lesson.tone === "number") {
      return lesson.tone;
    }
    if (typeof colors[text] === "number") {
      return colors[text];
    }
    const table = auto || this.autoMap || {};
    return typeof table[text] === "number" ? table[text] : -1;
  },

  /** 手动改本周：上课 / 回家 / 跟随轮换。 */
  tapWeekState() {
    const cycle = this.timetable ? this.timetable.homeCycle : null;
    if (!cycle || !cycle.enabled) {
      return;
    }
    wx.showActionSheet({
      itemList: ["本周上课", "本周回家", "跟随轮换"],
      success: (res) => {
        const weekStates = { ...(this.timetable.weekStates || {}) };
        if (res.tapIndex === 2) {
          delete weekStates[this.weekMonday];
        } else {
          weekStates[this.weekMonday] = res.tapIndex === 1 ? "home" : "class";
        }
        this.save({ weekStates });
      },
      fail() {},
    });
  },

  async save(patch) {
    const timetable = this.timetable;
    const sentLessons = patch.lessons || timetable.lessons;
    const sentColors = patch.colors || timetable.colors || {};
    const res = await app.call("saveTimetable", {
      ownerOpenid: this.ownerOpenid,
      periods: timetable.periods,
      weekendPeriods: timetable.weekendPeriods || [],
      lessons: sentLessons,
      colors: sentColors,
      homeCycle: patch.homeCycle || timetable.homeCycle,
      weekStates: patch.weekStates || timetable.weekStates,
    });
    if (!res.ok) {
      wx.showToast({ title: res.message || "没存上", icon: "none" });
      return false;
    }
    this.warnIfColorDropped(res.timetable, sentLessons, sentColors);
    this.timetable = res.timetable;
    this.ownerOpenid = res.timetable.ownerOpenid;
    this.state = res.state;
    this.autoMap = null;
    this.setData({
      state: res.state,
      cycleText: this.describeCycle(res.timetable.homeCycle),
      mine: res.mine !== false,
    });
    this.renderWeek();
    return true;
  },

  /**
   * 云函数没重新部署时，服务端还不认识 tone / colors，会把它们丢掉，
   * 表现就是「选了颜色，存完又变回自动的」。认出来只提醒一次。
   */
  warnIfColorDropped(returned, sentLessons, sentColors) {
    if (this.cloudWarned || !returned) {
      return;
    }
    const sentTone = sentLessons.some((item) => typeof item.tone === "number");
    const gotTone = (returned.lessons || []).some((item) => typeof item.tone === "number");
    const kept = Object.keys(sentColors).filter((key) =>
      sentLessons.some((item) => (item.text || "") === key),
    );
    const gotColors = Object.keys(returned.colors || {}).length;
    if (!(sentTone && !gotTone) && !(kept.length && !gotColors)) {
      return;
    }
    this.cloudWarned = true;
    wx.showModal({
      title: "颜色没存上",
      content: "云函数还是旧版本，重新部署 cloudfunctions/api 之后就能记住颜色。",
      showCancel: false,
    });
  },

  openCell(event) {
    const day = Number(event.currentTarget.dataset.day);
    const period = Number(event.currentTarget.dataset.period);
    if (!day || day < 1 || day > 7 || !Number.isInteger(period) || period < 0) {
      return;
    }
    const info = this.periodsFor(day)[period];
    if (!info) {
      return;
    }
    const lesson = (this.timetable.lessons || []).find(
      (item) => item.day === day && item.period === period,
    );
    const text = lesson ? lesson.text || "" : "";
    const colors = this.timetable.colors || {};
    const own = this.weekendDiffers && day >= 6;
    this.editDay = day;
    this.editPeriod = period;
    this.toneTouched = false;
    const shared = text ? this.countSame(text, day, period) > 0 : false;
    this.setData({
      editOpen: true,
      editEmpty: !lesson,
      editTitle: `周${WEEK_CHARS[day - 1]} · ${info.name}${own ? ` ${info.start}` : ""}`,
      form: { text, tone: text ? this.toneOf(text, lesson, colors) : -1 },
      toneScope: "cell",
      toneShared: shared,
    });
  },

  /** 这个字还出现在别的格子几次（不算当前这一格）。 */
  countSame(text, day, period) {
    if (!text) {
      return 0;
    }
    return (this.timetable.lessons || []).filter(
      (item) => (item.text || "") === text && !(item.day === day && item.period === period),
    ).length;
  },

  /** 改色的范围：只动这一格，还是所有同名的格子一起动。 */
  pickScope(event) {
    const scope = event.currentTarget.dataset.scope === "all" ? "all" : "cell";
    this.setData({ toneScope: scope });
  },

  closeCell() {
    this.setData({ editOpen: false });
  },

  noop() {},

  /** 改了文字就重新认一次颜色：还没手动选过色时跟着自动分配走。 */
  onText(event) {
    const text = event.detail.value;
    if (this.toneTouched) {
      this.setData({ "form.text": text });
      return;
    }
    const colors = (this.timetable && this.timetable.colors) || {};
    const name = String(text || "").trim();
    const same = name
      ? (this.timetable.lessons || []).find((item) => (item.text || "") === name)
      : null;
    this.setData({ form: { text, tone: same ? this.toneOf(name, same, colors) : -1 } });
  },

  /** 点色点直接上色；范围由上面那两个选项决定，不再弹窗打断。 */
  pickTone(event) {
    const tone = Number(event.currentTarget.dataset.tone);
    if (!Number.isInteger(tone) || tone < 0 || tone >= TONE_COUNT) {
      return;
    }
    this.toneTouched = true;
    this.setData({ "form.tone": tone });
  },

  async saveCell() {
    const text = String(this.data.form.text || "").trim().slice(0, 20);
    const tone = Number(this.data.form.tone);
    const touched = this.toneTouched === true && Number.isInteger(tone) && tone >= 0;
    const scope = this.data.toneScope === "all" ? "all" : "cell";
    const day = this.editDay;
    const period = this.editPeriod;
    const kept = (this.timetable.lessons || []).filter(
      (item) => !(item.day === day && item.period === period),
    );
    const colors = { ...(this.timetable.colors || {}) };
    if (!text) {
      const ok = await this.save({ lessons: kept, colors });
      if (ok) {
        this.setData({ editOpen: false });
      }
      return;
    }
    if (touched && scope === "all") {
      colors[text] = tone;
      kept.forEach((item) => {
        if ((item.text || "") === text) {
          delete item.tone;
        }
      });
      kept.push({ day, period, text });
    } else if (touched) {
      kept.push({ day, period, text, tone });
    } else {
      kept.push({ day, period, text });
    }
    const ok = await this.save({ lessons: kept, colors });
    if (ok) {
      this.setData({ editOpen: false });
    }
  },

  async clearCell() {
    const lessons = (this.timetable.lessons || []).filter(
      (item) => !(item.day === this.editDay && item.period === this.editPeriod),
    );
    const ok = await this.save({ lessons });
    if (ok) {
      this.setData({ editOpen: false });
    }
  },

  openSettings() {
    const params = [];
    if (this.ownerOpenid) {
      params.push(`owner=${this.ownerOpenid}`);
    }
    wx.navigateTo({ url: `/pages/timetable/settings${params.length ? `?${params.join("&")}` : ""}` });
  },
});
