// 炎都拾光唯一的云函数。小程序不直接读写数据库。
const cloud = require("wx-server-sdk");
const https = require("https");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLLECTIONS = ["users", "periods", "anniversaries", "birthdays", "schedules", "readings", "asks", "almanacs"];
const MALE_ROLES = ["男友", "未婚夫", "丈夫"];
const FEMALE_ROLES = ["女友", "未婚妻", "妻子"];
const PARTNER_ROLES = MALE_ROLES.concat(FEMALE_ROLES);
const PROMPT_VERSION = 2;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, message: "没有拿到微信身份" };
  }
  try {
    await ensureCollections();
    switch (event.action) {
      case "session":
        return await session(OPENID);
      case "saveProfile":
        return await saveProfile(OPENID, event);
      case "savePartnerCycle":
        return await savePartnerCycle(OPENID, event);
      case "listPeople":
        return await listPeople(OPENID);
      case "choosePartner":
        return await choosePartner(OPENID, event.targetOpenid);
      case "clearPartner":
        return await clearPartner(OPENID);
      case "savePeriod":
        return await savePeriod(OPENID, event);
      case "deletePeriod":
        return await deletePeriod(OPENID, event.id);
      case "saveAnniversary":
        return await saveAnniversary(OPENID, event);
      case "deleteAnniversary":
        return await deleteAnniversary(OPENID, event.id);
      case "saveSchedule":
        return await saveSchedule(OPENID, event);
      case "deleteSchedule":
        return await deleteSchedule(OPENID, event.id);
      case "saveBirthday":
        return await saveBirthday(OPENID, event);
      case "deleteBirthday":
        return await deleteBirthday(OPENID, event.id);
      case "weather":
        return await weather(event);
      case "dailyReading":
        return await dailyReading(OPENID, event);
      case "almanac":
        return await almanac(event.date);
      case "listAsks":
        return await listAsks(OPENID);
      case "ask":
        return await ask(OPENID, event.question);
      default:
        return { ok: false, message: "未知操作" };
    }
  } catch (error) {
    console.error(event.action, error);
    return { ok: false, message: error.message || "服务异常" };
  }
};

async function ensureCollections() {
  await Promise.all(
    COLLECTIONS.map(async (name) => {
      try {
        await db.createCollection(name);
      } catch (error) {
        // 集合已存在时会失败，可以继续。
      }
    })
  );
}

async function findUser(openid) {
  const res = await db.collection("users").where({ openid }).limit(1).get();
  return res.data[0] || null;
}

async function ensureUser(openid) {
  const existing = await findUser(openid);
  if (existing) {
    return existing;
  }
  const now = Date.now();
  const created = await db.collection("users").add({
    data: {
      openid,
      nickName: "",
      gender: "",
      cycleLength: 28,
      periodLength: 5,
      chosenOpenid: "",
      createdAt: now,
      updatedAt: now,
    },
  });
  return findUser(openid) || { _id: created._id, openid };
}

function publicUser(user) {
  if (!user) {
    return null;
  }
  return {
    openid: user.openid,
    nickName: user.nickName || "",
    gender: user.gender || "",
    cycleLength: user.cycleLength || 28,
    periodLength: user.periodLength || 5,
    chosenOpenid: user.chosenOpenid || "",
    partnerTitle: user.partnerTitle || "",
    periodRemind: user.periodRemind === true,
    birthCalendar: user.birthCalendar || "",
    birthDate: user.birthDate || "",
    birthHour: user.birthHour || "",
    birthPlace: user.birthPlace || "",
  };
}

function isMutual(user, partner) {
  return !!(user && partner && user.chosenOpenid === partner.openid && partner.chosenOpenid === user.openid);
}

/** 经期记在女性名下。男方只有在互为对象后才能看和改她的记录。 */
function periodAccess(user, partner) {
  const mutual = isMutual(user, partner);
  if (user.gender === "female") {
    return { ownerOpenid: user.openid, canEdit: true, visible: true };
  }
  if (mutual && partner && partner.gender === "female") {
    return { ownerOpenid: partner.openid, canEdit: true, visible: true };
  }
  return { ownerOpenid: "", canEdit: false, visible: false };
}

