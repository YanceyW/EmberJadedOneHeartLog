const app = getApp();
const { buildMarks } = require("../../utils/cycle");
const { addDays, anniversaryOn, anniversaryIndex, diffDays, displayDate, solarTermName, SOLAR_FESTIVALS, todayString } = require("../../utils/date");
const { solarToLunar } = require("../../utils/lunar");
const { birthdayPhrase } = require("../../utils/birthday");
const { getTabClearance, watchTabClearance } = require("../../utils/layout");
const { TEMPLATE_ID, requestOnce } = require("../../utils/subscribe");
const { skyMoment, moonMoment, moonPhaseKey, skyColors, clockMinutes, frameEdges, createCast, stepCast, paintCast, nudgeCast, brushSnow, pokeFog, makeFlakeSprite } = require("../../utils/sky");

const DEFAULT_NOTE = "今天也要好好照顾自己。";
const READING_KEY = "reading-cache";
const SKY_CHOICES = [
  { key: "sun", name: "晴" },
  { key: "cloud", name: "多云" },
  { key: "fog", name: "雾" },
  { key: "rain", name: "雨" },
  { key: "heavy", name: "大雨" },
  { key: "snow", name: "雪" },
  { key: "storm", name: "雷雨" },
  { key: "wind", name: "有风" },
];

const LUNAR_FESTIVALS = {
  "1-1": "春节",
  "1-15": "元宵节",
  "5-5": "端午节",
  "7-7": "七夕",
  "8-15": "中秋节",
  "9-9": "重阳节",
};

function todayCaption() {
  const text = todayString();
  const [year, month, day] = text.split("-").map((item) => Number(item));
  const week = "日一二三四五六"[new Date(year, month - 1, day).getDay()];
  const lunar = solarToLunar(year, month, day);
  const lunarFest = lunar && !lunar.isLeap ? LUNAR_FESTIVALS[`${lunar.month}-${lunar.day}`] : "";
  const extra = [solarTermName(year, month, day), lunarFest, SOLAR_FESTIVALS[`${month}-${day}`]].filter(Boolean).join(" · ");
  return `${month}月${day}日 星期${week}${extra ? ` · ${extra}` : ""}`;
}

