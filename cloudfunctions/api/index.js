// 一心日志唯一的云函数。小程序不直接读写数据库。
const cloud = require("wx-server-sdk");
const https = require("https");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLLECTIONS = ["users", "periods", "anniversaries", "schedules"];

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
      case "weather":
        return await weather(event.latitude, event.longitude);
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
    partner: partner ? publicUser(partner) : null,
    mutual,
    canEditPeriod: access.canEdit,
    periodOwnerOpenid: access.ownerOpenid,
    periods,
    anniversaries: await visibleItems("anniversaries", openid, partner, mutual),
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
    data: { chosenOpenid: "", updatedAt: Date.now() },
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

function clothing(temp) {
  if (temp >= 28) return "适合短袖";
  if (temp >= 22) return "可以穿薄外套";
  if (temp >= 15) return "建议穿外套";
  if (temp >= 8) return "建议穿厚外套";
  return "注意保暖";
}

/** 小程序不直接访问外网。经纬度只用来查天气，不写入数据库。 */
async function weather(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("没有拿到位置");
  }
  const url =
    "https://api.open-meteo.com/v1/forecast?latitude=" +
    encodeURIComponent(lat) +
    "&longitude=" +
    encodeURIComponent(lng) +
    "&current=temperature_2m,weather_code&timezone=Asia%2FShanghai";
  const data = await httpGet(url);
  const current = data.current || {};
  const temp = Math.round(Number(current.temperature_2m));
  if (!Number.isFinite(temp)) {
    throw new Error("天气数据不完整");
  }
  return {
    ok: true,
    temp,
    text: weatherText(Number(current.weather_code)),
    clothing: clothing(temp),
  };
}