async function session(openid) {
  const user = await ensureUser(openid);
  const partner = user.chosenOpenid ? await findUser(user.chosenOpenid) : null;
  const mutual = isMutual(user, partner);
  const access = periodAccess(user, partner);
  const periods = access.visible ? await listByOwner("periods", access.ownerOpenid) : [];
  return {
    ok: true,
    user: publicUser(user),
    partner: partner
      ? Object.assign(publicUser(partner), { birthCalendar: "", birthDate: "", birthHour: "", birthPlace: "" })
      : null,
    mutual,
    canEditPeriod: access.canEdit,
    periodOwnerOpenid: access.ownerOpenid,
    periods,
    anniversaries: await visibleItems("anniversaries", openid, partner, mutual),
    birthdays: await visibleItems("birthdays", openid, partner, mutual),
    schedules: await visibleItems("schedules", openid, partner, mutual),
  };
}

async function listByOwner(collection, ownerOpenid) {
  if (!ownerOpenid) {
    return [];
  }
  const res = await db.collection(collection).where({ ownerOpenid }).limit(100).get();
  return res.data;
}

async function visibleItems(collection, openid, partner, mutual) {
  const mine = await db.collection(collection).where({ creatorOpenid: openid }).limit(100).get();
  let shared = [];
  if (mutual && partner) {
    const partnerItems = await db
      .collection(collection)
      .where({ creatorOpenid: partner.openid, visibility: "both" })
      .limit(100)
      .get();
    shared = partnerItems.data;
  }
  return mine.data.concat(shared);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}

function cleanBirthDate(calendar, value) {
  const text = String(value || "");
  if (calendar === "lunar") {
    return /^\d{4}-L?(0[1-9]|1[0-2])-(0[1-9]|[12]\d|30)$/.test(text) ? text : "";
  }
  return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(text) ? text : "";
}

