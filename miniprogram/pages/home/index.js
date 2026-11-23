const app = getApp();
const { buildMarks } = require("../../utils/cycle");
const { addDays, anniversaryOn, anniversaryIndex, diffDays, displayDate, solarTermName, SOLAR_FESTIVALS, todayString } = require("../../utils/date");
const { solarToLunar } = require("../../utils/lunar");
const { birthdayPhrase } = require("../../utils/birthday");
const { getTabClearance, watchTabClearance } = require("../../utils/layout");

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
    const weather = await this.ensureWeather(false);
    if (!result.user.birthDate) {
      return;
    }
    await this.refreshReading(weather);
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
    const reading = await app.call("dailyReading", {
      weather: weather ? `${weather.temp}° ${weather.text}，${weather.clothing}。${weather.care || ""}` : "",
      weatherSource: weather ? weather.source : "",
    });
    if (reading.ok && reading.lines && reading.lines.length) {
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

  readCache() {
    const cached = wx.getStorageSync("weather-cache");
    if (cached && Date.now() - cached.at < 2 * 60 * 60 * 1000) {
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
    });
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
      windy: !!info.windy,
      heavy: !!info.heavy,
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
      if (cached && cached.source === "gps") {
        this.applyWeather(cached);
        return cached;
      }
    }
    const gps = await this.tryLocate();
    if (gps) {
      return this.saveWeather(gps, "gps");
    }
    if (!force) {
      const cached = this.readCache();
      if (cached) {
        this.applyWeather(cached);
        return cached;
      }
    }
    const city = wx.getStorageSync("weather-city") || "";
    if (city) {
      return this.fetchPlace(city);
    }
    if (force && this.currentWeather) {
      this.setData({ weatherHint: "网络有问题，请再试一次" });
      return this.currentWeather;
    }
    this.setData({
      needCity: true,
      needLocate: true,
      weatherText: "选择城市后可以看天气",
      weatherHint: "也可以到「我 → 权限」打开定位",
      weatherName: "",
      weatherTemp: "",
      clothing: "",
    });
    return null;
  },

  tryLocate() {
    return new Promise((resolve) => {
      if (this.locationBlocked) {
        resolve(null);
        return;
      }
      const run = () => {
        wx.getLocation({
          type: "gcj02",
          success: async (res) => {
            const result = await app.call("weather", { latitude: res.latitude, longitude: res.longitude });
            resolve(result.ok ? result : null);
          },
          fail: (error) => {
            const message = (error && error.errMsg) || "";
            if (error.errno === 112 || message.indexOf("privacy agreement") >= 0) {
              this.locationBlocked = true;
            }
            resolve(null);
          },
        });
      };
      wx.getSetting({
        success: (res) => {
          if (res.authSetting["scope.userLocation"] === false) {
            resolve(null);
            return;
          }
          if (!wx.requirePrivacyAuthorize) {
            run();
            return;
          }
          wx.requirePrivacyAuthorize({ success: run, fail: () => resolve(null) });
        },
        fail: run,
      });
    });
  },

  async fetchPlace(place) {
    const result = await app.call("weather", { place });
    if (!result.ok) {
      this.setData({ weatherHint: "网络有问题，请再试一次" });
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
  },
});
