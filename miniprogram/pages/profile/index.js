const app = getApp();
const lunar = require("../../utils/lunar");

const SHI = [
  { name: "子时", hours: [23, 0] },
  { name: "丑时", hours: [1, 2] },
  { name: "寅时", hours: [3, 4] },
  { name: "卯时", hours: [5, 6] },
  { name: "辰时", hours: [7, 8] },
  { name: "巳时", hours: [9, 10] },
  { name: "午时", hours: [11, 12] },
  { name: "未时", hours: [13, 14] },
  { name: "申时", hours: [15, 16] },
  { name: "酉时", hours: [17, 18] },
  { name: "戌时", hours: [19, 20] },
  { name: "亥时", hours: [21, 22] },
];

function pad(number) {
  return String(number).padStart(2, "0");
}

function shiIndexFromHour(hour) {
  if (hour === 23 || hour === 0) {
    return 0;
  }
  return Math.floor((hour + 1) / 2);
}

function shiLabel(item) {
  if (item.name === "子时") {
    return "子时 23:00-01:00";
  }
  const end = item.hours[1] + 1;
  return `${item.name} ${pad(item.hours[0])}:00-${pad(end)}:00`;
}

function timeOptions() {
  return SHI.map(shiLabel);
}

function timeIndexFromText(text) {
  const value = String(text || "");
  const byName = SHI.findIndex((item) => value.indexOf(item.name) === 0);
  if (byName >= 0) {
    return byName;
  }
  const clock = /^(\d{2}):(\d{2})$/.exec(value);
  if (clock) {
    return shiIndexFromHour(Number(clock[1]));
  }
  return -1;
}