function cleanBirthHour(value) {
  const text = String(value || "").trim();
  if (/^(子|丑|寅|卯|辰|巳|午|未|申|酉|戌|亥)时 \d{2}:\d{2}-\d{2}:\d{2}$/.test(text)) {
    return text;
  }
  if (/^(子|丑|寅|卯|辰|巳|午|未|申|酉|戌|亥)时 ([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
    return text;
  }
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
    return text;
  }
  if (/^(子|丑|寅|卯|辰|巳|午|未|申|酉|戌|亥)时$/.test(text)) {
    return text;
  }
  return "";
}

function formatLunarText(code) {
  const months = ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"];
  const days = ["初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十", "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十", "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"];
  const matched = /^(\d{4})-(L)?(\d{2})-(\d{2})$/.exec(code || "");
  if (!matched) {
    return "未知";
  }
  const month = Number(matched[3]);
  const day = Number(matched[4]);
  return `${matched[1]}年${matched[2] ? "闰" : ""}${months[month - 1]}月${days[day - 1]}`;
}

function describeBirth(user) {
  const time = user.birthHour || "未知";
  const place = user.birthPlace || "未知";
  const date = user.birthCalendar === "lunar" ? `农历${formatLunarText(user.birthDate)}` : `阳历${user.birthDate}`;
  return `${date}，出生时间${time}，出生地${place}`;
}

async function saveProfile(openid, event) {
  const user = await ensureUser(openid);
  const gender = event.gender === "female" || event.gender === "male" ? event.gender : "";
  const nickName = String(event.nickName || "").trim().slice(0, 20);
  const data = {
    nickName,
    gender,
    updatedAt: Date.now(),
  };
  if (gender === "female") {
    data.cycleLength = clampNumber(event.cycleLength, 15, 60, user.cycleLength || 28);
    data.periodLength = clampNumber(event.periodLength, 1, 15, user.periodLength || 5);
  }
  data.birthCalendar = event.birthCalendar === "lunar" ? "lunar" : "solar";
  data.birthDate = cleanBirthDate(data.birthCalendar, event.birthDate);
  data.birthHour = cleanBirthHour(event.birthHour);
  data.birthPlace = String(event.birthPlace || "").trim().slice(0, 80);
  const partner = user.chosenOpenid ? await findUser(user.chosenOpenid) : null;
  const mutual = isMutual({ ...user, gender }, partner);
  data.periodRemind = event.periodRemind === true;
  if (gender === "male" && data.periodRemind && !mutual) {
    data.periodRemind = false;
  }
  data.partnerTitle = user.chosenOpenid ? cleanPartnerTitle(event.partnerTitle, partner) : "";
  await db.collection("users").doc(user._id).update({ data });
  return session(openid);
}

async function savePartnerCycle(openid, event) {
  const user = await ensureUser(openid);
  const partner = user.chosenOpenid ? await findUser(user.chosenOpenid) : null;
  if (!(isMutual(user, partner) && user.gender === "male" && partner.gender === "female")) {
    throw new Error("现在不能修改对象的周期设置");
  }
  await db.collection("users").doc(partner._id).update({
    data: {
      cycleLength: clampNumber(event.cycleLength, 15, 60, partner.cycleLength || 28),
      periodLength: clampNumber(event.periodLength, 1, 15, partner.periodLength || 5),
      updatedAt: Date.now(),
    },
  });
  return session(openid);
}

async function listPeople(openid) {
  await ensureUser(openid);
  const res = await db.collection("users").limit(50).get();
  return {
    ok: true,
    people: res.data
      .filter((item) => item.openid !== openid)
      .map((item) => ({
        openid: item.openid,
        nickName: item.nickName || "",
        gender: item.gender || "",
        chosenMe: item.chosenOpenid === openid,
      })),
  };
}

async function choosePartner(openid, targetOpenid) {
  if (!targetOpenid || targetOpenid === openid) {
    throw new Error("不能选择自己");
  }
  const target = await findUser(targetOpenid);
  if (!target) {
    throw new Error("找不到这个人，请让对方先打开一次小程序");
  }
  const user = await ensureUser(openid);
  await db.collection("users").doc(user._id).update({
    data: { chosenOpenid: targetOpenid, updatedAt: Date.now() },
  });
  return session(openid);
}

async function clearPartner(openid) {
  const user = await ensureUser(openid);
  await db.collection("users").doc(user._id).update({
    data: { chosenOpenid: "", partnerTitle: "", updatedAt: Date.now() },
  });
  return session(openid);
}

function parseDate(text) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text || "");
  if (!matched) {
    throw new Error("日期格式不正确");
  }
  return text;
}

function addDays(text, count) {
  const [year, month, day] = text.split("-").map((item) => Number(item));
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + count);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function assertPeriodEditor(openid, ownerOpenid) {
  const user = await ensureUser(openid);
  const partner = user.chosenOpenid ? await findUser(user.chosenOpenid) : null;
  const access = periodAccess(user, partner);
  if (!access.canEdit || access.ownerOpenid !== ownerOpenid) {
    throw new Error("不能修改这份经期");
  }
  const owner = ownerOpenid === openid ? user : partner;
  if (!owner || owner.gender !== "female") {
    throw new Error("经期只记在女性名下");
  }
  return owner;
}

async function savePeriod(openid, event) {
  const ownerOpenid = event.ownerOpenid || openid;
  await assertPeriodEditor(openid, ownerOpenid);
  const startDate = parseDate(event.startDate);
  const endDate = parseDate(event.endDate);
  if (endDate < startDate) {
    throw new Error("结束日不能早于开始日");
  }
  if (diffDays(startDate, endDate) > 20) {
    throw new Error("一段经期最长记 20 天");
  }
  const notes = Array.isArray(event.notes)
    ? event.notes
        .filter((item) => item.date >= startDate && item.date <= endDate)
        .map((item) => ({
          date: item.date,
          flow: ["light", "medium", "heavy"].includes(item.flow) ? item.flow : "",
          pain: ["none", "mild", "strong"].includes(item.pain) ? item.pain : "",
        }))
    : [];
  await trimOverlaps(ownerOpenid, startDate, endDate, event.id);
  const data = {
    ownerOpenid,
    startDate,
    endDate,
    notes,
    updatedAt: Date.now(),
  };
  if (event.id) {
    const current = await db.collection("periods").doc(event.id).get();
    if (!current.data || current.data.ownerOpenid !== ownerOpenid) {
      throw new Error("找不到这段经期");
    }
    await db.collection("periods").doc(event.id).update({ data });
  } else {
    await db.collection("periods").add({ data: { ...data, createdAt: Date.now() } });
  }
  return session(openid);
}

