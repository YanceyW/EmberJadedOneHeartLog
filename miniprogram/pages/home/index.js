const app = getApp();
const { buildMarks } = require("../../utils/cycle");
const { addDays, anniversaryOn, anniversaryIndex, diffDays, displayDate, solarTermName, SOLAR_FESTIVALS, todayString } = require("../../utils/date");
const { solarToLunar } = require("../../utils/lunar");
const { birthdayPhrase } = require("../../utils/birthday");
const { getTabClearance, watchTabClearance } = require("../../utils/layout");
const { TEMPLATE_ID, requestOnce } = require("../../utils/subscribe");
const { skyMoment, moonMoment, moonPhaseKey, createCast, stepCast, paintCast, nudgeCast, brushSnow, pokeFog, makeFlakeSprite } = require("../../utils/sky");

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
      if (value) this.syncCardSky();
      else {
        this.stopCardSky();
        if (this.data.skyOn) this.setData({ skyOn: false });
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
    hide() {
      this.stopCardSky();
      if (this.data.skyOn) this.setData({ skyOn: false });
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
    this.setData({ skyPreview: true });
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
      hours: cached.hours || [],
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

  /** 天气画在卡片顶部的画布里，文字在画布下面，滚动时跟着卡片走。 */
  syncCardSky() {
    if (!this.data.active) {
      this.stopCardSky();
      if (this.data.skyOn) this.setData({ skyOn: false });
      return;
    }
    const real = this.currentWeather || {};
    const preview = this.previewSpec;
    const kind = preview ? preview.kind : (real.kind || "");
    const windy = preview ? !!preview.windy : !!real.windy;
    const heavy = preview ? !!preview.heavy : !!real.heavy || kind === "storm";
    const night = preview ? !!preview.night : false;
    if (!kind) {
      this.stopCardSky();
      if (this.data.skyOn) this.setData({ skyOn: false });
      return;
    }
    const moment = skyMoment(new Date(), real.sunrise || "", real.sunset || "");
    const moon = moonMoment(new Date(), real.moonrise || "", real.moonset || "");
    this.cardFocus = {
      kind,
      windy,
      heavy,
      phase: night ? "night" : moment.phase,
      sunX: moment.sunX,
      sunY: Math.min(0.42, moment.sunY + 0.08),
      moonX: moon.x,
      moonY: Math.min(0.46, moon.y + 0.08),
      moonPhase: moonPhaseKey(real.moonPhase || "", new Date()),
    };
    const start = () => this.initCardSky();
    if (this.data.skyOn) start();
    else this.setData({ skyOn: true }, start);
  },

  initCardSky(retry) {
    const focus = this.cardFocus;
    if (!focus || !this.data.active) return;
    const token = (this.skyToken || 0) + 1;
    this.skyToken = token;
    const query = this.createSelectorQuery();
    query.select("#card-sky").fields({ node: true, size: true }).exec((res) => {
      if (this.skyToken !== token || !this.data.active || !this.cardFocus) return;
      const found = res && res[0];
      const tries = retry || 0;
      if (!found || !found.node || !found.width || !found.height) {
        if (tries < 8) setTimeout(() => this.initCardSky(tries + 1), 60);
        return;
      }
      const signature = `${focus.kind}|${focus.windy ? 1 : 0}|${focus.heavy ? 1 : 0}`;
      if (this.sky && this.sky.canvas === found.node && this.sky.sig === signature) return;
      try {
        const info = wx.getWindowInfo ? wx.getWindowInfo() : { pixelRatio: 2 };
        const dpr = Math.min(info.pixelRatio || 2, 2);
        const canvas = found.node;
        canvas.width = found.width * dpr;
        canvas.height = found.height * dpr;
        const ctx = canvas.getContext("2d");
        if (ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        else ctx.scale(dpr, dpr);
        if (this.sky && this.sky.timer) clearTimeout(this.sky.timer);
        const cast = createCast({
          kind: focus.kind,
          windy: focus.windy,
          heavy: focus.heavy,
          width: found.width,
          height: found.height,
        });
        cast.drops = cast.drops.slice(0, 48);
        cast.flakes = cast.flakes.slice(0, 36);
        cast.gusts = cast.gusts.slice(0, 7);
        cast.leaves = cast.leaves.slice(0, 5);
        cast.motes = cast.motes.slice(0, 16);
        cast.stars = cast.stars.slice(0, 16);
        cast.sprite = makeFlakeSprite();
        this.sky = {
          canvas,
          ctx,
          sig: signature,
          warned: false,
          last: Date.now(),
          timer: null,
          cast,
          width: found.width,
          height: found.height,
        };
        this.tickCardSky();
      } catch (error) {
        console.warn("天气卡片没有准备好", error);
      }
    });
  },

  stopCardSky() {
    this.skyToken = (this.skyToken || 0) + 1;
    if (this.sky && this.sky.timer) clearTimeout(this.sky.timer);
    this.sky = null;
  },

  cardGround() {
    const sky = this.sky;
    if (!sky) return [];
    return [{
      left: 4,
      top: sky.height - 1,
      width: Math.max(12, sky.width - 8),
      height: 16,
      shelf: true,
      radius: 0,
    }];
  },

  tickCardSky() {
    const sky = this.sky;
    const focus = this.cardFocus;
    if (!sky || !focus || !this.data.active) return;
    const now = Date.now();
    const dt = Math.min(0.05, Math.max(0, (now - sky.last) / 1000));
    sky.last = now;
    const ground = this.cardGround();
    try {
      stepCast(sky.cast, dt, ground);
      paintCast(sky.ctx, sky.cast, focus.phase, {
        x: focus.sunX,
        y: focus.sunY,
      }, ground, {
        x: focus.moonX,
        y: focus.moonY,
        phase: focus.moonPhase,
      });
    } catch (error) {
      if (!sky.warned) {
        sky.warned = true;
        console.warn("天气卡片绘制中断", error);
      }
    }
    if (this.sky !== sky) return;
    sky.timer = setTimeout(() => this.tickCardSky(), 33);
  },

  onStageStart(event) {
    const touch = event.touches && event.touches[0];
    if (!touch || !this.sky) return;
    this.stageTouch = { x: touch.x, y: touch.y };
    this.touchSky(touch.x, touch.y, 0);
  },

  onStageMove(event) {
    const touch = event.touches && event.touches[0];
    if (!touch || !this.stageTouch || !this.sky) return;
    const dx = touch.x - this.stageTouch.x;
    this.stageTouch = { x: touch.x, y: touch.y };
    this.touchSky(touch.x, touch.y, dx);
  },

  onStageEnd() {
    this.stageTouch = null;
  },

  touchSky(x, y, dx) {
    const sky = this.sky;
    const focus = this.cardFocus;
    if (!sky || !focus) return;
    if (focus.kind === "fog") pokeFog(sky.cast, x, y);
    if (focus.kind === "snow") brushSnow(sky.cast, x, y);
    if (dx) nudgeCast(sky.cast, x, y, dx);
  },
  },
});