Page({
  data: {
    nickName: "",
    gender: "",
    cycleLength: 28,
    periodLength: 5,
    partnerCycleLength: 28,
    partnerPeriodLength: 5,
    showOwnCycle: false,
    showPartnerCycle: false,
    birthCalendar: "solar",
    birthDate: "",
    birthText: "",
    birthHour: "",
    birthPlace: "",
    region: ["北京市", "北京市", "东城区"],
    birthRange: lunar.buildBirth([0, 80, 0, 0]).range,
    birthIndex: lunar.buildBirth([0, 80, 0, 0]).index,
    timeRange: timeOptions(),
    timeIndex: 0,
    partnerText: "选择对象",
    hasPartner: false,
    partnerTitle: "",
    roleOptions: ["男友", "未婚夫", "丈夫", "女友", "未婚妻", "妻子"],
    periodRemind: false,
    mutual: false,
  },

  onShow() {
    this.load();
  },

  async load() {
    const result = await app.loadSession(true);
    if (!result.ok) {
      wx.showToast({ title: result.message, icon: "none" });
      return;
    }
    const user = result.user;
    const partner = result.partner;
    let partnerText = "选择对象";
    if (partner && result.mutual) {
      partnerText = `已和 ${partner.nickName || "未命名"} 互为对象`;
    } else if (partner) {
      partnerText = `已选择 ${partner.nickName || "未命名"}，等待对方确认`;
    }
    let roleOptions = ["男友", "未婚夫", "丈夫", "女友", "未婚妻", "妻子"];
    if (partner && partner.gender === "male") {
      roleOptions = roleOptions.slice(0, 3);
    } else if (partner && partner.gender === "female") {
      roleOptions = roleOptions.slice(3);
    }
    this.setData({
      nickName: user.nickName,
      gender: user.gender,
      cycleLength: user.cycleLength,
      periodLength: user.periodLength,
      showOwnCycle: user.gender === "female",
      showPartnerCycle: user.gender === "male" && result.mutual && partner && partner.gender === "female",
      partnerCycleLength: partner ? partner.cycleLength : 28,
      partnerPeriodLength: partner ? partner.periodLength : 5,
      partnerText,
      hasPartner: !!partner,
      partnerTitle: roleOptions.indexOf(user.partnerTitle) >= 0 ? user.partnerTitle : "",
      roleOptions,
      periodRemind: user.periodRemind === true && !(user.gender === "male" && !result.mutual),
      mutual: !!result.mutual,
      ...this.birthFields(user),
    });
  },

  birthFields(user) {
    const birthCalendar = user.birthCalendar === "lunar" ? "lunar" : "solar";
    const birthDate = user.birthDate || "";
    const birthIndex = lunar.indexFromBirth(birthCalendar, birthDate) || lunar.buildBirth([0, 80, 0, 0]).index;
    const birthBuilt = lunar.buildBirth(birthIndex);
    const timeIndex = timeIndexFromText(user.birthHour || "");
    const placeParts = String(user.birthPlace || "").split(" ");
    return {
      birthCalendar,
      birthDate,
      birthText: lunar.birthText(birthCalendar, birthDate),
      birthHour: timeIndex >= 0 ? shiLabel(SHI[timeIndex]) : "",
      birthPlace: user.birthPlace || "",
      region: placeParts.length === 3 ? placeParts : ["北京市", "北京市", "东城区"],
      birthRange: birthBuilt.range,
      birthIndex: birthBuilt.index,
      timeRange: timeOptions(),
      timeIndex: timeIndex >= 0 ? timeIndex : 0,
    };
  },

  onNick(event) {
    this.setData({ nickName: event.detail.value });
  },

  onGender(event) {
    const gender = event.currentTarget.dataset.gender;
    this.setData({ gender, showOwnCycle: gender === "female" });
  },

  onCycle(event) {
    this.setData({ cycleLength: event.detail.value });
  },

  onPeriod(event) {
    this.setData({ periodLength: event.detail.value });
  },

  onPartnerCycle(event) {
    this.setData({ partnerCycleLength: event.detail.value });
  },

  onPartnerPeriod(event) {
    this.setData({ partnerPeriodLength: event.detail.value });
  },

  onBirthColumn(event) {
    const birthIndex = this.data.birthIndex.slice();
    birthIndex[event.detail.column] = event.detail.value;
    if (event.detail.column < 3) {
      birthIndex[3] = 0;
    }
    if (event.detail.column < 2) {
      birthIndex[2] = 0;
    }
    const built = lunar.buildBirth(birthIndex);
    this.setData({ birthRange: built.range, birthIndex: built.index });
  },

  onBirthPick(event) {
    const picked = lunar.birthFrom(event.detail.value);
    this.setData({
      birthCalendar: picked.calendar,
      birthDate: picked.date,
      birthText: lunar.birthText(picked.calendar, picked.date),
      birthIndex: picked.index,
    });
  },

  onTimePick(event) {
    const timeIndex = Number(event.detail.value);
    this.setData({ timeIndex, birthHour: shiLabel(SHI[timeIndex]) });
  },

  openPartner() {
    wx.navigateTo({ url: "/pages/partner/index" });
  },

  onRole(event) {
    this.setData({ partnerTitle: event.currentTarget.dataset.title });
  },

  onPeriodRemind() {
    if (!this.data.periodRemind && this.data.gender === "male" && !this.data.mutual) {
      wx.showToast({ title: "你还没有对象", icon: "none" });
      return;
    }
    this.setData({ periodRemind: !this.data.periodRemind });
  },

  onRegion(event) {
    const region = event.detail.value || [];
    this.setData({ region, birthPlace: region.join(" ") });
  },

  async saveProfile() {
    const result = await app.call("saveProfile", {
      nickName: this.data.nickName,
      gender: this.data.gender,
      cycleLength: this.data.cycleLength,
      periodLength: this.data.periodLength,
      birthCalendar: this.data.birthCalendar,
      birthDate: this.data.birthDate,
      birthHour: this.data.birthHour,
      birthPlace: this.data.birthPlace,
      periodRemind: this.data.periodRemind,
      partnerTitle: this.data.partnerTitle,
    });
    if (!result.ok) {
      wx.showToast({ title: result.message, icon: "none" });
      return;
    }
    app.globalData.session = result;
    if (this.data.showPartnerCycle) {
      const partnerResult = await app.call("savePartnerCycle", {
        cycleLength: this.data.partnerCycleLength,
        periodLength: this.data.partnerPeriodLength,
      });
      if (!partnerResult.ok) {
        wx.showToast({ title: partnerResult.message, icon: "none" });
        return;
      }
      app.globalData.session = partnerResult;
    }
    wx.showToast({ title: "已保存" });
    this.load();
  },
});