function diffDays(start, end) {
  const toTime = (text) => {
    const [year, month, day] = text.split("-").map((item) => Number(item));
    return new Date(year, month - 1, day).getTime();
  };
  return Math.round((toTime(end) - toTime(start)) / 86400000);
}

/** 同一天只属于一段经期。新记录覆盖到的部分从旧记录里截掉，旧记录两侧都有剩余时保留后半段。 */
async function trimOverlaps(ownerOpenid, startDate, endDate, keepId) {
  const res = await db.collection("periods").where({ ownerOpenid }).limit(100).get();
  await Promise.all(
    res.data
      .filter((item) => item._id !== keepId && item.startDate <= endDate && item.endDate >= startDate)
      .map(async (item) => {
        const leftEnd = addDays(startDate, -1);
        const rightStart = addDays(endDate, 1);
        const keepLeft = item.startDate <= leftEnd;
        const keepRight = item.endDate >= rightStart;
        if (keepLeft && keepRight) {
          await db.collection("periods").doc(item._id).update({
            data: { endDate: leftEnd, notes: notesBetween(item.notes, item.startDate, leftEnd), updatedAt: Date.now() },
          });
          await db.collection("periods").add({
            data: {
              ownerOpenid,
              startDate: rightStart,
              endDate: item.endDate,
              notes: notesBetween(item.notes, rightStart, item.endDate),
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          });
          return;
        }
        if (keepLeft) {
          await db.collection("periods").doc(item._id).update({
            data: { endDate: leftEnd, notes: notesBetween(item.notes, item.startDate, leftEnd), updatedAt: Date.now() },
          });
          return;
        }
        if (keepRight) {
          await db.collection("periods").doc(item._id).update({
            data: { startDate: rightStart, notes: notesBetween(item.notes, rightStart, item.endDate), updatedAt: Date.now() },
          });
          return;
        }
        await db.collection("periods").doc(item._id).remove();
      })
  );
}

function notesBetween(notes, start, end) {
  return (notes || []).filter((item) => item.date >= start && item.date <= end);
}

async function deletePeriod(openid, id) {
  if (!id) {
    throw new Error("缺少经期记录");
  }
  const current = await db.collection("periods").doc(id).get();
  if (!current.data) {
    throw new Error("找不到这段经期");
  }
  await assertPeriodEditor(openid, current.data.ownerOpenid);
  await db.collection("periods").doc(id).remove();
  return session(openid);
}

function readVisibility(value) {
  return value === "self" ? "self" : "both";
}

async function saveAnniversary(openid, event) {
  await ensureUser(openid);
  const month = clampNumber(event.month, 1, 12, 0);
  const day = clampNumber(event.day, 1, 31, 0);
  const year = clampNumber(event.year, 1900, 2100, 0);
  if (!month || !day) {
    throw new Error("请填写月和日");
  }
  const title = String(event.title || "").trim().slice(0, 30);
  if (!title) {
    throw new Error("请填写纪念日名称");
  }
  const data = {
    creatorOpenid: openid,
    title,
    month,
    day,
    year: year || 0,
    yearly: event.yearly !== false,
    visibility: readVisibility(event.visibility),
    updatedAt: Date.now(),
  };
  if (event.id) {
    await assertOwner("anniversaries", event.id, openid);
    await db.collection("anniversaries").doc(event.id).update({ data });
  } else {
    await db.collection("anniversaries").add({ data: { ...data, createdAt: Date.now() } });
  }
  return session(openid);
}

async function deleteAnniversary(openid, id) {
  await assertOwner("anniversaries", id, openid);
  await db.collection("anniversaries").doc(id).remove();
  return session(openid);
}

async function saveSchedule(openid, event) {
  await ensureUser(openid);
  const title = String(event.title || "").trim().slice(0, 30);
  if (!title) {
    throw new Error("请填写日程");
  }
  const data = {
    creatorOpenid: openid,
    title,
    date: parseDate(event.date),
    note: String(event.note || "").trim().slice(0, 100),
    visibility: readVisibility(event.visibility),
    remind: ["dayBefore", "sameDay", "none"].includes(event.remind) ? event.remind : "dayBefore",
    updatedAt: Date.now(),
  };
  if (event.id) {
    await assertOwner("schedules", event.id, openid);
    await db.collection("schedules").doc(event.id).update({ data });
  } else {
    await db.collection("schedules").add({ data: { ...data, createdAt: Date.now() } });
  }
  return session(openid);
}

async function deleteSchedule(openid, id) {
  await assertOwner("schedules", id, openid);
  await db.collection("schedules").doc(id).remove();
  return session(openid);
}

function cleanPartnerTitle(title, partner) {
  const value = String(title || "");
  if (!PARTNER_ROLES.includes(value)) {
    return "";
  }
  if (partner && partner.gender === "male" && !MALE_ROLES.includes(value)) {
    return "";
  }
  if (partner && partner.gender === "female" && !FEMALE_ROLES.includes(value)) {
    return "";
  }
  return value;
}

async function saveBirthday(openid, event) {
  await ensureUser(openid);
  const calendar = event.calendar === "lunar" ? "lunar" : "solar";
  const month = clampNumber(event.month, 1, 12, 0);
  const day = clampNumber(event.day, 1, calendar === "lunar" ? 30 : 31, 0);
  const year = clampNumber(event.year, 1900, 2100, 0);
  if (!year || !month || !day) {
    throw new Error("请填写出生年份和日期");
  }
  const title = String(event.title || "").trim().slice(0, 30);
  if (!title) {
    throw new Error("请填写是谁的生日");
  }
  const data = {
    creatorOpenid: openid,
    title,
    calendar,
    year,
    month,
    day,
    leap: calendar === "lunar" && event.leap === true,
    visibility: readVisibility(event.visibility),
    updatedAt: Date.now(),
  };
  if (event.id) {
    await assertOwner("birthdays", event.id, openid);
    await db.collection("birthdays").doc(event.id).update({ data });
  } else {
    await db.collection("birthdays").add({ data: { ...data, createdAt: Date.now() } });
  }
  return session(openid);
}

async function deleteBirthday(openid, id) {
  await assertOwner("birthdays", id, openid);
  await db.collection("birthdays").doc(id).remove();
  return session(openid);
}

async function assertOwner(collection, id, openid) {
  if (!id) {
    throw new Error("缺少记录");
  }
  const current = await db.collection(collection).doc(id).get();
  if (!current.data || current.data.creatorOpenid !== openid) {
    throw new Error("只能修改自己创建的记录");
  }
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (res) => {
      let raw = "";
      res.on("data", (chunk) => {
        raw += chunk;
      });
      res.on("end", () => {
        if (res.statusCode !== 200) {
          reject(new Error("天气服务暂时不可用"));
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(new Error("天气数据无法解析"));
        }
      });
    });
    request.setTimeout(8000, () => {
      request.destroy();
      reject(new Error("天气服务超时"));
    });
    request.on("error", () => reject(new Error("天气服务暂时不可用")));
  });
}