Component({
  data: {
    hello: "你好",
    weatherText: "正在获取当地天气",
    weatherPlace: "",
    weatherName: "",
    weatherTemp: "",
    tempMin: "",
    tempMax: "",
    weatherKind: "",
    clothing: "",
    weatherHint: "",
    feelsLike: "",
    windText: "",
    humidityText: "",
    hours: [],
    hints: [],
    todayLine: "",
    refreshing: false,
    needLocate: false,
    reminder: "",
    nextText: "最近还没有安排",
    aiLines: [],
    aiScore: 0,
    needCity: false,
    cityName: "",
    region: ["北京市", "北京市", "东城区"],
    tabClearance: 120,
    noteVisible: false,
    noteText: "",
    noteFrom: "",
    noteOpen: false,
    noteDraft: "",
    noteSending: false,
    subscribeHint: !!TEMPLATE_ID,
    skyPreview: false,
    skyChoices: SKY_CHOICES,
    skyPicked: "",
    skyNight: false,
    skyOn: false,
    skyDark: false,
    skyPhase: "day",
    skyBroken: false,
    skyStyle: "",
  },
  properties: {
    active: {
      type: Boolean,
      value: false,
    },
  },
  observers: {
    active(value) {
      if (value && this.ready) {
        this.refreshLists();
      }
      this.syncSkyPause();
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
      this.pauseCardSky();
      this.skyToken = (this.skyToken || 0) + 1;
      this.sky = null;
      this.cardFocus = null;
      this.skyRect = null;
    },
  },
  pageLifetimes: {
    show() {
      this.pageHidden = false;
      this.onShow();
      this.syncSkyPause();
    },
    hide() {
      this.pageHidden = true;
      this.syncSkyPause();
    },
  },
  methods: {
  onShow() {
    this.setData({ tabClearance: getTabClearance() });
    this.setGreeting();
    this.load();
  },

  setGreeting(nickName) {
    const hour = new Date().getHours();
    let hello = "晚上好";
    if (hour < 11) hello = "早上好";
    else if (hour < 14) hello = "中午好";
    else if (hour < 18) hello = "下午好";
    const name = String(nickName || "").trim();
    this.nickName = name;
    this.setData({ hello: name ? `${name}，${hello}` : hello, todayLine: todayCaption() });
  },

  async load() {
    const result = await app.loadSession(true);
    if (!result.ok) {
      this.setData({ reminder: result.message });
      return;
    }
    const cityName = wx.getStorageSync("weather-city") || "";
    const cityParts = cityName.split(" ");
    this.setGreeting(result.user.nickName);
    this.setData({
      reminder: this.buildReminder(result),
      nextText: this.buildNext(result),
      cityName,
      region: cityParts.length === 3 ? cityParts : this.data.region,
    });
    this.ready = true;
    this.showCachedReading();
    const weather = await this.ensureWeather(false);
    await this.loadNote(result);
    if (!result.user.birthDate) {
      return;
    }
    await this.refreshReading(weather);
  },

  showCachedReading() {
    const cached = wx.getStorageSync(READING_KEY);
    if (cached && cached.lines && cached.lines.length) {
      this.setData({ aiLines: cached.lines, aiScore: cached.score || 0, reminder: "" });
    }
  },

  async loadNote(session) {
    if (!session || !session.mutual) {
      this.setData({ noteVisible: false, noteText: "", noteFrom: "" });
      return;
    }
    const note = await app.call("partnerNote");
    if (!note.ok || !note.visible) {
      this.setData({ noteVisible: false });
      return;
    }
    this.setData({
      noteVisible: true,
      noteText: note.text || "",
      noteFrom: note.fromName || "TA",
    });
  },

  openNote() {
    this.setData({ noteOpen: true, noteDraft: "" });
  },

  closeNote() {
    if (this.data.noteSending) return;
    this.setData({ noteOpen: false });
  },

  noop() {},

  onNoteDraft(event) {
    this.setData({ noteDraft: event.detail.value });
  },

  sendNote() {
    const typed = String(this.data.noteDraft || "").trim();
    const text = (typed || DEFAULT_NOTE).slice(0, 80);
    if (!text || this.data.noteSending) {
      return;
    }
    const go = () => this.saveNote(text);
    if (!TEMPLATE_ID) {
      go();
      return;
    }
    requestOnce().then(go);
  },

  async saveNote(text) {
    this.setData({ noteSending: true });
    const result = await app.call("sendNote", { text });
    this.setData({ noteSending: false });
    if (!result.ok) {
      wx.showToast({ title: result.message || "没有送出", icon: "none" });
      return;
    }
    this.setData({ noteOpen: false });
    wx.showToast({ title: "已送到对方首页", icon: "none" });
  },

  async refreshLists() {
    const result = await app.loadSession(true);
    if (!result.ok) {
      return;
    }
    this.setGreeting(result.user.nickName);
    this.setData({
      reminder: this.buildReminder(result),
      nextText: this.buildNext(result),
    });
  },

  async refreshReading(weather) {
    const parts = [];
    if (weather && weather.temp !== undefined && weather.temp !== "") {
      parts.push(`${weather.temp}° ${weather.text || ""}`.trim());
      if (weather.feelsLike !== "" && weather.feelsLike !== undefined) parts.push(`体感${weather.feelsLike}°`);
      if (weather.windText) parts.push(weather.windText);
      if (weather.hints && weather.hints.length) parts.push(weather.hints.join("。"));
      if (weather.clothing) parts.push(weather.clothing);
    }
    const reading = await app.call("dailyReading", {
      weather: parts.join("，"),
      weatherSource: weather ? weather.source : "",
    });
    if (reading.ok && reading.lines && reading.lines.length) {
      wx.setStorageSync(READING_KEY, { lines: reading.lines, score: reading.score || 0, at: Date.now() });
      this.setData({ aiLines: reading.lines, aiScore: reading.score, reminder: "" });
    }
  },

  /** 女方看自己的预测；互为对象的男方直接看她的预测。 */
  buildReminder(session) {
    const user = session.user;
    const usePartner = user.gender === "male" && session.mutual && session.partner && session.partner.gender === "female";
    const owner = usePartner ? session.partner : user;
    if (owner.gender !== "female" || !session.periods.length) {
      return "";
    }
    const marks = buildMarks(session.periods, owner.cycleLength, owner.periodLength);
    if (!marks.predictedStart) {
      return "";
    }
    const days = diffDays(todayString(), marks.predictedStart);
    if (days < 0) {
      return "";
    }
    const strong = days === 0 || days === 1 || days === 2 || days === 3 || days === 7;
    if (!strong) {
      return `预计 ${displayDate(marks.predictedStart)} 开始，仅供参考`;
    }
    if (usePartner) {
      return days === 0 ? "今天可以多关心 TA" : `大约还有 ${days} 天，这几天可以多关心 TA`;
    }
    if (days === 0) return "今天前后，记得多照顾一下自己";
    if (days === 1) return "明天前后要多留意身体";
    return `大约还有 ${days} 天，可以提前留意身体`;
  },

  buildNext(session) {
    const today = todayString();
    const end = addDays(today, 30);
    const items = [];
    const user = session.user;
    const usePartner = user.gender === "male" && session.mutual && session.partner && session.partner.gender === "female";
    const owner = usePartner ? session.partner : user;
    if (owner.gender === "female" && session.periods.length) {
      const marks = buildMarks(session.periods, owner.cycleLength, owner.periodLength);
      if (marks.predictedStart >= today && marks.predictedStart <= end) {
        items.push({ date: marks.predictedStart, title: "预计经期开始" });
      }
    }
    const year = Number(today.slice(0, 4));
    (session.anniversaries || []).forEach((item) => {
      const thisYear = anniversaryOn(year, item.month, item.day);
      const next = item.yearly === false ? thisYear : thisYear >= today ? thisYear : anniversaryOn(year + 1, item.month, item.day);
      if (next >= today && next <= end) {
        const count = item.yearly !== false ? anniversaryIndex(item.year, item.month, item.day, today) : 0;
        items.push({ date: next, title: count ? `${item.title} · 第${count}个` : item.title });
      }
    });
    (session.birthdays || []).forEach((item) => {
      const info = birthdayPhrase(item, today);
      if (info.date && info.date >= today && info.date <= end) {
        items.push({ date: info.date, title: `${item.title}，${info.text}` });
      }
    });
    (session.schedules || []).forEach((item) => {
      if (item.date >= today && item.date <= end) items.push({ date: item.date, title: item.title });
    });
    items.sort((left, right) => (left.date < right.date ? -1 : 1));
    if (!items.length) return "最近还没有安排";
    const first = items[0];
    return `${displayDate(first.date)} · ${first.title}`;
  },

  openCalendar() {
    this.triggerEvent("jumpto", { index: 1 });
  },

  openAsk() {
    this.triggerEvent("ask");
  },

  holdTemp() {
    this.setData({ skyPreview: true }, () => this.scheduleSkyMeasure());
  },

  pickSky(event) {
    const key = event.currentTarget.dataset.key;
    let detail = { kind: key, windy: false, heavy: false };
    if (key === "heavy") detail = { kind: "rain", windy: false, heavy: true };
    if (key === "wind") detail = { kind: "cloud", windy: true, heavy: false };
    detail.night = !!this.data.skyNight;
    this.previewSpec = detail;
    this.setData({ skyPicked: key, skyOn: true }, () => this.syncCardSky());
    this.triggerEvent("preview", detail);
  },

  toggleNight() {
    const skyNight = !this.data.skyNight;
    const key = this.data.skyPicked;
    let detail = null;
    if (key) {
      detail = { kind: key, windy: false, heavy: false, night: skyNight };
      if (key === "heavy") detail = { kind: "rain", windy: false, heavy: true, night: skyNight };
      if (key === "wind") detail = { kind: "cloud", windy: true, heavy: false, night: skyNight };
    } else {
      const real = this.currentWeather || {};
      detail = {
        kind: real.kind || "sun",
        windy: !!real.windy,
        heavy: !!real.heavy,
        night: skyNight,
      };
    }
    this.previewSpec = detail;
    this.setData({ skyNight, skyPreview: true, skyOn: true }, () => this.syncCardSky());
    this.triggerEvent("preview", key ? detail : { nightOnly: true, night: skyNight });
  },

  restoreSky() {
    this.previewSpec = null;
    this.setData({ skyPreview: false, skyPicked: "", skyNight: false }, () => this.syncCardSky());
    this.triggerEvent("preview", { restore: true });
  },

  readCache() {
    const cached = wx.getStorageSync("weather-cache");
    if (cached && Date.now() - cached.at < 60 * 60 * 1000) {
      return cached;
    }
    return null;
  },

  applyWeather(cached) {
    cached.care = this.careLine(cached);
    this.currentWeather = cached;
    this.setData({
      weatherName: cached.text,
      weatherPlace: cached.place || "",
      weatherTemp: String(cached.temp),
      tempMin: cached.tempMin === 0 || cached.tempMin ? String(cached.tempMin) : "",
      tempMax: cached.tempMax === 0 || cached.tempMax ? String(cached.tempMax) : "",
      weatherKind: cached.kind || "",
      weatherText: "",
      feelsLike: cached.feelsLike === 0 || cached.feelsLike ? String(cached.feelsLike) : "",
      windText: cached.windText || "",
      humidityText: cached.humidity === 0 || cached.humidity ? String(cached.humidity) : "",
      hours: this.timeTonedHours(cached.hours, cached),
      hints: cached.hints || [],
      clothing: cached.clothing,
      weatherHint: "",
      care: this.careLine(cached),
      needLocate: false,
      needCity: false,
    });
    this.triggerEvent("weather", {
      kind: cached.kind || "",
      windy: !!cached.windy,
      heavy: !!cached.heavy || cached.kind === "storm",
      sunrise: cached.sunrise || "",
      sunset: cached.sunset || "",
      moonPhase: cached.moonPhase || "",
      moonrise: cached.moonrise || "",
      moonset: cached.moonset || "",
    });
    if (!this.previewSpec) this.syncCardSky();
  },

  careLine(cached) {
    const name = this.nickName ? `${this.nickName}，` : "";
    if (cached.kind === "storm") return `${name}有雷雨，先别往外跑`;
    if (cached.windy && cached.kind === "rain") return `${name}风雨有点大，伞带上，衣服穿严实`;
    if (cached.windy) return `${name}风有点大，围巾戴上`;
    if (cached.kind === "rain" || cached.heavy) return `${name}下雨记得带伞`;
    if (cached.kind === "snow") return `${name}下雪路滑，鞋穿稳一点`;
    if (cached.kind === "fog") return `${name}有雾，出门看清路`;
    if (Number(cached.temp) <= 8) return `${name}有点冷，把自己裹暖`;
    if (Number(cached.temp) >= 30) return `${name}有点热，记得多喝水`;
    return `${name}出门前看一眼衣服就好`;
  },

  /**
   * 每小时配一个“天色”，图标才能按时段换：夜里月亮、日出日落时半落的太阳。
   * 优先用云函数给的 item.hour；老数据没有钟点，就从“晚上七点”这样的标签倒推。
   */
  timeTonedHours(hours, weather) {
    const list = hours || [];
    const rise = this.sunClock(weather.sunrise);
    const set = this.sunClock(weather.sunset);
    const nowPhase = skyMoment(new Date(), weather.sunrise || "", weather.sunset || "").phase;
    return list.map((item) => {
      const hour = typeof item.hour === "number" ? item.hour : this.labelHour(item.label);
      let tone = "";
      if (hour === null) {
        tone = nowPhase === "night" ? "night" : "";
      } else if (rise !== null && set !== null && set > rise) {
        if (hour + 1 <= rise || hour >= set + 1) tone = "night";
        else if (hour < rise + 0.5) tone = "dawn";
        else if (hour + 1 > set - 0.5) tone = "dusk";
      } else if (hour < 5 || hour >= 19) {
        tone = "night";
      } else if (hour < 7) {
        tone = "dawn";
      } else if (hour >= 17) {
        tone = "dusk";
      }
      return { ...item, tone };
    });
  },

  /** “晚上七点” → 19，“现在” → 当前钟点，认不出来就是 null。 */
  labelHour(label) {
    const text = String(label || "");
    if (text === "现在") return new Date().getHours();
    if (text === "凌晨") return 0;
    if (text === "中午") return 12;
    const matched = text.match(/^(凌晨|上午|下午|晚上)([一两二三四五六七八九十]{1,2})点$/);
    if (!matched) return null;
    const index = ["一", "两", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"].indexOf(matched[2]);
    if (index < 0) return null;
    const hour = index + 1;
    if (matched[1] === "凌晨" || matched[1] === "上午") return hour;
    return hour === 12 ? 12 : hour + 12;
  },

  sunClock(text) {
    const minute = clockMinutes(text);
    return minute === null ? null : minute / 60;
  },

  saveWeather(info, source) {
    const cache = {
      at: Date.now(),
      text: info.text,
      temp: info.temp,
      tempMin: info.tempMin,
      tempMax: info.tempMax,
      kind: info.kind || "",
      place: info.place || (source === "gps" ? "当前位置" : source),
      clothing: info.clothing,
      feelsLike: info.feelsLike === 0 || info.feelsLike ? info.feelsLike : "",
      humidity: info.humidity === 0 || info.humidity ? info.humidity : "",
      windText: info.windText || "",
      hints: info.hints || [],
      hours: info.hours || [],
      windy: !!info.windy,
      heavy: !!info.heavy,
      sunrise: info.sunrise || "",
      sunset: info.sunset || "",
      moonPhase: info.moonPhase || "",
      moonrise: info.moonrise || "",
      moonset: info.moonset || "",
      source,
    };
    wx.setStorageSync("weather-cache", cache);
    this.applyWeather(cache);
    return cache;
  },

  /** 有定位就用定位。没有定位时，用本机保存的城市。 */
  async ensureWeather(force) {
    if (!force) {
      const cached = this.readCache();
      if (cached) {
        this.applyWeather(cached);
        return cached;
      }
    }
    const located = await this.tryLocate();
    if (located.ok) {
      this.setData({ needLocate: false, weatherHint: "" });
      return this.saveWeather(located.weather, "gps");
    }
    if (located.reason === "weather") {
      this.setData({
        needLocate: false,
        weatherHint: located.message || "天气服务暂时不可用",
      });
      if (this.currentWeather) {
        return this.currentWeather;
      }
    } else {
      this.setData({ needLocate: true, weatherHint: "" });
    }
    const city = wx.getStorageSync("weather-city") || "";
    if (city) {
      return this.fetchPlace(city);
    }
    this.setData({
      needCity: true,
      needLocate: located.reason !== "weather",
      weatherText: located.reason === "weather" ? (this.data.weatherText || "天气暂时没取到") : "选择城市后可以看天气",
      weatherHint: located.reason === "weather"
        ? (located.message || "天气服务暂时不可用")
        : "也可以到「我 → 权限」打开定位",
    });
    return this.currentWeather || null;
  },

  tryLocate() {
    return new Promise((resolve) => {
      const miss = (reason) => resolve({ ok: false, reason });
      if (this.locationBlocked) {
        miss("locate");
        return;
      }
      const run = () => {
        wx.getLocation({
          type: "gcj02",
          success: async (res) => {
            const result = await app.call("weather", { latitude: res.latitude, longitude: res.longitude });
            if (result.ok) {
              resolve({ ok: true, weather: result });
              return;
            }
            resolve({ ok: false, reason: "weather", message: result.message || "天气服务暂时不可用" });
          },
          fail: (error) => {
            const message = (error && error.errMsg) || "";
            if (error.errno === 112 || message.indexOf("privacy agreement") >= 0) {
              this.locationBlocked = true;
            }
            miss("locate");
          },
        });
      };
      wx.getSetting({
        success: (res) => {
          if (res.authSetting["scope.userLocation"] === false) {
            miss("locate");
            return;
          }
          if (!wx.requirePrivacyAuthorize) {
            run();
            return;
          }
          wx.requirePrivacyAuthorize({ success: run, fail: () => miss("locate") });
        },
        fail: run,
      });
    });
  },

  async fetchPlace(place) {
    const result = await app.call("weather", { place });
    if (!result.ok) {
      this.setData({ weatherHint: result.message || "天气服务暂时不可用", needLocate: false });
      return this.currentWeather || null;
    }
    this.setData({ cityName: place, needCity: false, weatherHint: "" });
    return this.saveWeather(result, place);
  },

  async refreshWeather() {
    if (this.data.refreshing) {
      return;
    }
    this.setData({ refreshing: true });
    const weather = await this.ensureWeather(true);
    await this.refreshReading(weather);
    this.setData({ refreshing: false });
  },

  onCity(event) {
    const place = (event.detail.value || []).join(" ");
    wx.setStorageSync("weather-city", place);
    this.fetchPlace(place).then((weather) => this.refreshReading(weather));
  },

  openPermissions() {
    wx.navigateTo({ url: "/pages/settings/index" });
  },

  openSoon(event) {
    const name = event.currentTarget.dataset.name;
    wx.navigateTo({ url: `/pages/soon/index?name=${encodeURIComponent(name)}` });
  },

  /** 天空铺满整张天气卡片，字浮在上面；容器滚动时整块一起走。 */
  syncCardSky() {
    const real = this.currentWeather || {};
    const preview = this.previewSpec;
    const kind = preview ? preview.kind : (real.kind || "");
    if (!kind) {
      this.stopCardSky();
      if (this.data.skyOn) this.setData({ skyOn: false });
      return;
    }
    const windy = preview ? !!preview.windy : !!real.windy;
    const heavy = preview ? !!preview.heavy : !!real.heavy || kind === "storm";
    const night = preview ? !!preview.night : false;
    const moment = skyMoment(new Date(), real.sunrise || "", real.sunset || "");
    const moon = moonMoment(new Date(), real.moonrise || "", real.moonset || "");
    const phase = night ? "night" : moment.phase;
    this.cardFocus = {
      kind,
      windy,
      heavy,
      phase,
      sunX: moment.sunX,
      sunY: Math.min(0.34, Math.max(0.08, moment.sunY)),
      moonX: moon.x,
      moonY: Math.min(0.34, Math.max(0.06, moon.y)),
      moonPhase: moonPhaseKey(real.moonPhase || "", new Date()),
    };
    const colors = skyColors(kind, phase);
    this.setData({
      skyOn: true,
      skyDark: phase === "night",
      skyPhase: phase,
      skyStyle: `--sky-a:${colors[0]};--sky-b:${colors[1]};--sky-c:${colors[2]};`,
    }, () => this.scheduleSkyMeasure());
  },

  /** 卡片里的文字一变，高度就变，画布要跟着重新量。 */
  scheduleSkyMeasure() {
    this.initCardSky();
    setTimeout(() => this.initCardSky(), 160);
  },

  /** 面板滑走、页面切后台时只暂停帧循环，画布留着，回来接着画。 */
  syncSkyPause() {
    if (this.skyIdle()) this.pauseCardSky();
    else this.resumeCardSky();
  },

  skyIdle() {
    return !this.data.active || !!this.pageHidden || this.data.skyBroken;
  },

  resumeCardSky() {
    if (this.data.skyBroken) return;
    if (!this.sky) {
      this.syncCardSky();
      return;
    }
    this.startCardSky();
  },

  startCardSky() {
    const sky = this.sky;
    if (!sky || sky.timer || this.skyIdle()) return;
    sky.last = Date.now();
    sky.timer = setTimeout(() => this.tickCardSky(), 33);
  },

  pauseCardSky() {
    if (!this.sky) return;
    if (this.sky.timer) clearTimeout(this.sky.timer);
    this.sky.timer = null;
  },

  initCardSky(retry) {
    const focus = this.cardFocus;
    if (!focus || this.data.skyBroken) return;
    const token = (this.skyToken || 0) + 1;
    this.skyToken = token;
    const query = this.createSelectorQuery();
    query.select("#card-sky").fields({ node: true, size: true });
    query.select(".weather-card").boundingClientRect();
    query.exec((res) => {
      if (this.skyToken !== token || !this.cardFocus) return;
      const found = res && res[0];
      const rect = res && res[1];
      const tries = retry || 0;
      if (!found || !found.node || !found.width || !found.height) {
        if (tries < 8) setTimeout(() => this.initCardSky(tries + 1), 60);
        return;
      }
      if (rect && rect.width) {
        this.skyRect = {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          scroll: this.scrollTop || 0,
        };
      }
      const signature = `${focus.kind}|${focus.windy ? 1 : 0}|${focus.heavy ? 1 : 0}|${Math.round(found.width)}x${Math.round(found.height)}`;
      if (this.sky && this.sky.canvas === found.node && this.sky.sig === signature) {
        this.startCardSky();
        return;
      }
      try {
        const info = wx.getWindowInfo ? wx.getWindowInfo() : { pixelRatio: 2 };
        const dpr = Math.min(info.pixelRatio || 2, 2);
        const canvas = found.node;
        canvas.width = found.width * dpr;
        canvas.height = found.height * dpr;
        const ctx = canvas.getContext("2d");
        if (ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        else ctx.scale(dpr, dpr);
        this.pauseCardSky();
        const cast = createCast({
          kind: focus.kind,
          windy: focus.windy,
          heavy: focus.heavy,
          width: found.width,
          height: found.height,
        });
        cast.sprite = makeFlakeSprite();
        this.sky = {
          canvas,
          ctx,
          sig: signature,
          warned: false,
          last: Date.now(),
          timer: null,
          cast,
          edges: frameEdges(found.width, found.height, focus.kind),
          width: found.width,
          height: found.height,
        };
        this.startCardSky();
      } catch (error) {
        console.warn("天气卡片没有准备好", error);
      }
    });
  },

  stopCardSky() {
    this.skyToken = (this.skyToken || 0) + 1;
    this.pauseCardSky();
    this.sky = null;
    this.cardFocus = null;
    this.skyRect = null;
  },

  /** 同层渲染失败时，画布会盖住文字。宁可不画，退回底色天空。 */
  onSkyRenderError() {
    if (this.data.skyBroken) return;
    this.stopCardSky();
    this.setData({ skyBroken: true });
    console.warn("天气卡片的画布没能叠在文字下面，改用底色天空");
  },

  tickCardSky() {
    const sky = this.sky;
    const focus = this.cardFocus;
    if (!sky || !focus) return;
    if (this.skyIdle()) {
      sky.timer = null;
      return;
    }
    const now = Date.now();
    const dt = Math.min(0.05, Math.max(0, (now - sky.last) / 1000));
    sky.last = now;
    try {
      stepCast(sky.cast, dt, sky.edges);
      paintCast(
        sky.ctx,
        sky.cast,
        focus.phase,
        { x: focus.sunX, y: focus.sunY },
        sky.edges,
        { x: focus.moonX, y: focus.moonY, phase: focus.moonPhase }
      );
    } catch (error) {
      if (!sky.warned) {
        sky.warned = true;
        console.warn("天气卡片绘制中断", error);
      }
    }
    if (this.sky !== sky) return;
    sky.timer = setTimeout(() => this.tickCardSky(), 33);
  },

  /** 上下快滚也算晃了一下卡片，风跟着变大。 */
  onPageScroll(event) {
    const top = (event.detail && event.detail.scrollTop) || 0;
    const delta = top - (this.scrollTop || 0);
    this.scrollTop = top;
    if (!this.sky || Math.abs(delta) < 14 || this.skyIdle()) return;
    const now = Date.now();
    if (now - (this.scrollWindAt || 0) < 90) return;
    this.scrollWindAt = now;
    nudgeCast(this.sky.cast, 0, 0, Math.max(-90, Math.min(90, delta)));
  },

  onSkyTouchStart(event) {
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    this.skyTouch = { x: touch.clientX, y: touch.clientY, moved: 0 };
  },

  onSkyTouchMove(event) {
    const touch = event.touches && event.touches[0];
    const start = this.skyTouch;
    if (!touch || !start) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    start.x = touch.clientX;
    start.y = touch.clientY;
    start.moved += Math.abs(dx) + Math.abs(dy);
    if (!this.sky || this.skyIdle()) return;
    if (Math.abs(dx) > 2) nudgeCast(this.sky.cast, 0, 0, dx);
    this.brushSky(touch.clientX, touch.clientY);
  },

  onSkyTouchEnd(event) {
    const start = this.skyTouch;
    this.skyTouch = null;
    if (!start || !this.sky || this.skyIdle()) return;
    const focus = this.cardFocus;
    if (!focus) return;
    const touch = event.changedTouches && event.changedTouches[0];
    const x = touch ? touch.clientX : start.x;
    const y = touch ? touch.clientY : start.y;
    if (start.moved >= 10) {
      this.brushSky(x, y);
      return;
    }
    const local = this.skyLocal(x, y);
    if (!local) return;
    if (focus.kind === "fog") pokeFog(this.sky.cast, local.x, local.y);
    if (focus.kind === "snow") brushSnow(this.sky.cast, local.x, this.sky.height - 4);
  },

  /** 手指抹过下边框时，把那一小段雪擦掉。 */
  brushSky(clientX, clientY) {
    const sky = this.sky;
    const focus = this.cardFocus;
    if (!sky || !focus || focus.kind !== "snow") return;
    const local = this.skyLocal(clientX, clientY);
    if (!local || local.y < sky.height - 100) return;
    brushSnow(sky.cast, local.x, sky.height - 4);
  },

  /** 屏幕坐标换到画布坐标。滚动距离从 bindscroll 里补上。 */
  skyLocal(clientX, clientY) {
    const rect = this.skyRect;
    if (!rect) return null;
    const top = rect.top - ((this.scrollTop || 0) - (rect.scroll || 0));
    return { x: clientX - rect.left, y: clientY - top };
  },
  },
});
