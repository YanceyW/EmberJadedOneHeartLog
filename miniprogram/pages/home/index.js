const app = getApp();
const { buildMarks } = require("../../utils/cycle");
const { diffDays, displayDate, todayString } = require("../../utils/date");

const SOON = ["时间日志", "相册", "足迹", "心愿单", "时光胶囊", "共同菜单", "年度回顾", "实时位置"];

Page({
  data: {
    hello: "你好",
    weatherText: "正在获取当地天气",
    weatherName: "",
    weatherTemp: "",
    clothing: "",
    weatherHint: "",
    needLocate: false,
    reminder: "",
    soon: SOON,
  },

  onShow() {
    this.setGreeting();
    this.load();
    if (!this.showCachedWeather()) {
      this.requestLocationOnEnter();
    }
  },

  setGreeting() {
    const hour = new Date().getHours();
    let hello = "晚上好";
    if (hour < 11) hello = "早上好";
    else if (hour < 14) hello = "中午好";
    else if (hour < 18) hello = "下午好";
    this.setData({ hello });
  },

  async load() {
    const result = await app.loadSession(true);
    if (!result.ok) {
      this.setData({ reminder: result.message });
      return;
    }
    this.setData({ reminder: this.buildReminder(result) });
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

  showCachedWeather() {
    const cached = wx.getStorageSync("weather-cache");
    if (cached && Date.now() - cached.at < 2 * 60 * 60 * 1000) {
      this.setData({
        weatherName: cached.text,
        weatherTemp: String(cached.temp),
        weatherText: "",
        clothing: cached.clothing,
        weatherHint: "",
        needLocate: false,
      });
      return true;
    }
    return false;
  },

  /** 进入首页就申请。隐私指引里已经声明位置后，微信会主动弹出。 */
  requestLocationOnEnter() {
    if (this.locating) {
      return;
    }
    this.locating = true;
    wx.getSetting({
      success: (res) => {
        if (res.authSetting["scope.userLocation"] === false) {
          this.locating = false;
          this.setData({
            weatherText: "位置权限之前被拒绝了",
            weatherHint: "请到「我的 → 设置 → 权限」里打开位置",
            needLocate: true,
          });
          return;
        }
        this.ensurePrivacyThenLocate();
      },
      fail: () => this.ensurePrivacyThenLocate(),
    });
  },

  ensurePrivacyThenLocate() {
    if (!wx.requirePrivacyAuthorize) {
      this.locate();
      return;
    }
    wx.requirePrivacyAuthorize({
      success: () => this.locate(),
      fail: () => {
        this.locating = false;
        this.setData({
          weatherText: "需要先同意隐私保护指引",
          weatherHint: "点下面的按钮后，微信才会继续询问位置",
          needLocate: true,
        });
      },
    });
  },

  locate() {
    wx.getLocation({
      type: "gcj02",
      success: async (res) => {
        const result = await app.call("weather", {
          latitude: res.latitude,
          longitude: res.longitude,
        });
        if (!result.ok) {
          this.locating = false;
          this.setData({
            weatherText: result.message,
            weatherName: "",
            weatherTemp: "",
            clothing: "",
            weatherHint: "",
            needLocate: true,
          });
          return;
        }
        const cache = { at: Date.now(), text: result.text, temp: result.temp, clothing: result.clothing };
        wx.setStorageSync("weather-cache", cache);
        this.setData({
          weatherName: result.text,
          weatherTemp: String(result.temp),
          weatherText: "",
          clothing: result.clothing,
          weatherHint: "",
          needLocate: false,
        });
        this.locating = false;
      },
      fail: (error) => {
        this.locating = false;
        console.error("获取位置失败", error);
        const message = (error && error.errMsg) || "";
        let weatherText = "还没有拿到位置";
        let weatherHint = "请到「我的 → 设置 → 权限」里打开位置";
        if (message.indexOf("privacy") >= 0 || error.errno === 112 || error.errno === 104) {
          weatherText = "微信还不允许弹出位置授权";
          weatherHint = "请到公众平台填写用户隐私保护指引，并勾选位置信息";
        } else if (message.indexOf("auth deny") >= 0 || message.indexOf("auth denied") >= 0) {
          weatherText = "位置权限被拒绝了";
          weatherHint = "请到「我的 → 设置 → 权限」里打开位置";
        }
        this.setData({ weatherText, weatherName: "", weatherTemp: "", weatherHint, clothing: "", needLocate: true });
      },
    });
  },

  openPermissions() {
    wx.navigateTo({ url: "/pages/settings/index" });
  },

  openSoon(event) {
    const name = event.currentTarget.dataset.name;
    wx.navigateTo({ url: `/pages/soon/index?name=${encodeURIComponent(name)}` });
  },
});