function weatherText(code) {
  if (code === 0) return "晴";
  if (code <= 3) return "多云";
  if (code <= 48) return "有雾";
  if (code <= 67) return "下雨";
  if (code <= 77) return "下雪";
  if (code <= 82) return "阵雨";
  if (code >= 95) return "雷雨";
  return "天气变化";
}

function weatherKind(code) {
  if (code >= 95) return "storm";
  if (code === 0) return "sun";
  if (code <= 3) return "cloud";
  if (code <= 48) return "fog";
  if (code <= 77 || code === 85 || code === 86) return "snow";
  if (code <= 82) return "rain";
  return "cloud";
}

async function cityFromCoords(lat, lng) {
  try {
    const data = await httpGet(
      "https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=" +
        encodeURIComponent(lat) +
        "&longitude=" +
        encodeURIComponent(lng) +
        "&localityLanguage=zh"
    );
    return data.city || data.locality || data.principalSubdivision || "当前位置";
  } catch (error) {
    return "当前位置";
  }
}

function clothing(temp) {
  if (temp >= 28) return "适合短袖";
  if (temp >= 22) return "可以穿薄外套";
  if (temp >= 15) return "建议穿外套";
  if (temp >= 8) return "建议穿厚外套";
  return "注意保暖";
}

async function geocodePlace(place) {
  const parts = String(place || "").split(/\s+/).filter(Boolean);
  const names = [parts[1], parts[2], parts[0], place.replace(/\s+/g, "")].filter(Boolean);
  for (let index = 0; index < names.length; index += 1) {
    const data = await httpGet(
      "https://geocoding-api.open-meteo.com/v1/search?name=" +
        encodeURIComponent(names[index]) +
        "&count=1&language=zh&countryCode=CN"
    );
    if (data.results && data.results[0]) {
      return data.results[0];
    }
  }
  throw new Error("没有找到这个城市");
}

/** 小程序不直接访问外网。坐标只用来查天气，不写入数据库。 */
async function weather(event) {
  let lat = Number(event.latitude);
  let lng = Number(event.longitude);
  let place = String(event.place || "").trim();
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    if (!place) {
      throw new Error("没有拿到位置");
    }
    const found = await geocodePlace(place);
    lat = found.latitude;
    lng = found.longitude;
    const parts = place.split(/\s+/).filter(Boolean);
    place = parts[1] || parts[0] || place;
  } else {
    place = await cityFromCoords(lat, lng);
  }
  const url =
    "https://api.open-meteo.com/v1/forecast?latitude=" +
    encodeURIComponent(lat) +
    "&longitude=" +
    encodeURIComponent(lng) +
    "&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=Asia%2FShanghai";
  const data = await httpGet(url);
  const current = data.current || {};
  const daily = data.daily || {};
  const temp = Math.round(Number(current.temperature_2m));
  const tempMax = Math.round(Number(daily.temperature_2m_max && daily.temperature_2m_max[0]));
  const tempMin = Math.round(Number(daily.temperature_2m_min && daily.temperature_2m_min[0]));
  const code = Number(current.weather_code);
  const wind = Number(current.wind_speed_10m);
  if (!Number.isFinite(temp)) {
    throw new Error("天气数据不完整");
  }
  return {
    ok: true,
    temp,
    tempMax: Number.isFinite(tempMax) ? tempMax : temp,
    tempMin: Number.isFinite(tempMin) ? tempMin : temp,
    text: weatherText(code),
    kind: weatherKind(code),
    windy: Number.isFinite(wind) && wind >= 8,
    heavy: code >= 63 && code <= 67,
    place,
    clothing: clothing(temp),
  };
}

function todayShanghai() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function periodBrief(periods, cycleLength, periodLength) {
  if (!periods || !periods.length) {
    return "没有经期记录";
  }
  const starts = periods.map((item) => item.startDate).filter(Boolean).sort();
  return `最近一次经期开始于 ${starts[starts.length - 1]}，周期约 ${cycleLength} 天，经期约 ${periodLength} 天。近期开始日：${starts.slice(-6).join("、")}`;
}

function postJson(url, headers, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "POST",
        headers: Object.assign({ "Content-Length": Buffer.byteLength(data) }, headers),
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch (error) {
            reject(new Error("AI 返回无法解析"));
          }
        });
      }
    );
    request.setTimeout(20000, () => {
      request.destroy();
      reject(new Error("AI 服务超时"));
    });
    request.on("error", () => reject(new Error("AI 服务暂时不可用")));
    request.write(data);
    request.end();
  });
}

function parseAiJson(text) {
  const cleaned = String(text || "").replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned);
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
  const lines = Array.isArray(parsed.lines) ? parsed.lines.map((item) => String(item).trim()).filter(Boolean).slice(0, 6) : [];
  if (!lines.length) {
    throw new Error("AI 没有给出可用的话");
  }
  const brief = String(parsed.brief || "").trim().slice(0, 80);
  return { score, lines, brief };
}

function deepSeekKey() {
  if (process.env.DEEPSEEK_API_KEY) {
    return process.env.DEEPSEEK_API_KEY;
  }
  try {
    return require("./secret").DEEPSEEK_API_KEY || "";
  } catch (error) {
    return "";
  }
}

async function callDeepSeek(prompt) {
  const key = deepSeekKey();
  if (!key) {
    throw new Error("还没有配置 AI 密钥");
  }
  const result = await postJson(
    "https://api.deepseek.com/chat/completions",
    {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    {
      model: "deepseek-chat",
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content: "你是炎都拾光里的生活助手。综合五行、星座、八字和紫微斗数，用温和的中文说话。不要写成医疗建议或命运定论。不要在正文里写出出生年月日、时辰或出生地。只输出 JSON，不要加别的文字。",
        },
        { role: "user", content: prompt },
      ],
    }
  );
  const text = result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content;
  return parseAiJson(text);
}

async function readingContext(openid) {
  const user = await ensureUser(openid);
  if (!user.birthDate) {
    return null;
  }
  const partner = user.chosenOpenid ? await findUser(user.chosenOpenid) : null;
  const mutual = isMutual(user, partner);
  const access = periodAccess(user, partner);
  const periods = access.visible ? await listByOwner("periods", access.ownerOpenid) : [];
  const owner = access.ownerOpenid === user.openid ? user : partner;
  return { user, partner, mutual, periods, owner };
}

async function dailyReading(openid, event) {
  const context = await readingContext(openid);
  if (!context) {
    return { ok: true, skipped: true };
  }
  const date = todayShanghai();
  const weatherSource = String((event && event.weatherSource) || "").trim().slice(0, 40);
  const weatherLine = String((event && event.weather) || "").trim().slice(0, 80);
  const cached = await db.collection("readings").where({
    openid,
    date,
    promptVersion: PROMPT_VERSION,
    weatherSource,
  }).limit(1).get();
  if (cached.data[0]) {
    return {
      ok: true,
      score: cached.data[0].score,
      lines: cached.data[0].lines,
      brief: cached.data[0].brief || "",
      date,
    };
  }
  const { user, partner, mutual, periods, owner } = context;
  let periodText = "这次不涉及经期。";
  if (owner && owner.gender === "female") {
    periodText = periodBrief(periods, owner.cycleLength || 28, owner.periodLength || 5);
  }
  const partnerText = mutual && partner && partner.birthDate
    ? `对象：${describeBirth(partner)}。`
    : "没有对象的生日资料。";
  const parsed = await callDeepSeek(
    `请为今天（${date}）写一段综合建议。综合五行、星座、八字和紫微斗数，再参考天气和经期。请用昵称「${user.nickName || "你"}」称呼对方。不要在正文写出出生年月日、时辰或出生地。本人：${describeBirth(user)}，性别${user.gender === "female" ? "女" : user.gender === "male" ? "男" : "未填"}。天气：${weatherLine || "未知"}。${partnerText}经期资料：${periodText}。输出 JSON：{"score":0到100的整数,"lines":["问候","今日提示","照顾建议","另一条建议"],"brief":"给日历用的一两句短建议，也用这个昵称"}。lines 一共 3 到 4 句。如果有经期资料，照顾建议要具体一点，但不要写成诊断。`
  );
  await db.collection("readings").add({
    data: {
      openid,
      date,
      promptVersion: PROMPT_VERSION,
      weatherSource,
      score: parsed.score,
      lines: parsed.lines,
      brief: parsed.brief,
      createdAt: Date.now(),
    },
  });
  return { ok: true, score: parsed.score, lines: parsed.lines, brief: parsed.brief, date };
}

async function almanac(date) {
  const day = String(date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error("日期不对");
  }
  const cached = await db.collection("almanacs").where({ date: day }).limit(1).get();
  if (cached.data[0]) {
    return { ok: true, yi: cached.data[0].yi, ji: cached.data[0].ji, note: cached.data[0].note || "" };
  }
  const key = deepSeekKey();
  if (!key) {
    throw new Error("还没有配置 AI 密钥");
  }
  const result = await postJson(
    "https://api.deepseek.com/chat/completions",
    { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    {
      model: "deepseek-chat",
      temperature: 0.3,
      messages: [
        { role: "system", content: "你按传统黄历给出某一天的宜和忌。只输出 JSON。不要写成医疗建议或命运定论。" },
        { role: "user", content: `公历 ${day} 的黄历。输出 {"yi":"用顿号分开，不超过8项","ji":"用顿号分开，不超过8项","note":"一句说明，并写仅供参考"}` },
      ],
    }
  );
  const text = result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content;
  const parsed = JSON.parse(String(text || "").replace(/```json|```/g, "").trim());
  const yi = String(parsed.yi || "").trim().slice(0, 80);
  const ji = String(parsed.ji || "").trim().slice(0, 80);
  const note = String(parsed.note || "仅供参考").trim().slice(0, 80);
  if (!yi || !ji) {
    throw new Error("没有整理出这一天的宜忌");
  }
  await db.collection("almanacs").add({ data: { date: day, yi, ji, note, createdAt: Date.now() } });
  return { ok: true, yi, ji, note };
}

async function listAsks(openid) {
  const date = todayShanghai();
  const found = await db.collection("asks").where({ openid, date }).limit(20).get();
  const items = found.data.slice().sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));
  return {
    ok: true,
    items: items.map((item) => ({ question: item.question, answer: item.answer })),
    remaining: Math.max(0, 10 - items.length),
  };
}

async function ask(openid, question) {
  const text = String(question || "").trim().slice(0, 200);
  if (!text) {
    throw new Error("请输入问题");
  }
  const context = await readingContext(openid);
  if (!context) {
    throw new Error("先填写生日，再来问");
  }
  const date = todayShanghai();
  const count = await db.collection("asks").where({ openid, date }).count();
  if (count.total >= 10) {
    throw new Error("今天的提问已经用完了");
  }
  const reading = await db.collection("readings").where({ openid, date, promptVersion: PROMPT_VERSION }).limit(1).get();
  const lines = reading.data[0] ? reading.data[0].lines.join("\n") : "";
  const earlier = await db.collection("asks").where({ openid, date }).limit(20).get();
  const history = earlier.data
    .slice()
    .sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0))
    .slice(-4)
    .flatMap((item) => [
      { role: "user", content: item.question },
      { role: "assistant", content: item.answer },
    ]);
  const key = deepSeekKey();
  if (!key) {
    throw new Error("还没有配置 AI 密钥");
  }
  const result = await postJson(
    "https://api.deepseek.com/chat/completions",
    { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    {
      model: "deepseek-chat",
      temperature: 0.7,
      messages: [
        { role: "system", content: "你是炎都拾光里的生活助手。综合五行、星座、八字和紫微斗数，用几句温和的中文回答。不要写成医疗建议。不要写出出生年月日、时辰或出生地。不要输出 JSON。" },
        { role: "user", content: `今天的建议是：\n${lines}` },
      ].concat(history, [{ role: "user", content: text }]),
    }
  );
  const answer = (result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content) || "";
  if (!answer.trim()) {
    throw new Error("没有得到回答");
  }
  await db.collection("asks").add({
    data: { openid, date, question: text, answer: answer.trim(), createdAt: Date.now() },
  });
  return { ok: true, answer: answer.trim(), remaining: Math.max(0, 10 - earlier.data.length - 1) };
}
