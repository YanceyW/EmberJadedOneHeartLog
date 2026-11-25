// 炎都拾光唯一的云函数。小程序不直接读写数据库。
const cloud = require("wx-server-sdk");
const crypto = require("crypto");
const https = require("https");
const zlib = require("zlib");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLLECTIONS = [
  "users",
  "periods",
  "anniversaries",
  "birthdays",
  "schedules",
  "wishes",
  "decisions",
  "capsules",
  "timetables",
  "subscriptions",
  "readings",
  "asks",
  "memories",
  "notes",
  "holidays",
];
const MALE_ROLES = ["男友", "未婚夫", "丈夫"];
const FEMALE_ROLES = ["女友", "未婚妻", "妻子"];
const PARTNER_ROLES = MALE_ROLES.concat(FEMALE_ROLES);
const PROMPT_VERSION = 2;

exports.main = async (event) => {
  // 定时触发器没有用户身份，先处理掉。
  if (event && event.Type === "Timer") {
    try {
      await ensureCollections();
      const result = await remindTick();
      // 每天凌晨顺手看一眼有没有新一年的放假安排（内部还有 7 天节流）。
      if (shanghaiHour() === 4) {
        try {
          await syncHolidays({ force: false });
        } catch (error) {
          console.warn("节假日同步失败", error);
        }
      }
      return result;
    } catch (error) {
      console.error("定时提醒失败", error);
      return { ok: false, message: error.message || "定时提醒失败" };
    }
  }
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
      case "saveWish":
        return await saveWish(OPENID, event);
      case "deleteWish":
        return await deleteWish(OPENID, event.id);
      case "deleteRecords":
        return await deleteRecords(OPENID, event.items);
      case "saveDecision":
        return await saveDecision(OPENID, event);
      case "voteDecision":
        return await voteDecision(OPENID, event);
      case "finishDecision":
        return await finishDecision(OPENID, event);
      case "deleteDecision":
        return await deleteDecision(OPENID, event.id);
      case "saveCapsule":
        return await saveCapsule(OPENID, event);
      case "openCapsule":
        return await openCapsule(OPENID, event.id);
      case "deleteCapsule":
        return await deleteCapsule(OPENID, event.id);
      case "getTimetable":
        return await getTimetable(OPENID, event);
      case "saveTimetable":
        return await saveTimetable(OPENID, event);
      case "timetableBrief":
        return await timetableBrief(OPENID);
      case "getHolidays":
        return await getHolidays();
      case "syncHolidays":
        return await syncHolidays({ force: event.force === true });
      case "getSubscriptions":
        return await getSubscriptions(OPENID);
      case "setSubscribeEnabled":
        return await setSubscribeEnabled(OPENID, event);
      case "grantSubscribe":
        return await grantSubscribe(OPENID, event.keys);
      case "testPush":
        return await testPush(OPENID, event);
      case "clearMyData":
        return await clearMyData(OPENID);
      case "weather":
        return await weather(event);
      case "partnerNote":
        return await partnerNote(OPENID);
      case "sendNote":
        return await sendNote(OPENID, event.text);
      case "dailyReading":
        return await dailyReading(OPENID, event);
      case "listAsks":
        return await listAsks(OPENID, event);
      case "deleteAsks":
        return await deleteAsks(OPENID, event.ids);
      case "getMemory":
        return await getMemory(OPENID);
      case "saveMemory":
        return await saveMemory(OPENID, event.text);
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

const USER_FIELDS = [
  "nickName",
  "gender",
  "birthCalendar",
  "birthDate",
  "birthHour",
  "birthPlace",
  "chosenOpenid",
  "partnerTitle",
  "cycleLength",
  "periodLength",
  "periodRemind",
];

function filled(value) {
  return value !== undefined && value !== null && value !== "" && value !== false;
}

/** 字段越全越靠前。用同一套规则挑主记录，并发合并时也会选同一条。 */
function pickUser(list) {
  return (
    list
      .slice()
      .sort((left, right) => {
        const leftScore = USER_FIELDS.filter((key) => filled(left[key])).length;
        const rightScore = USER_FIELDS.filter((key) => filled(right[key])).length;
        return (
          rightScore - leftScore ||
          (right.updatedAt || 0) - (left.updatedAt || 0) ||
          (right.createdAt || 0) - (left.createdAt || 0)
        );
      })[0] || null
  );
}

async function findUsers(openid) {
  const res = await db.collection("users").where({ openid }).limit(10).get();
  return res.data || [];
}

/** 同一个 openid 只留一条：字段补齐到主记录，多余的删掉。 */
async function settleUsers(list) {
  if (!list.length) {
    return null;
  }
  if (list.length === 1) {
    return list[0];
  }
  const keep = pickUser(list);
  const patch = { openid: keep.openid, updatedAt: Date.now() };
  list.forEach((item) => {
    USER_FIELDS.forEach((key) => {
      if (filled(item[key])) {
        patch[key] = item[key];
      }
    });
  });
  USER_FIELDS.forEach((key) => {
    if (filled(keep[key])) {
      patch[key] = keep[key];
    }
  });
  await db.collection("users").doc(keep._id).update({ data: patch });
  const extras = list.filter((item) => item._id !== keep._id);
  await Promise.all(extras.map((item) => db.collection("users").doc(item._id).remove().catch(() => {})));
  return { ...keep, ...patch };
}

/** 读一个人。遇到重复时给最完整的那条，不写库。 */
async function findUser(openid) {
  const list = await findUsers(openid);
  if (list.length > 1) {
    return pickUser(list);
  }
  return list[0] || null;
}

async function ensureUser(openid) {
  const list = await findUsers(openid);
  if (list.length) {
    return await settleUsers(list);
  }
  const now = Date.now();
  try {
    await db.collection("users").add({
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
  } catch (error) {
    // 并发时另一个请求可能已经建好了
  }
  const after = await findUsers(openid);
  if (!after.length) {
    throw new Error("创建用户资料失败，请再试一次");
  }
  return await settleUsers(after);
}

/** 读之前先把重复资料合并掉，不创建新用户。 */
async function settleUser(openid) {
  const list = await findUsers(openid);
  return await settleUsers(list);
}

/** 写自己资料。万一写的那一刻主记录刚被合并掉，就重取一次再写。 */
async function updateUser(openid, user, data) {
  const res = await db.collection("users").doc(user._id).update({ data });
  if (res && res.stats && !res.stats.updated) {
    const fresh = await ensureUser(openid);
    await db.collection("users").doc(fresh._id).update({ data });
  }
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
    periodRemind: readRemind(user.periodRemind),
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
  const partner = user.chosenOpenid ? await settleUser(user.chosenOpenid) : null;
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
    wishes: await visibleItems("wishes", openid, partner, mutual),
    decisions: await visibleItems("decisions", openid, partner, mutual),
    capsules: await visibleCapsules(openid, partner, mutual),
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

const REMIND_SPAN = 30;

/** 提醒时机统一成 { enabled, leadDays, hour, minute }；读不出这个结构就当没开。 */
function readRemind(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { enabled: false, leadDays: 1, hour: 9, minute: 0 };
  }
  const minute = Number.isFinite(Number(value.minute))
    ? clampNumber(Math.round(Number(value.minute) / 5) * 5, 0, 55, 0)
    : 0;
  return {
    enabled: value.enabled !== false,
    leadDays: clampNumber(value.leadDays, 0, REMIND_SPAN, 1),
    hour: clampNumber(value.hour, 0, 23, 9),
    minute,
  };
}

function cleanBirthDate(calendar, value) {
  const text = String(value || "");
  if (calendar === "lunar") {
    return /^\d{4}-L?(0[1-9]|1[0-2])-(0[1-9]|[12]\d|30)$/.test(text) ? text : "";
  }
  return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(text) ? text : "";
}

/** 生日时辰统一成「子时 23:00-01:00」这一种写法。 */
function cleanBirthHour(value) {
  const text = String(value || "").trim();
  const matched = /^(子|丑|寅|卯|辰|巳|午|未|申|酉|戌|亥)时 ([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-4]):[0-5]\d$/.exec(text);
  return matched ? text : "";
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
  data.periodRemind = readRemind(event.periodRemind);
  if (gender === "male" && data.periodRemind.enabled && !mutual) {
    data.periodRemind = { ...data.periodRemind, enabled: false };
  }
  data.partnerTitle = user.chosenOpenid ? cleanPartnerTitle(event.partnerTitle, partner) : "";
  await updateUser(openid, user, data);
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
  const res = await db.collection("users").limit(100).get();
  const byOpenid = new Map();
  res.data.forEach((item) => {
    if (!item.openid || item.openid === openid) {
      return;
    }
    const current = byOpenid.get(item.openid);
    byOpenid.set(item.openid, current ? pickUser([current, item]) : item);
  });
  return {
    ok: true,
    people: Array.from(byOpenid.values()).map((item) => ({
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
  await updateUser(openid, user, { chosenOpenid: targetOpenid, updatedAt: Date.now() });
  return session(openid);
}

async function clearPartner(openid) {
  const user = await ensureUser(openid);
  await updateUser(openid, user, { chosenOpenid: "", partnerTitle: "", updatedAt: Date.now() });
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
    remind: readRemind(event.remind),
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
    remind: readRemind(event.remind),
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
    remind: readRemind(event.remind),
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

async function saveWish(openid, event) {
  await ensureUser(openid);
  const title = String(event.title || "").trim().slice(0, 40);
  if (!title) {
    throw new Error("先写想要什么");
  }
  const targetDate = event.targetDate && /^\d{4}-\d{2}-\d{2}$/.test(event.targetDate) ? event.targetDate : "";
  const data = {
    creatorOpenid: openid,
    title,
    targetDate,
    visibility: readVisibility(event.visibility),
    updatedAt: Date.now(),
  };
  if (event.id) {
    await assertOwner("wishes", event.id, openid);
    await db.collection("wishes").doc(event.id).update({ data });
  } else {
    await db.collection("wishes").add({ data: { ...data, createdAt: Date.now() } });
  }
  return session(openid);
}

async function deleteWish(openid, id) {
  await assertOwner("wishes", id, openid);
  await db.collection("wishes").doc(id).remove();
  return session(openid);
}

const RECORD_COLLECTIONS = {
  anniversary: "anniversaries",
  birthday: "birthdays",
  schedule: "schedules",
  wish: "wishes",
};

/** 管理模式下批量删除。只能删自己创建的；对方的记录跳过并回报数量。 */
async function deleteRecords(openid, items) {
  const list = Array.isArray(items) ? items.slice(0, 100) : [];
  let deleted = 0;
  let skipped = 0;
  for (const item of list) {
    const kind = String((item && item.kind) || "");
    const id = String((item && item.id) || "");
    if (!id) {
      continue;
    }
    try {
      if (kind === "period") {
        const current = await db.collection("periods").doc(id).get();
        if (!current.data) {
          skipped += 1;
          continue;
        }
        await assertPeriodEditor(openid, current.data.ownerOpenid);
        await db.collection("periods").doc(id).remove();
      } else {
        const collection = RECORD_COLLECTIONS[kind];
        if (!collection) {
          skipped += 1;
          continue;
        }
        await assertOwner(collection, id, openid);
        await db.collection(collection).doc(id).remove();
      }
      deleted += 1;
    } catch (error) {
      skipped += 1;
    }
  }
  const result = await session(openid);
  return { ...result, deleted, skipped };
}

const DECISION_CATEGORIES = {
  eat: "吃什么",
  go: "去哪",
  do: "做什么",
  other: "一起决定",
};

function readDecisionOptions(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((item) => String(item || "").trim().slice(0, 20))
    .filter(Boolean)
    .slice(0, 6)
    .map((text, index) => ({ id: `o${index + 1}`, text }));
}

async function saveDecision(openid, event) {
  await ensureUser(openid);
  const title = String(event.title || "").trim().slice(0, 30);
  if (!title) {
    throw new Error("先写要决定什么");
  }
  const options = readDecisionOptions(event.options);
  if (options.length < 2) {
    throw new Error("至少写两个选项");
  }
  const data = {
    creatorOpenid: openid,
    title,
    category: DECISION_CATEGORIES[event.category] ? event.category : "other",
    options,
    votes: {},
    result: null,
    state: "open",
    visibility: readVisibility(event.visibility),
    updatedAt: Date.now(),
  };
  if (event.id) {
    await assertOwner("decisions", event.id, openid);
    await db.collection("decisions").doc(event.id).update({ data });
  } else {
    await db.collection("decisions").add({ data: { ...data, createdAt: Date.now() } });
  }
  return session(openid);
}

async function voteDecision(openid, event) {
  const id = String(event.id || "");
  const optionId = String(event.optionId || "");
  if (!id || !optionId) {
    throw new Error("缺少选项");
  }
  const current = await db.collection("decisions").doc(id).get();
  const doc = current.data;
  if (!doc) {
    throw new Error("找不到这个决定");
  }
  if (doc.state === "done") {
    throw new Error("已经定下来了");
  }
  if (!(doc.options || []).some((item) => item.id === optionId)) {
    throw new Error("选项不存在");
  }
  const votes = Object.assign({}, doc.votes || {});
  votes[openid] = optionId;
  await db.collection("decisions").doc(id).update({ data: { votes, updatedAt: Date.now() } });
  return session(openid);
}

async function finishDecision(openid, event) {
  const id = String(event.id || "");
  const mode = event.mode === "random" ? "random" : "vote";
  const current = await db.collection("decisions").doc(id).get();
  const doc = current.data;
  if (!doc) {
    throw new Error("找不到这个决定");
  }
  if (doc.state === "done") {
    throw new Error("已经定下来了");
  }
  const options = doc.options || [];
  if (!options.length) {
    throw new Error("没有选项");
  }
  let picked = null;
  if (mode === "random") {
    picked = options[Math.floor(Math.random() * options.length)];
  } else {
    const votes = doc.votes || {};
    const counts = options.map((option) => ({
      option,
      count: Object.values(votes).filter((value) => value === option.id).length,
    }));
    const max = Math.max.apply(null, counts.map((item) => item.count));
    if (!max) {
      throw new Error("还没有人投票");
    }
    const top = counts.filter((item) => item.count === max).map((item) => item.option);
    picked = top[Math.floor(Math.random() * top.length)];
  }
  await db.collection("decisions").doc(id).update({
    data: {
      state: "done",
      result: { optionId: picked.id, text: picked.text, mode },
      updatedAt: Date.now(),
    },
  });
  const targets = await remindTargets(doc.creatorOpenid, doc.visibility);
  await pushTo(targets, "decision", { title: doc.title, result: picked.text, clock: shanghaiClock().slice(-5) });
  return session(openid);
}

async function deleteDecision(openid, id) {
  await assertOwner("decisions", id, openid);
  await db.collection("decisions").doc(id).remove();
  return session(openid);
}

/** 未到期只给标题和天数，正文连接口都不返回。 */
function capsuleView(item, openid) {
  const today = todayShanghai();
  const due = (item.openAt || "") <= today;
  return {
    id: item._id,
    title: item.title || "",
    openAt: item.openAt || "",
    visibility: item.visibility === "self" ? "self" : "both",
    mine: item.creatorOpenid === openid,
    due,
    opened: !!item.openedAt,
    daysLeft: due ? 0 : diffDays(today, item.openAt || today),
    content: due ? item.content || "" : "",
    remind: readRemind(item.remind),
  };
}

async function visibleCapsules(openid, partner, mutual) {
  const mine = await db.collection("capsules").where({ creatorOpenid: openid }).limit(100).get();
  let shared = [];
  if (mutual && partner) {
    const res = await db.collection("capsules").where({ creatorOpenid: partner.openid, visibility: "both" }).limit(100).get();
    shared = res.data;
  }
  return mine.data
    .concat(shared)
    .sort((left, right) => (left.openAt < right.openAt ? -1 : left.openAt > right.openAt ? 1 : 0))
    .map((item) => capsuleView(item, openid));
}

async function saveCapsule(openid, event) {
  await ensureUser(openid);
  const title = String(event.title || "").trim().slice(0, 30);
  if (!title) {
    throw new Error("先写个标题");
  }
  const content = String(event.content || "").trim().slice(0, 1000);
  if (!content) {
    throw new Error("先写点内容再封存");
  }
  const openAt = parseDate(event.openAt);
  if (openAt < todayShanghai()) {
    throw new Error("开启日期不能是过去");
  }
  const data = {
    creatorOpenid: openid,
    title,
    content,
    openAt,
    visibility: readVisibility(event.visibility),
    remind: readRemind(event.remind),
    updatedAt: Date.now(),
  };
  if (event.id) {
    await assertOwner("capsules", event.id, openid);
    await db.collection("capsules").doc(event.id).update({ data });
  } else {
    await db.collection("capsules").add({ data: { ...data, openedAt: 0, createdAt: Date.now() } });
  }
  return session(openid);
}

async function openCapsule(openid, id) {
  if (!id) {
    throw new Error("缺少胶囊");
  }
  const current = await db.collection("capsules").doc(id).get();
  const doc = current.data;
  if (!doc) {
    throw new Error("找不到这个胶囊");
  }
  const mine = doc.creatorOpenid === openid;
  if (!mine) {
    const viewer = await ensureUser(openid);
    const creator = await findUser(doc.creatorOpenid);
    if (doc.visibility !== "both" || !isMutual(viewer, creator)) {
      throw new Error("这个胶囊现在打不开");
    }
  }
  if ((doc.openAt || "") > todayShanghai()) {
    throw new Error("还没到期");
  }
  if (!doc.openedAt) {
    await db.collection("capsules").doc(id).update({ data: { openedAt: Date.now() } });
  }
  return { ok: true, content: doc.content || "" };
}

async function deleteCapsule(openid, id) {
  await assertOwner("capsules", id, openid);
  await db.collection("capsules").doc(id).remove();
  return session(openid);
}

const PERIOD_GROUPS = ["morning", "am", "pm", "evening"];
const GROUP_LIMIT = 8;
const GROUP_NAME_LIMIT = 6;
const GROUP_KEY_RE = /^[a-z][a-z0-9]{0,11}$/;
const PERIOD_LIMIT = 16;
const LESSON_LIMIT = 200;
const TONE_COUNT = 12;
const COLOR_LIMIT = 60;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 06:40 / 6:40 / 6：40 / 640 / 0640 都认，归一成 06:40；认不出返回空串。 */
function parseClock(text) {
  const raw = String(text || "")
    .trim()
    .replace(/[：.．]/g, ":");
  if (!raw) {
    return "";
  }
  if (TIME_RE.test(raw)) {
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

/** 该日期所在周的周一。 */
function mondayOf(text) {
  const [year, month, day] = String(text || "").split("-").map(Number);
  if (!year || !month || !day) {
    return mondayOf(todayShanghai());
  }
  const date = new Date(year, month - 1, day);
  const shift = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - shift);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 1 = 周一 … 7 = 周日。 */
function weekdayOf(text) {
  const [year, month, day] = String(text || "").split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const week = date.getDay();
  return week === 0 ? 7 : week;
}

/** 分组表：顺序就是课表页分组标题的顺序。内置四个 key 保持原样，老数据不用迁移。 */
function defaultGroups() {
  return [
    { key: "morning", name: "早自习" },
    { key: "am", name: "上午" },
    { key: "pm", name: "下午" },
    { key: "evening", name: "晚自习" },
  ];
}

/**
 * 归一分组表，并且保证「节次里用到的 key」一定在里面——否则那个分组在界面上会凭空消失。
 * 没被任何节次引用的分组也留着，用户可能刚建还没来得及用。
 */
function readGroups(value, periodSets) {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  list.forEach((item) => {
    if (out.length >= GROUP_LIMIT) {
      return;
    }
    const key = String((item && item.key) || "").trim();
    const name = String((item && item.name) || "").trim().slice(0, GROUP_NAME_LIMIT);
    if (!GROUP_KEY_RE.test(key) || !name || seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push({ key, name });
  });
  const groups = out.length ? out : defaultGroups();
  groups.forEach((item) => seen.add(item.key));
  const fallback = new Map(defaultGroups().map((item) => [item.key, item.name]));
  (periodSets || []).forEach((set) => {
    (Array.isArray(set) ? set : []).forEach((item) => {
      const key = String((item && item.group) || "").trim();
      if (!GROUP_KEY_RE.test(key) || seen.has(key) || groups.length >= GROUP_LIMIT) {
        return;
      }
      seen.add(key);
      groups.push({ key, name: fallback.get(key) || `分组${groups.length + 1}` });
    });
  });
  return groups;
}

function readPeriods(value, groupKeys) {
  const list = Array.isArray(value) ? value.slice(0, PERIOD_LIMIT) : [];
  const allowed = groupKeys instanceof Set ? groupKeys : new Set(PERIOD_GROUPS);
  return list.map((item, index) => {
    const name = String((item && item.name) || "").trim().slice(0, 10);
    const group = String((item && item.group) || "").trim();
    return {
      name: name || `第${index + 1}节`,
      start: parseClock(item && item.start) || "08:00",
      end: parseClock(item && item.end) || "08:40",
      group: allowed.has(group) ? group : "am",
    };
  });
}

/** 周六日单独排的那一套。空数组表示跟随工作日。 */
function readWeekendPeriods(value, groupKeys) {
  return Array.isArray(value) && value.length ? readPeriods(value, groupKeys) : [];
}

/** 某一天用哪一套节次：周六日单独排过就用周末那套，否则和工作日一样。 */
function periodsForDay(timetable, day) {
  const weekend = (timetable && timetable.weekendPeriods) || [];
  return day >= 6 && weekend.length ? weekend : (timetable && timetable.periods) || [];
}

function readLessons(value, weekdayCount, weekendCount) {
  const list = Array.isArray(value) ? value.slice(0, LESSON_LIMIT) : [];
  const seen = new Set();
  const out = [];
  list.forEach((item) => {
    const day = Number(item && item.day);
    const period = Number(item && item.period);
    // 一个格子就一段文字：学生写科目、老师写班级，随用户。
    const text = String((item && item.text) || "")
      .trim()
      .slice(0, 20);
    if (!Number.isInteger(day) || day < 1 || day > 7) {
      return;
    }
    const limit = day >= 6 && weekendCount ? weekendCount : weekdayCount;
    if (!Number.isInteger(period) || period < 0 || period >= limit) {
      return;
    }
    if (!text) {
      return;
    }
    const slot = `${day}-${period}`;
    if (seen.has(slot)) {
      return;
    }
    seen.add(slot);
    // tone 是这一格单独指定的颜色序号；不填就跟着同文字的默认色走。
    const tone = Number(item && item.tone);
    if (Number.isInteger(tone) && tone >= 0 && tone < TONE_COUNT) {
      out.push({ day, period, text, tone });
    } else {
      out.push({ day, period, text });
    }
  });
  return out;
}

/** 文字 → 颜色序号。只留还在课表里的文字，删光那门课的映射就不留了。 */
function readColors(value, lessons) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const alive = new Set((lessons || []).map((item) => item.text));
  const out = {};
  Object.keys(raw)
    .slice(0, COLOR_LIMIT)
    .forEach((key) => {
      const text = String(key || "").trim().slice(0, 20);
      const tone = Number(raw[key]);
      if (!text || !alive.has(text)) {
        return;
      }
      if (Number.isInteger(tone) && tone >= 0 && tone < TONE_COUNT) {
        out[text] = tone;
      }
    });
  return out;
}

function readHomeCycle(value) {
  const raw = value && typeof value === "object" ? value : {};
  const everyWeeks = clampNumber(raw.everyWeeks, 2, 8, 2);
  return {
    enabled: raw.enabled === true,
    everyWeeks,
    homeIndex: clampNumber(raw.homeIndex, 1, everyWeeks, everyWeeks),
    anchor: mondayOf(raw.anchor || todayShanghai()),
  };
}

function readWeekStates(value) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const out = {};
  Object.keys(raw)
    .slice(0, 60)
    .forEach((key) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
        return;
      }
      const state = raw[key] === "home" ? "home" : raw[key] === "class" ? "class" : "";
      if (state) {
        out[mondayOf(key)] = state;
      }
    });
  return out;
}

/** 某一周是上课还是回家：手动覆盖 > 轮换推导 > 默认上课。 */
function weekStateOf(timetable, monday) {
  if (!timetable) {
    return "class";
  }
  const override = (timetable.weekStates || {})[monday];
  if (override) {
    return override;
  }
  const cycle = timetable.homeCycle || {};
  if (!cycle.enabled) {
    return "class";
  }
  const span = clampNumber(cycle.everyWeeks, 2, 8, 2);
  const passed = Math.round(diffDays(cycle.anchor || monday, monday) / 7);
  const index = (((passed % span) + span) % span) + 1;
  return index === clampNumber(cycle.homeIndex, 1, span, span) ? "home" : "class";
}

/** 谁能看：self 只有自己，both 双方互相可见（默认）。 */
function readVisibility(value) {
  return value === "self" ? "self" : "both";
}

function publicTimetable(doc) {
  const lessons = (doc.lessons || []).map((item) => {
    const lesson = { day: item.day, period: item.period, text: item.text || "" };
    if (Number.isInteger(item.tone) && item.tone >= 0 && item.tone < TONE_COUNT) {
      lesson.tone = item.tone;
    }
    return lesson;
  });
  return {
    ownerOpenid: doc.ownerOpenid,
    visibility: readVisibility(doc.visibility),
    groups: readGroups(doc.groups, [doc.periods, doc.weekendPeriods]),
    periods: doc.periods || [],
    weekendPeriods: doc.weekendPeriods || [],
    lessons,
    colors: readColors(doc.colors, lessons),
    homeCycle: readHomeCycle(doc.homeCycle),
    weekStates: readWeekStates(doc.weekStates),
    updatedAt: doc.updatedAt || 0,
  };
}

/**
 * 自己能读能改的那些课表：永远有自己的，再加上「设成双方可见」的对象的。
 * 对方设成「仅自己」时不会出现在这里，所以看也看不到、改也改不到。
 */
async function timetableOwners(openid) {
  const user = await ensureUser(openid);
  const partner = user.chosenOpenid ? await findUser(user.chosenOpenid) : null;
  const owners = [user.openid];
  if (isMutual(user, partner)) {
    const theirs = await findTimetable(partner.openid);
    if (theirs && readVisibility(theirs.visibility) === "both") {
      owners.push(partner.openid);
    }
  }
  return { owners, mutual: owners.length > 1 };
}

async function findTimetable(ownerOpenid) {
  if (!ownerOpenid) {
    return null;
  }
  const res = await db.collection("timetables").where({ ownerOpenid }).limit(1).get();
  return res.data[0] || null;
}

async function getTimetable(openid, event) {
  const { owners } = await timetableOwners(openid);
  let doc = null;
  if (event && event.ownerOpenid && owners.includes(event.ownerOpenid)) {
    doc = await findTimetable(event.ownerOpenid);
  }
  for (const owner of owners) {
    if (doc) {
      break;
    }
    doc = await findTimetable(owner);
  }
  const monday = mondayOf(todayShanghai());
  if (!doc) {
    return { ok: true, timetable: null, weekMonday: monday, state: "class", mine: true };
  }
  const timetable = publicTimetable(doc);
  return {
    ok: true,
    timetable,
    weekMonday: monday,
    state: weekStateOf(timetable, monday),
    mine: doc.ownerOpenid === openid,
  };
}

async function saveTimetable(openid, event) {
  const { owners } = await timetableOwners(openid);
  const ownerOpenid = owners.includes(event.ownerOpenid) ? event.ownerOpenid : openid;
  const groups = readGroups(event.groups, [event.periods, event.weekendPeriods]);
  const groupKeys = new Set(groups.map((item) => item.key));
  const periods = readPeriods(event.periods, groupKeys);
  if (!periods.length) {
    throw new Error("先加一节");
  }
  const weekendPeriods = readWeekendPeriods(event.weekendPeriods, groupKeys);
  const lessons = readLessons(event.lessons, periods.length, weekendPeriods.length);
  const data = {
    ownerOpenid,
    visibility: readVisibility(event.visibility),
    groups,
    periods,
    weekendPeriods,
    lessons,
    colors: readColors(event.colors, lessons),
    homeCycle: readHomeCycle(event.homeCycle),
    weekStates: readWeekStates(event.weekStates),
    updatedAt: Date.now(),
  };
  const current = await findTimetable(ownerOpenid);
  if (current) {
    await db.collection("timetables").doc(current._id).update({ data });
  } else {
    await db.collection("timetables").add({ data: { ...data, createdAt: Date.now() } });
  }
  return getTimetable(openid, { ownerOpenid });
}

/** 某天的课，按那一天的节次顺序展开，空节不返回。周六日可能和工作日不是同一套节次。 */
function dayLessons(timetable, day) {
  const lessons = [];
  periodsForDay(timetable, day).forEach((period, index) => {
    const found = timetable.lessons.find((item) => item.day === day && item.period === index);
    if (!found) {
      return;
    }
    lessons.push({
      period: index,
      name: period.name,
      start: period.start,
      end: period.end,
      group: period.group,
      text: found.text || "",
    });
  });
  return lessons;
}

/** 首页卡片用：现在是哪一节、还剩几节、明天第一节。 */
async function timetableBrief(openid) {
  const { owners } = await timetableOwners(openid);
  let doc = null;
  for (const owner of owners) {
    if (doc) {
      break;
    }
    doc = await findTimetable(owner);
  }
  if (!doc) {
    return { ok: true, built: false };
  }
  const timetable = publicTimetable(doc);
  const stamp = shanghaiClock();
  const today = stamp.slice(0, 10);
  const clock = stamp.slice(-5);
  const monday = mondayOf(today);
  const state = weekStateOf(timetable, monday);
  const base = { ok: true, built: true, ownerOpenid: doc.ownerOpenid, state, today, clock };
  if (state === "home") {
    return base;
  }
  const todayLessons = dayLessons(timetable, weekdayOf(today));
  const current = todayLessons.find((item) => item.start <= clock && item.end >= clock) || null;
  const next = todayLessons.find((item) => item.start > clock) || null;
  const remain = todayLessons.filter((item) => item.end >= clock).length;
  const after = current ? current.start : clock;
  const preview = todayLessons
    .filter((item) => item.start > after)
    .slice(0, 2)
    .map((item) => ({ start: item.start, text: item.text }));

  let tomorrowFirst = null;
  const tomorrow = addDays(today, 1);
  if (weekStateOf(timetable, mondayOf(tomorrow)) === "class") {
    const list = dayLessons(timetable, weekdayOf(tomorrow));
    if (list.length) {
      tomorrowFirst = { start: list[0].start, text: list[0].text };
    }
  }
  return { ...base, current, next, remain, preview, tomorrowFirst, count: todayLessons.length };
}

/* ---------------- 法定节假日 ----------------
 * 节假日是项目里唯一会过期、又没有官方接口的数据：国务院每年 11 月才公布下一年安排。
 * 所以云端每周按顺序试三个源，抓到就写 holidays 集合；抓不到就静默跳过，
 * 前端还有一份内置表兜底，绝不会变成没数据。
 */

const HOLIDAY_SOURCES = [
  (year) => `https://timor.tech/api/holiday/year/${year}`,
  (year) => `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`,
  (year) => `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`,
];
const HOLIDAY_SYNC_DAYS = 7;
const DATE_TEXT_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 带超时的纯文本 GET，失败返回 null。 */
function fetchText(url, timeout = 5000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (!done) {
        done = true;
        resolve(value);
      }
    };
    try {
      const req = https.request(
        url,
        { method: "GET", timeout, headers: { "User-Agent": "ydsglog/1.0" } },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            finish(null);
            return;
          }
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            body += chunk;
            if (body.length > 1024 * 1024) {
              req.destroy();
              finish(null);
            }
          });
          res.on("end", () => finish(body));
        },
      );
      req.on("timeout", () => {
        req.destroy();
        finish(null);
      });
      req.on("error", () => finish(null));
      req.end();
    } catch (error) {
      finish(null);
    }
  });
}

async function fetchJson(url) {
  const text = await fetchText(url);
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

/** 春节那几天的 name 是「除夕 / 初一 / 初二…」，统一归到春节。 */
function normalizeHolidayName(name, isOffDay, target) {
  if (!isOffDay) {
    const base = String(target || name || "").replace(/[前后]补班$/, "").trim();
    return (base || "调休").slice(0, 10);
  }
  const text = String(name || "").trim();
  if (/^(除夕|小年|大年三十|初[一二三四五六七八九十]+)$/.test(text)) {
    return "春节";
  }
  return text.slice(0, 10);
}

/** timor.tech：{ code: 0, holiday: { "01-01": { holiday, name, date, target } } } */
function normalizeTimor(payload, year) {
  if (!payload || payload.code !== 0) {
    return null;
  }
  const table = payload.holiday;
  if (!table || typeof table !== "object" || Array.isArray(table)) {
    return null;
  }
  const days = [];
  Object.keys(table).forEach((key) => {
    const item = table[key];
    if (!item || typeof item !== "object") {
      return;
    }
    const date = String(item.date || "");
    if (!DATE_TEXT_RE.test(date) || date.slice(0, 4) !== String(year)) {
      return;
    }
    if (typeof item.holiday !== "boolean") {
      return;
    }
    const isOffDay = item.holiday === true;
    days.push({
      date,
      name: normalizeHolidayName(item.name, isOffDay, item.target),
      isOffDay,
    });
  });
  return days.length ? days : null;
}

/** holiday-cn：{ year, papers, days: [{ date, name, isOffDay }] } */
function normalizeHolidayCn(payload, year) {
  if (!payload || Number(payload.year) !== Number(year) || !Array.isArray(payload.days)) {
    return null;
  }
  const days = [];
  payload.days.forEach((item) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const date = String(item.date || "");
    if (!DATE_TEXT_RE.test(date) || date.slice(0, 4) !== String(year)) {
      return;
    }
    if (typeof item.isOffDay !== "boolean") {
      return;
    }
    const name = normalizeHolidayName(item.name, item.isOffDay);
    if (!name) {
      return;
    }
    days.push({ date, name, isOffDay: item.isOffDay });
  });
  return days.length ? days : null;
}

/** 校验并去重排序。任何一条关键字段不对就整年丢弃，宁可用内置也不用半份坏数据。 */
function validateDays(days, year) {
  if (!Array.isArray(days) || !days.length) {
    return null;
  }
  const seen = new Set();
  const out = [];
  for (let index = 0; index < days.length; index += 1) {
    const item = days[index];
    if (!item || !DATE_TEXT_RE.test(item.date) || item.date.slice(0, 4) !== String(year)) {
      return null;
    }
    if (typeof item.isOffDay !== "boolean") {
      return null;
    }
    const name = String(item.name || "").trim();
    if (!name || name.length > 10) {
      return null;
    }
    if (!seen.has(item.date)) {
      seen.add(item.date);
      out.push({ date: item.date, name, isOffDay: item.isOffDay });
    }
  }
  out.sort((left, right) => (left.date < right.date ? -1 : 1));
  return out;
}

async function readHolidayMeta() {
  const res = await db.collection("holidays").where({ kind: "meta" }).limit(1).get();
  return res.data[0] || null;
}

async function findHolidayYear(year) {
  const res = await db.collection("holidays").where({ kind: "year", year: Number(year) }).limit(1).get();
  return res.data[0] || null;
}

async function saveHolidayMeta(patch) {
  const current = await readHolidayMeta();
  const data = { kind: "meta", ...patch, updatedAt: Date.now() };
  if (current) {
    await db.collection("holidays").doc(current._id).update({ data });
  } else {
    await db.collection("holidays").add({ data });
  }
}

/** 抓一年：三个源按顺序试，成功即止。 */
async function fetchHolidayYear(year) {
  for (let index = 0; index < HOLIDAY_SOURCES.length; index += 1) {
    const url = HOLIDAY_SOURCES[index](year);
    const payload = await fetchJson(url);
    if (!payload) {
      continue;
    }
    const parsed = normalizeTimor(payload, year) || normalizeHolidayCn(payload, year);
    const days = validateDays(parsed, year);
    if (days && days.length) {
      return { days, source: url };
    }
  }
  return null;
}

/**
 * 同步今年和明年的放假安排。
 * 不带 force 时 7 天内只跑一次；库里已经有该年数据就跳过（不重复抓、不覆盖）。
 */
async function syncHolidays(options) {
  const force = !!(options && options.force);
  const meta = await readHolidayMeta();
  const now = Date.now();
  if (!force && meta && meta.lastAttemptAt && now - meta.lastAttemptAt < HOLIDAY_SYNC_DAYS * 86400000) {
    return { ok: true, skipped: true, years: meta.syncedYears || [], meta };
  }
  const thisYear = new Date().getFullYear();
  const wanted = [thisYear, thisYear + 1];
  const synced = [];
  const errors = [];
  for (let index = 0; index < wanted.length; index += 1) {
    const year = wanted[index];
    const existing = await findHolidayYear(year);
    if (existing && Array.isArray(existing.days) && existing.days.length) {
      synced.push(year);
      continue;
    }
    const fetched = await fetchHolidayYear(year);
    if (!fetched) {
      errors.push(`${year} 抓不到`);
      continue;
    }
    await db.collection("holidays").add({
      data: {
        kind: "year",
        year,
        days: fetched.days,
        source: fetched.source,
        fetchedAt: now,
      },
    });
    synced.push(year);
  }
  const patch = {
    lastAttemptAt: now,
    syncedYears: synced,
    lastError: errors.join("；"),
  };
  if (synced.length) {
    patch.lastSuccessAt = now;
  }
  await saveHolidayMeta(patch);
  return { ok: true, skipped: false, years: synced, errors, meta: patch };
}

/** 前端取云端那份。读不到就返回空，前端继续用内置表。 */
async function getHolidays() {
  try {
    const res = await db.collection("holidays").where({ kind: "year" }).limit(20).get();
    const years = {};
    (res.data || []).forEach((doc) => {
      if (doc && doc.year && Array.isArray(doc.days) && doc.days.length) {
        years[String(doc.year)] = { days: doc.days, source: doc.source || "" };
      }
    });
    const meta = await readHolidayMeta();
    return {
      ok: true,
      years,
      meta: meta
        ? { lastAttemptAt: meta.lastAttemptAt || 0, lastSuccessAt: meta.lastSuccessAt || 0, lastError: meta.lastError || "" }
        : null,
    };
  } catch (error) {
    console.warn("读取节假日失败", error);
    return { ok: true, years: {}, meta: null };
  }
}

/** 分批删除，避免一次查太多。 */
async function removeWhere(collection, where, max = 1000) {
  let removed = 0;
  while (removed < max) {
    const found = await db.collection(collection).where(where).limit(100).get();
    if (!found.data.length) {
      break;
    }
    await Promise.all(found.data.map((item) => db.collection(collection).doc(item._id).remove().catch(() => {})));
    removed += found.data.length;
    if (found.data.length < 100) {
      break;
    }
  }
  return removed;
}

/** 清空自己的记录和留言。对象关系、昵称和经期设置保留。 */
async function clearMyData(openid) {
  await ensureUser(openid);
  await removeWhere("periods", { ownerOpenid: openid });
  await removeWhere("anniversaries", { creatorOpenid: openid });
  await removeWhere("birthdays", { creatorOpenid: openid });
  await removeWhere("schedules", { creatorOpenid: openid });
  await removeWhere("wishes", { creatorOpenid: openid });
  await removeWhere("decisions", { creatorOpenid: openid });
  await removeWhere("capsules", { creatorOpenid: openid });
  await removeWhere("timetables", { ownerOpenid: openid });
  await removeWhere("notes", { fromOpenid: openid });
  await removeWhere("readings", { openid });
  await removeWhere("asks", { openid });
  await removeWhere("memories", { openid });
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

function decodeBody(buffer, encoding) {
  const kind = String(encoding || "");
  if (kind.includes("gzip") || (buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b)) {
    return zlib.gunzipSync(buffer);
  }
  if (kind.includes("deflate")) {
    return zlib.inflateSync(buffer);
  }
  return buffer;
}

function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: Object.assign({ "Accept-Encoding": "identity" }, headers || {}),
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        if (res.statusCode === 401) {
          reject(new Error("天气认证失败，请核对私钥和编号"));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error("天气服务暂时不可用"));
          return;
        }
        try {
          const text = decodeBody(Buffer.concat(chunks), res.headers["content-encoding"]).toString("utf8");
          resolve(JSON.parse(text));
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

let weatherToken = { value: "", exp: 0 };

function qweatherConfig() {
  let secret = {};
  try {
    secret = require("./secret");
  } catch (error) {
    secret = {};
  }
  const host = String(process.env.QWEATHER_API_HOST || secret.QWEATHER_API_HOST || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  return {
    host,
    kid: process.env.QWEATHER_KID || secret.QWEATHER_KID || "",
    sub: process.env.QWEATHER_SUB || secret.QWEATHER_SUB || "",
    iss: process.env.QWEATHER_ISS || secret.QWEATHER_ISS || "",
    privateKey: process.env.QWEATHER_PRIVATE_KEY || secret.QWEATHER_PRIVATE_KEY || "",
  };
}

function base64url(value) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function signWeatherToken(config) {
  const now = Math.floor(Date.now() / 1000);
  if (weatherToken.value && weatherToken.exp - 60 > now) {
    return weatherToken.value;
  }
  const header = base64url(JSON.stringify({ alg: "EdDSA", kid: config.kid }));
  const iat = now - 30;
  const exp = iat + 3600;
  const payload = base64url(JSON.stringify({ iss: config.iss, sub: config.sub, iat, exp }));
  const unsigned = `${header}.${payload}`;
  const key = crypto.createPrivateKey(config.privateKey);
  const signature = crypto.sign(null, Buffer.from(unsigned), key);
  weatherToken = { value: `${unsigned}.${base64url(signature)}`, exp };
  return weatherToken.value;
}

function weatherKindFromIcon(icon) {
  const code = Number(icon);
  if (code === 302 || code === 303 || code === 304) return "storm";
  if (code === 100 || code === 150) return "sun";
  if (code >= 101 && code <= 104) return "cloud";
  if (code >= 400 && code <= 499) return "snow";
  if (code >= 500 && code <= 515) return "fog";
  if (code >= 300 && code <= 399) return "rain";
  return "cloud";
}

function clothing(temp) {
  if (temp >= 28) return "适合短袖";
  if (temp >= 22) return "可以穿薄外套";
  if (temp >= 15) return "建议穿外套";
  if (temp >= 8) return "建议穿厚外套";
  return "注意保暖";
}

async function qweatherGet(config, path, query) {
  const pairs = Object.keys(query).map((name) => `${name}=${encodeURIComponent(query[name])}`);
  const token = signWeatherToken(config);
  const data = await httpGet(`https://${config.host}${path}?${pairs.join("&")}`, {
    Authorization: `Bearer ${token}`,
  });
  if (!data || String(data.code) !== "200") {
    throw new Error("天气服务暂时不可用");
  }
  return data;
}

function scaleOf(value) {
  const nums = String(value || "").match(/\d+/g);
  if (!nums || !nums.length) return 0;
  return Math.max.apply(null, nums.map((item) => Number(item)));
}

function shanghaiHour(value) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const hour = parts.find((item) => item.type === "hour");
  return Number(hour && hour.value);
}

function hourWords(hour) {
  const name = ["十二", "一", "两", "三", "四", "五", "六", "七", "八", "九", "十", "十一"][hour % 12];
  if (hour === 0) return { short: "凌晨", around: "凌晨前后" };
  if (hour === 12) return { short: "中午", around: "中午前后" };
  if (hour < 5) return { short: `凌晨${name}点`, around: `凌晨${name}点前后` };
  if (hour < 11) return { short: `上午${name}点`, around: `上午${name}点前后` };
  if (hour < 18) return { short: `下午${name}点`, around: `下午${name}点前后` };
  return { short: `晚上${name}点`, around: `晚上${name}点前后` };
}

function isRainy(item) {
  return /雨|雪/.test(String(item.text || "")) || Number(item.precip) >= 0.1;
}

function buildOutlook(hourly, now) {
  const currentHour = shanghaiHour(Date.now());
  const nowScale = scaleOf(now.windScale);
  const nowTemp = Math.round(Number(now.temp));
  const nowRain = /雨|雪/.test(String(now.text || ""));
  const rows = (hourly || []).map((item) => ({
    hour: shanghaiHour(item.fxTime),
    time: new Date(item.fxTime).getTime(),
    temp: Math.round(Number(item.temp)),
    text: item.text || "",
    kind: weatherKindFromIcon(item.icon),
    scale: scaleOf(item.windScale),
    rainy: isRainy(item),
  })).filter((item) => Number.isFinite(item.temp) && Number.isFinite(item.hour) && item.time >= Date.now() - 60 * 60 * 1000);

  const today = [];
  rows.forEach((item) => {
    if (today.length >= 8) return;
    if (item.time > Date.now() + 16 * 60 * 60 * 1000) return;
    today.push(item);
  });

  let rain = null;
  let wind = null;
  let cool = null;
  let hot = null;
  today.forEach((item) => {
    if (item.time <= Date.now()) return;
    if (!rain && item.rainy && !nowRain) rain = item;
    if (!wind && item.scale >= nowScale + 2 && item.scale >= 4) wind = item;
    if (!cool && item.temp <= nowTemp - 4) cool = item;
    if (!hot && item.temp >= nowTemp + 4) hot = item;
  });

  const hints = [];
  if (rain && wind && Math.abs(rain.time - wind.time) <= 2 * 60 * 60 * 1000) {
    hints.push(`${hourWords(rain.hour).around}又下雨又起风，伞和外套都带上`);
  } else {
    if (rain) hints.push(`${hourWords(rain.hour).around}会落雨，出门把伞带上`);
    if (wind && hints.length < 2) hints.push(`${hourWords(wind.hour).around}风会大一档，围巾戴上`);
  }
  if (hints.length < 2 && cool) hints.push(`${hourWords(cool.hour).around}会凉下来，外套多备一件`);
  if (hints.length < 2 && hot && !cool) hints.push(`${hourWords(hot.hour).around}会热一些，记得喝水`);

  const hours = today.map((item) => ({
    label: item.hour === currentHour ? "现在" : hourWords(item.hour).short,
    hour: item.hour,
    temp: item.temp,
    kind: item.kind,
    mark: item.rainy || (item.scale >= nowScale + 2 && item.scale >= 4),
  }));
  return { hints: hints.slice(0, 2), hours };
}

function point(lng, lat) {
  return `${Number(lng).toFixed(2)},${Number(lat).toFixed(2)}`;
}

async function fetchSky(config, lng, lat) {
  const location = point(lng, lat);
  const [nowRes, dailyRes, hourRes] = await Promise.all([
    qweatherGet(config, "/v7/weather/now", { location }),
    qweatherGet(config, "/v7/weather/3d", { location }),
    qweatherGet(config, "/v7/weather/24h", { location }).catch(() => ({ hourly: [] })),
  ]);
  const now = nowRes.now || {};
  const daily = (dailyRes.daily && dailyRes.daily[0]) || {};
  const temp = Math.round(Number(now.temp));
  if (!Number.isFinite(temp)) {
    throw new Error("天气数据不完整");
  }
  const tempMax = Math.round(Number(daily.tempMax));
  const tempMin = Math.round(Number(daily.tempMin));
  const feelsLike = Math.round(Number(now.feelsLike));
  const humidity = Math.round(Number(now.humidity));
  const wind = Number(now.windSpeed);
  const text = String(now.text || "天气变化");
  const outlook = buildOutlook(hourRes.hourly, now);
  const windText = [now.windDir, now.windScale ? `${now.windScale}级` : ""].filter(Boolean).join(" ");
  return {
    temp,
    tempMax: Number.isFinite(tempMax) ? tempMax : temp,
    tempMin: Number.isFinite(tempMin) ? tempMin : temp,
    feelsLike: Number.isFinite(feelsLike) ? feelsLike : "",
    humidity: Number.isFinite(humidity) ? humidity : "",
    windText,
    text,
    kind: weatherKindFromIcon(now.icon),
    windy: Number.isFinite(wind) && wind >= 29,
    heavy: /大雨|暴雨/.test(text),
    hints: outlook.hints,
    hours: outlook.hours,
    sunrise: daily.sunrise || "",
    sunset: daily.sunset || "",
    moonPhase: daily.moonPhase || "",
    moonrise: daily.moonrise || "",
    moonset: daily.moonset || "",
  };
}

async function cityFromCoords(config, lng, lat) {
  try {
    const data = await qweatherGet(config, "/geo/v2/city/lookup", { location: point(lng, lat), number: "1" });
    const item = data.location && data.location[0];
    return (item && (item.name || item.adm2)) || "当前位置";
  } catch (error) {
    return "当前位置";
  }
}

async function locatePlace(config, place) {
  const parts = String(place || "").split(/\s+/).filter(Boolean);
  const raw = parts[parts.length - 1] || place;
  const name = raw.replace(/(特别行政区|自治区|省|市|区|县)$/, "") || raw;
  const adm = parts.length >= 2 ? parts[parts.length - 2].replace(/(市|省|自治区|特别行政区)$/, "") : "";
  const query = { location: name, number: "1" };
  if (adm) query.adm = adm;
  const data = await qweatherGet(config, "/geo/v2/city/lookup", query);
  const item = data.location && data.location[0];
  if (!item) {
    throw new Error("没有找到这个城市");
  }
  return {
    lat: Number(item.lat),
    lng: Number(item.lon),
    place: item.name || name,
  };
}

/** 小程序不直接访问外网。坐标只用来查天气，不写入数据库。先拿气温，城市名失败不影响气温。 */
async function weather(event) {
  const config = qweatherConfig();
  if (!config.host || !config.kid || !config.sub || !config.iss) {
    throw new Error("还没有配置天气编号");
  }
  if (!String(config.privateKey || "").includes("BEGIN PRIVATE KEY")) {
    throw new Error("还没有填写天气私钥");
  }
  let lat = Number(event.latitude);
  let lng = Number(event.longitude);
  let place = String(event.place || "").trim();
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    if (!place) {
      throw new Error("没有拿到位置");
    }
    const found = await locatePlace(config, place);
    lat = found.lat;
    lng = found.lng;
    place = found.place;
    const sky = await fetchSky(config, lng, lat);
    return { ok: true, ...sky, place, clothing: clothing(sky.temp) };
  }
  const [sky, city] = await Promise.all([
    fetchSky(config, lng, lat),
    cityFromCoords(config, lng, lat),
  ]);
  return { ok: true, ...sky, place: city || "当前位置", clothing: clothing(sky.temp) };
}

async function mutualPair(openid) {
  const user = await ensureUser(openid);
  const partner = user.chosenOpenid ? await findUser(user.chosenOpenid) : null;
  if (!isMutual(user, partner)) {
    return null;
  }
  return { user, partner };
}

async function partnerNote(openid) {
  const pair = await mutualPair(openid);
  if (!pair) {
    return { ok: true, visible: false, text: "", fromName: "" };
  }
  const found = await db.collection("notes").where({
    toOpenid: openid,
    fromOpenid: pair.partner.openid,
  }).limit(1).get();
  const note = found.data[0];
  return {
    ok: true,
    visible: true,
    text: note && note.text ? note.text : "",
    fromName: pair.partner.nickName || "TA",
  };
}

/**
 * 订阅消息模板。7 个场景各自独立，一个模板只讲一件事。
 *
 * 模板 ID 与关键词有两种来源，环境变量优先：
 * 1) 自动（推荐）：给云函数配环境变量 WX_APPSECRET（和 WX_APPID），云函数自己去
 *    微信拉「我的模板」，连同关键词真实的 key（thing1 / time6 / thing9 …）一起拿到，
 *    不用手抄，后台换了模板也能自己跟上。
 * 2) 手动：SUBSCRIBE_TEMPLATES={"schedule":{"id":"模板ID","fields":["thing1","time6"]}}
 *    fields 必须和模板里关键词的顺序一致；微信要求模板里每个关键词都传值，少一个就是 47003。
 *
 * 下面 TEMPLATES 里的 fields 只是手动配置时的兜底，自动模式下会被真实值覆盖。
 */
const TEMPLATES = [
  { key: "schedule", name: "日程提醒", fields: ["thing1", "thing2", "date3", "thing4"] },
  { key: "note", name: "留言提醒", fields: ["thing1", "thing2", "time3"] },
  { key: "period", name: "经期提醒", fields: ["date1", "number2", "thing3", "date4"] },
  { key: "birthday", name: "生日提醒", fields: ["thing1", "date2", "number3", "thing4"] },
  { key: "anniversary", name: "纪念日提醒", fields: ["thing1", "date2", "number3"] },
  { key: "decision", name: "决定结果", fields: ["thing1", "thing2", "time3"] },
  { key: "capsule", name: "胶囊到期", fields: ["thing1", "number2", "date3", "thing4"] },
];

/** 每个场景能提供的值。slot 名要和 tick 里传的对象键一致。 */
const DEFAULT_SLOTS = {
  schedule: ["who", "title", "date", "note"],
  note: ["from", "text", "clock"],
  period: ["date", "countdown", "tip", "last"],
  birthday: ["name", "date", "countdown", "tip"],
  anniversary: ["name", "date", "days"],
  decision: ["title", "result", "clock"],
  capsule: ["title", "days", "buried", "openAt", "tag"],
};

/**
 * 模板里关键词的**名字** → 我们哪个值。
 * 名字就是详情页上「胶囊标题 / 埋藏天数 / 胶囊埋下日期」这些字，按关键词名对号入座，
 * 所以同一个场景换个模板、关键词顺序变了也能自动对上。
 */
const SLOT_RULES = {
  schedule: [
    [/提醒人|发起人|创建人|谁/, "who"],
    [/事项|标题|主题|内容|日程/, "title"],
    [/日期|时间|哪天/, "date"],
    [/地点|地址|备注|说明/, "note"],
  ],
  note: [
    [/用户|留言人|发送人|谁/, "from"],
    [/内容|留言|文字/, "text"],
    [/时间/, "clock"],
  ],
  period: [
    [/上次|上月|最近|周期/, "last"],
    [/倒计时|天数|还剩/, "countdown"],
    [/日期|预计|哪天/, "date"],
    [/提示|提醒|温馨|建议|关心/, "tip"],
  ],
  birthday: [
    [/姓名|名字|寿星|是谁/, "name"],
    [/倒计时|天数|还剩/, "countdown"],
    [/日期|哪天/, "date"],
    [/提醒|温馨|祝福|建议/, "tip"],
  ],
  anniversary: [
    [/天数|相伴|多少/, "days"],
    [/名称|标题|纪念/, "name"],
    [/日期|哪天/, "date"],
  ],
  decision: [
    [/主题|标题|事项|决定/, "title"],
    [/结果|选项|答案|定下/, "result"],
    [/时间/, "clock"],
  ],
  capsule: [
    [/天数|倒计时|多久/, "days"],
    [/埋下|埋藏|创建|封存/, "buried"],
    [/开启|到期|打开/, "openAt"],
    [/关键词|标签|分类/, "tag"],
    [/标题|名称|内容/, "title"],
  ],
};

/** 按模板标题认出这是哪个场景。 */
const TITLE_RULES = [
  { key: "period", test: /经期|月经|生理期|排卵/ },
  { key: "birthday", test: /生日|寿辰/ },
  { key: "capsule", test: /胶囊/ },
  { key: "note", test: /留言|悄悄话|寄语/ },
  { key: "anniversary", test: /纪念/ },
  { key: "decision", test: /决定|投票|结果|选择/ },
  { key: "schedule", test: /日程|事项|待办|安排/ },
];

const SAMPLE_VALUES = {
  schedule: { who: "我", title: "一起看电影", date: "2026-11-28", note: "万达影城" },
  note: { from: "嘟嘟", text: "今天也要好好照顾自己", clock: "20:15" },
  period: { date: "2026-12-02", countdown: 2, tip: "多喝热水", last: "2026-10-05" },
  birthday: { name: "嘟嘟", date: "2026-12-08", countdown: 3, tip: "记得说生日快乐" },
  anniversary: { name: "在一起", date: "2026-12-20", days: 2145 },
  decision: { title: "周末吃什么", result: "火锅", clock: "21:30" },
  capsule: { title: "给一年后的我们", days: 365, buried: "2026-11-25", openAt: "2027-11-25", tag: "时光胶囊" },
};

const SEND_ERRORS = {
  40003: "openid 不对",
  40037: "模板 ID 不对，去后台核对",
  43101: "用户没有额度或已拒收",
  47003: "关键词和字段对不上，检查模板的关键词",
};

function describeSendError(code) {
  return SEND_ERRORS[code] || `发送失败（${code || "未知错误"}）`;
}

let duplicateWarned = false;

function templateIds() {
  let parsed = {};
  try {
    parsed = JSON.parse(process.env.SUBSCRIBE_TEMPLATES || "{}");
  } catch (error) {
    console.error("SUBSCRIBE_TEMPLATES 不是合法 JSON");
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  if (!duplicateWarned) {
    const seen = new Map();
    Object.keys(parsed).forEach((key) => {
      const entry = parsed[key];
      const id = typeof entry === "string" ? entry : (entry && entry.id) || "";
      if (!id) {
        return;
      }
      if (seen.has(id)) {
        console.warn(`SUBSCRIBE_TEMPLATES 里 ${seen.get(id)} 和 ${key} 用了同一个模板 ID，确认是共用一个公共模板`);
      } else {
        seen.set(id, key);
      }
    });
    duplicateWarned = true;
  }
  return parsed;
}

function templateMeta(key) {
  return TEMPLATES.find((item) => item.key === key) || null;
}

/** 把模板详情里的 content（"胶囊标题{{thing1.DATA}}"）拆成关键词名和 key。 */
function parseKeywords(content) {
  const text = String(content || "");
  const list = [];
  const re = /([^{}]*?)\{\{\s*([A-Za-z_]+?\d+)\.DATA\s*\}\}/g;
  let matched = re.exec(text);
  while (matched) {
    const key = matched[2];
    list.push({
      name: matched[1].replace(/\s+/g, " ").trim(),
      key,
      type: key.replace(/\d+$/, ""),
    });
    matched = re.exec(text);
  }
  return list;
}

function wechatGet(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "Accept-Encoding": "identity" } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(decodeBody(Buffer.concat(chunks), res.headers["content-encoding"]).toString("utf8")));
        } catch (error) {
          reject(new Error("微信接口返回无法解析"));
        }
      });
    });
    request.setTimeout(8000, () => {
      request.destroy();
      reject(new Error("微信接口超时"));
    });
    request.on("error", () => reject(new Error("微信接口访问失败")));
  });
}

let wechatToken = { value: "", exp: 0 };

async function wechatAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (wechatToken.value && wechatToken.exp - 120 > now) {
    return wechatToken.value;
  }
  const appid = process.env.WX_APPID || "wxfcac6e57d7a2a03e";
  const secret = process.env.WX_APPSECRET || "";
  if (!secret) {
    throw new Error("没配 WX_APPSECRET，取不到模板列表");
  }
  const data = await wechatGet(
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`
  );
  if (!data.access_token) {
    throw new Error(`取 access_token 失败：${data.errcode || ""} ${data.errmsg || ""}`.trim());
  }
  wechatToken = { value: data.access_token, exp: now + Number(data.expires_in || 7200) };
  return wechatToken.value;
}

/** 拉「我的模板」。十分钟缓存，避免每次下发都打微信接口。失败一分钟内不重试。 */
let discovered = { at: 0, map: {}, list: [], error: "", failedAt: 0 };
let templateWarn = "";

async function discoverTemplates(force) {
  const now = Date.now();
  if (!force && discovered.at && now - discovered.at < 10 * 60 * 1000) {
    return discovered;
  }
  if (!force && discovered.failedAt && now - discovered.failedAt < 60 * 1000) {
    return discovered;
  }
  try {
    const token = await wechatAccessToken();
    const data = await wechatGet(`https://api.weixin.qq.com/wxaapi/newtmpl/gettemplate?access_token=${token}`);
    if (data.errcode) {
      throw new Error(`gettemplate 返回 ${data.errcode} ${data.errmsg || ""}`.trim());
    }
    const list = (data.data || []).map((item) => ({
      id: item.priTmplId,
      title: item.title || "",
      keywords: parseKeywords(item.content),
    }));
    const map = {};
    list.forEach((item) => {
      const rule = TITLE_RULES.find((entry) => entry.test.test(item.title));
      if (rule && !map[rule.key]) {
        map[rule.key] = item;
      }
    });
    discovered = { at: now, map, list, error: "", failedAt: 0 };
  } catch (error) {
    // 记下原因，配错 AppSecret、开过 IP 白名单都会走到这里
    discovered = { at: 0, map: {}, list: [], error: error.message, failedAt: now };
    if (templateWarn !== error.message) {
      console.warn("自动取订阅模板失败：", error.message);
      templateWarn = error.message;
    }
  }
  return discovered;
}

/** 关键词名字对上号：第 i 个关键词用哪个值。 */
function slotsFor(key, keywords) {
  const rules = SLOT_RULES[key] || [];
  const fallback = DEFAULT_SLOTS[key] || [];
  const used = new Set();
  return keywords.map((keyword) => {
    const hit = rules.find((rule) => !used.has(rule[1]) && rule[0].test(keyword.name));
    if (hit) {
      used.add(hit[1]);
      return hit[1];
    }
    const spare = fallback.find((slot) => !used.has(slot));
    if (spare) {
      used.add(spare);
      return spare;
    }
    return "";
  });
}

function manualConfig(meta, entry) {
  const id = typeof entry === "string" ? entry : (entry && entry.id) || "";
  if (!id) {
    return null;
  }
  const fields =
    entry && Array.isArray(entry.fields) && entry.fields.length ? entry.fields.map(String) : (meta.fields || []).slice();
  const keywords = fields.map((field) => ({ name: "", key: field, type: field.replace(/\d+$/, "") }));
  const slots =
    entry && Array.isArray(entry.values) && entry.values.length
      ? entry.values.map(String)
      : (DEFAULT_SLOTS[meta.key] || []).slice(0, keywords.length);
  return { id: String(id), title: meta.name, keywords, slots, source: "env" };
}

/** 环境变量优先，缺的场景去微信后台找。任何一边都没有就留空，不会乱发。 */
let resolvedConfig = {};

async function ensureTemplates() {
  const explicit = templateIds();
  const missing = TEMPLATES.some((meta) => !explicit[meta.key]);
  if (missing) {
    await discoverTemplates(false);
  }
  const merged = {};
  TEMPLATES.forEach((meta) => {
    const entry = explicit[meta.key];
    if (entry) {
      const config = manualConfig(meta, entry);
      if (config) {
        merged[meta.key] = config;
      }
      return;
    }
    const found = discovered.map[meta.key];
    if (found && found.keywords.length) {
      merged[meta.key] = {
        id: found.id,
        title: found.title,
        keywords: found.keywords,
        slots: slotsFor(meta.key, found.keywords),
        source: "wechat",
      };
    }
  });
  resolvedConfig = merged;
  return merged;
}

function templateConfig(key) {
  return resolvedConfig[key] || null;
}

/** 没有记录也算开着，用户没关过就默认接收。 */
async function listSubscriptions(openid) {
  const res = await db.collection("subscriptions").where({ openid }).limit(20).get();
  const byKey = new Map();
  res.data.forEach((item) => byKey.set(item.templateKey, item));
  return TEMPLATES.map((meta) => {
    const row = byKey.get(meta.key);
    const config = templateConfig(meta.key);
    return {
      key: meta.key,
      name: meta.name,
      enabled: !row || row.enabled !== false,
      remain: row && row.remain > 0 ? row.remain : 0,
      templateId: (config && config.id) || "",
    };
  });
}

async function findSubscription(openid, templateKey) {
  const res = await db.collection("subscriptions").where({ openid, templateKey }).limit(1).get();
  return res.data[0] || null;
}

async function saveSubscription(openid, templateKey, patch) {
  const current = await findSubscription(openid, templateKey);
  const now = Date.now();
  if (current) {
    const data = { ...patch, updatedAt: now };
    await db.collection("subscriptions").doc(current._id).update({ data });
    return { ...current, ...data };
  }
  const data = { openid, templateKey, remain: 0, enabled: true, ...patch, createdAt: now, updatedAt: now };
  const added = await db.collection("subscriptions").add({ data });
  return { _id: added._id, ...data };
}

async function getSubscriptions(openid) {
  await ensureUser(openid);
  await ensureTemplates();
  return { ok: true, templates: await listSubscriptions(openid) };
}

async function setSubscribeEnabled(openid, event) {
  const meta = templateMeta(String(event.key || ""));
  if (!meta) {
    throw new Error("未知提醒类型");
  }
  await saveSubscription(openid, meta.key, { enabled: event.enabled !== false });
  return getSubscriptions(openid);
}

/** 前端拿到 accept 后回报，每接受一次加一条额度。 */
async function grantSubscribe(openid, keys) {
  const list = Array.isArray(keys) ? Array.from(new Set(keys)) : [];
  for (const key of list) {
    const meta = templateMeta(String(key));
    if (!meta) {
      continue;
    }
    const row = await findSubscription(openid, meta.key);
    await saveSubscription(openid, meta.key, { remain: ((row && row.remain) || 0) + 1 });
  }
  return getSubscriptions(openid);
}

/** 一次下发：开关 + 额度都满足才发，扣一条，两人互不影响。 */
async function pushTo(openids, key, values) {
  await ensureTemplates();
  const config = templateConfig(key);
  if (!config || !config.id) {
    return { sent: 0, reason: "模板还没配置" };
  }
  const targets = Array.from(new Set((openids || []).filter(Boolean)));
  const data = buildPushData(key, values);
  const results = [];
  for (const openid of targets) {
    results.push(await pushOne(openid, key, config.id, data));
  }
  return { sent: results.filter((item) => item.ok).length, results };
}

/** 按 types 和关键词名把值填进去。微信要求模板里每个关键词都有值，所以都给兜底。 */
function formatValue(type, raw) {
  const text = raw === undefined || raw === null ? "" : String(raw);
  if (type === "number") {
    const digits = text.replace(/[^\d-]/g, "");
    return digits || "0";
  }
  if (type === "date") {
    return chineseDate(text) || todayShanghai();
  }
  if (type === "time") {
    if (/^\d{2}:\d{2}$/.test(text)) {
      return text;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return chineseDate(text);
    }
    return text || clockNow();
  }
  if (type === "character_string") {
    return text.replace(/[^\w:-]/g, "") || "-";
  }
  if (type === "phrase") {
    return text || "提醒";
  }
  return (text || "—").slice(0, 20);
}

function chineseDate(text) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ""));
  if (!matched) {
    return "";
  }
  return `${Number(matched[1])}年${Number(matched[2])}月${Number(matched[3])}日`;
}

function clockNow() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function buildPushData(key, values) {
  const config = templateConfig(key);
  if (!config) {
    return {};
  }
  const data = {};
  config.keywords.forEach((keyword, index) => {
    const slot = config.slots[index];
    data[keyword.key] = { value: formatValue(keyword.type, slot ? values[slot] : "") };
  });
  return data;
}

async function pushOne(openid, key, templateId, data) {
  const row = await findSubscription(openid, key);
  if (row && row.enabled === false) {
    return { ok: false, reason: "已关闭" };
  }
  if (!row || !(row.remain > 0)) {
    return { ok: false, reason: "没有额度" };
  }
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId,
      page: "pages/main/index",
      miniprogramState: process.env.SUBSCRIBE_STATE || "trial",
      lang: "zh_CN",
      data,
    });
  } catch (error) {
    const code = Number((error && (error.errCode || error.code)) || 0);
    if (code === 43101) {
      // 用户拒收或已无额度，清零避免一直重试
      await saveSubscription(openid, key, { remain: 0 });
      return { ok: false, reason: "用户未订阅" };
    }
    console.error("订阅消息发送失败", key, code, describeSendError(code), error);
    return { ok: false, reason: describeSendError(code) };
  }
  await saveSubscription(openid, key, { remain: Math.max(0, (row.remain || 0) - 1) });
  return { ok: true };
}

function shanghaiClock() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date())
    .replace(",", "");
}

/** 在自己手机上试发一条，用来核对模板 ID 和关键词对不对得上。 */
async function testPush(openid, event) {
  const key = String(event.key || "");
  const meta = templateMeta(key);
  if (!meta) {
    throw new Error("未知提醒类型");
  }
  await ensureTemplates();
  let config = templateConfig(key);
  if (!config) {
    // 可能是刚补上 AppSecret，强制重拉一次再判断
    await discoverTemplates(true);
    await ensureTemplates();
    config = templateConfig(key);
  }
  if (!config || !config.id) {
    const reason = discovered.error ? `（自动取模板失败：${discovered.error}）` : "";
    throw new Error(`没找到「${meta.name}」这个模板${reason}`);
  }
  const row = await findSubscription(openid, key);
  if (!row || !(row.remain > 0)) {
    throw new Error("先在这一项点「+1」攒一条额度再来试");
  }
  const values = event.values && typeof event.values === "object" ? event.values : SAMPLE_VALUES[key] || {};
  const data = buildPushData(key, values);
  const detail = {
    title: config.title,
    keywords: config.keywords.map((item, index) => `${item.name || "?"}=${item.key}→${config.slots[index] || "空"}`),
    data,
  };
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId: config.id,
      page: "pages/main/index",
      miniprogramState: process.env.SUBSCRIBE_STATE || "trial",
      lang: "zh_CN",
      data,
    });
  } catch (error) {
    const code = Number((error && (error.errCode || error.code)) || 0);
    return { ok: false, code, message: describeSendError(code), ...detail };
  }
  await saveSubscription(openid, key, { remain: Math.max(0, (row.remain || 0) - 1) });
  return { ok: true, name: meta.name, ...detail };
}

async function sendNote(openid, text) {
  const pair = await mutualPair(openid);
  if (!pair) {
    throw new Error("双方确认对象后才能留话");
  }
  const clean = String(text || "").trim().slice(0, 80);
  if (!clean) {
    throw new Error("先写一句");
  }
  const existing = await db.collection("notes").where({
    fromOpenid: openid,
    toOpenid: pair.partner.openid,
  }).limit(1).get();
  if (existing.data[0]) {
    await db.collection("notes").doc(existing.data[0]._id).update({
      data: { text: clean, updatedAt: Date.now() },
    });
  } else {
    await db.collection("notes").add({
      data: {
        fromOpenid: openid,
        toOpenid: pair.partner.openid,
        text: clean,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
  }
  const clock = shanghaiClock().slice(-5);
  await pushTo([pair.partner.openid], "note", { from: pair.user.nickName || "TA", text: clean, clock });
  return { ok: true };
}

function todayShanghai() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function allDocs(collection) {
  return db
    .collection(collection)
    .limit(100)
    .get()
    .then((res) => res.data || []);
}

/** 今年的这个日子，已经过了就取明年。 */
function nextOccurrence(today, month, day) {
  const year = Number(today.slice(0, 4));
  const thisYear = dateOn(year, month, day);
  return thisYear >= today ? thisYear : dateOn(year + 1, month, day);
}

/** 创建者自己；双方可见时再算上确认过关系的对象。 */
async function remindTargets(creatorOpenid, visibility) {
  const creator = await findUser(creatorOpenid);
  if (!creator) {
    return [];
  }
  const list = [creator.openid];
  if (visibility !== "self" && creator.chosenOpenid) {
    const partner = await findUser(creator.chosenOpenid);
    if (isMutual(creator, partner)) {
      list.push(partner.openid);
    }
  }
  return list;
}

async function nickOf(openid) {
  const user = openid ? await findUser(openid) : null;
  return (user && user.nickName) || "TA";
}

/** 毫秒时间戳换成东八区日期，给「埋下日期」这类字段用。 */
function msDate(ms) {
  if (!ms) {
    return todayShanghai();
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

async function tickSchedules(today, hour, stat) {
  const docs = await allDocs("schedules");
  for (const doc of docs) {
    const remind = readRemind(doc.remind);
    if (!remind.enabled || remind.hour !== hour) {
      continue;
    }
    const due = addDays(doc.date, -remind.leadDays);
    if (due !== today || doc.remindSentFor === due) {
      continue;
    }
    const targets = await remindTargets(doc.creatorOpenid, doc.visibility);
    const who = await nickOf(doc.creatorOpenid);
    const pushed = await pushTo(targets, "schedule", { who, title: doc.title, date: doc.date, note: doc.note || "无" });
    await db.collection("schedules").doc(doc._id).update({ data: { remindSentFor: due } });
    stat.sent += pushed.sent;
  }
}

async function tickBirthdays(today, hour, stat) {
  const docs = await allDocs("birthdays");
  for (const doc of docs) {
    const remind = readRemind(doc.remind);
    if (!remind.enabled || remind.hour !== hour) {
      continue;
    }
    // 农历生日要在服务端查农历表，先不推
    if (doc.calendar === "lunar") {
      continue;
    }
    const occurrence = nextOccurrence(today, doc.month, doc.day);
    const due = addDays(occurrence, -remind.leadDays);
    const mark = `${today.slice(0, 4)}-${due}`;
    if (due !== today || doc.remindSentFor === mark) {
      continue;
    }
    const targets = await remindTargets(doc.creatorOpenid, doc.visibility);
    const countdown = diffDays(today, occurrence);
    const pushed = await pushTo(targets, "birthday", {
      name: doc.title,
      date: occurrence,
      countdown,
      tip: "记得说生日快乐",
    });
    await db.collection("birthdays").doc(doc._id).update({ data: { remindSentFor: mark } });
    stat.sent += pushed.sent;
  }
}

async function tickAnniversaries(today, hour, stat) {
  const docs = await allDocs("anniversaries");
  for (const doc of docs) {
    const remind = readRemind(doc.remind);
    if (!remind.enabled || remind.hour !== hour) {
      continue;
    }
    const occurrence =
      doc.yearly !== false ? nextOccurrence(today, doc.month, doc.day) : dateOn(doc.year || Number(today.slice(0, 4)), doc.month, doc.day);
    const due = addDays(occurrence, -remind.leadDays);
    if (due !== today || doc.remindSentFor === due) {
      continue;
    }
    const days = doc.year ? diffDays(dateOn(doc.year, doc.month, doc.day), occurrence) : 0;
    const targets = await remindTargets(doc.creatorOpenid, doc.visibility);
    const pushed = await pushTo(targets, "anniversary", { name: doc.title, date: occurrence, days });
    await db.collection("anniversaries").doc(doc._id).update({ data: { remindSentFor: due } });
    stat.sent += pushed.sent;
  }
}

async function tickCapsules(today, hour, stat) {
  const docs = await allDocs("capsules");
  for (const doc of docs) {
    const remind = readRemind(doc.remind);
    if (!remind.enabled || remind.hour !== hour) {
      continue;
    }
    const due = addDays(doc.openAt, -remind.leadDays);
    if (due !== today || doc.remindSentFor === due) {
      continue;
    }
    const targets = await remindTargets(doc.creatorOpenid, doc.visibility);
    const buried = msDate(doc.createdAt);
    const buriedDays = doc.createdAt ? diffDays(buried, today) : 0;
    const pushed = await pushTo(targets, "capsule", {
      title: doc.title,
      days: buriedDays,
      buried,
      openAt: doc.openAt,
      tag: "时光胶囊",
    });
    await db.collection("capsules").doc(doc._id).update({ data: { remindSentFor: due } });
    stat.sent += pushed.sent;
  }
}

/** 经期提醒：女推自己，男推对象那本记录，只推给开了开关的那个人。 */
async function tickPeriods(today, hour, stat) {
  const docs = await allDocs("users");
  const byOpenid = new Map();
  docs.forEach((item) => {
    if (!item.openid) {
      return;
    }
    const current = byOpenid.get(item.openid);
    byOpenid.set(item.openid, current ? pickUser([current, item]) : item);
  });
  for (const user of byOpenid.values()) {
    const remind = readRemind(user.periodRemind);
    if (!remind.enabled || remind.hour !== hour) {
      continue;
    }
    let owner = null;
    if (user.gender === "female") {
      owner = user;
    } else if (user.chosenOpenid) {
      const partner = byOpenid.get(user.chosenOpenid);
      if (partner && partner.gender === "female" && isMutual(user, partner)) {
        owner = partner;
      }
    }
    if (!owner) {
      continue;
    }
    const periods = await listByOwner("periods", owner.openid);
    const starts = periods.map((item) => item.startDate).filter(Boolean).sort();
    if (!starts.length) {
      continue;
    }
    const predicted = addDays(starts[starts.length - 1], clampNumber(owner.cycleLength, 15, 60, 28));
    const due = addDays(predicted, -remind.leadDays);
    if (due !== today || user.periodRemindSentFor === predicted) {
      continue;
    }
    const countdown = diffDays(today, predicted);
    const pushed = await pushTo([user.openid], "period", {
      date: predicted,
      countdown,
      tip: "多喝热水，别着凉",
      last: starts[starts.length - 1],
    });
    await db.collection("users").doc(user._id).update({ data: { periodRemindSentFor: predicted } });
    stat.sent += pushed.sent;
  }
}

/** 定时触发器每小时跑一次，按东八区整点判定。 */
async function remindTick() {
  await ensureTemplates();
  const today = todayShanghai();
  const hour = shanghaiHour(Date.now());
  const stat = { today, hour, sent: 0 };
  await tickSchedules(today, hour, stat);
  await tickBirthdays(today, hour, stat);
  await tickAnniversaries(today, hour, stat);
  await tickCapsules(today, hour, stat);
  await tickPeriods(today, hour, stat);
  console.log("定时提醒", stat);
  return { ok: true, ...stat };
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
  const found = await db.collection("readings").where({
    openid,
    date,
    promptVersion: PROMPT_VERSION,
  }).limit(100).get();
  const latest = found.data.slice().sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))[0];
  if (latest && Date.now() - (latest.createdAt || 0) < 60 * 60 * 1000) {
    return {
      ok: true,
      score: latest.score,
      lines: latest.lines,
      brief: latest.brief || "",
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
  await (latest
    ? db.collection("readings").doc(latest._id).update({
        data: {
          weatherSource,
          score: parsed.score,
          lines: parsed.lines,
          brief: parsed.brief,
          createdAt: Date.now(),
        },
      })
    : db.collection("readings").add({
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
      }));
  return { ok: true, score: parsed.score, lines: parsed.lines, brief: parsed.brief, date };
}

async function listAsks(openid, event) {
  const before = Number(event && event.before) || 0;
  const _ = db.command;
  const where = before ? { openid, createdAt: _.lt(before) } : { openid };
  const all = [];
  let skip = 0;
  while (skip < 2000) {
    const found = await db.collection("asks").where(where).skip(skip).limit(100).get();
    all.push(...found.data);
    if (found.data.length < 100) {
      break;
    }
    skip += found.data.length;
  }
  all.sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
  const picked = [];
  let size = 0;
  for (let index = 0; index < all.length; index += 1) {
    const item = all[index];
    const weight = String(item.question || "").length + String(item.answer || "").length;
    if (picked.length && size + weight > 6000) {
      break;
    }
    picked.push(item);
    size += weight;
  }
  picked.sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));
  return {
    ok: true,
    hasMore: picked.length < all.length,
    items: picked.map((item) => ({
      id: item._id,
      date: item.date || "",
      createdAt: item.createdAt || 0,
      question: item.question,
      answer: item.answer,
    })),
  };
}

async function deleteAsks(openid, ids) {
  const list = Array.isArray(ids) ? ids.filter(Boolean).slice(0, 50) : [];
  await Promise.all(list.map(async (id) => {
    try {
      const current = await db.collection("asks").doc(id).get();
      if (current.data && current.data.openid === openid) {
        await db.collection("asks").doc(id).remove();
      }
    } catch (error) {
      console.error("删除聊天记录失败", id, error);
    }
  }));
  return { ok: true };
}

async function readMemory(openid) {
  const found = await db.collection("memories").where({ openid }).limit(1).get();
  return found.data[0] || null;
}

async function writeMemory(openid, text) {
  const clean = String(text || "").trim().slice(0, 400);
  const existing = await readMemory(openid);
  if (!clean) {
    if (existing) {
      await db.collection("memories").doc(existing._id).remove();
    }
    return "";
  }
  if (existing) {
    await db.collection("memories").doc(existing._id).update({
      data: { text: clean, updatedAt: Date.now() },
    });
  } else {
    await db.collection("memories").add({
      data: { openid, text: clean, createdAt: Date.now(), updatedAt: Date.now() },
    });
  }
  return clean;
}

async function getMemory(openid) {
  const existing = await readMemory(openid);
  return { ok: true, text: existing ? existing.text || "" : "" };
}

async function saveMemory(openid, text) {
  const saved = await writeMemory(openid, text);
  return { ok: true, text: saved };
}

function wantsRemember(text) {
  return /记住|记一下|帮我记住|别忘了/.test(text);
}

async function rewriteMemory(openid, sentence) {
  const key = deepSeekKey();
  if (!key) {
    return;
  }
  const existing = await readMemory(openid);
  const result = await postJson(
    "https://api.deepseek.com/chat/completions",
    { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    {
      model: "deepseek-chat",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "你负责维护一段个人记忆。把新事实补进已有记忆。同一件事以新的为准，删掉被替代的旧说法。只输出记忆正文，不超过400字，不要解释。",
        },
        {
          role: "user",
          content: `已有记忆：\n${existing && existing.text ? existing.text : "无"}\n\n新的要求：\n${sentence}`,
        },
      ],
    }
  );
  const text = result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content;
  await writeMemory(openid, text);
}

const AI_TOOLS = [
  {
    type: "function",
    function: {
      name: "query_upcoming",
      description: "查询未来若干天内的日程、纪念日和阳历生日。用户问最近、这周或这个月有什么安排时使用。",
      parameters: {
        type: "object",
        properties: {
          days: { type: "integer", description: "往后多少天，1 到 60" },
        },
        required: ["days"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_schedule",
      description: "用户明确说要记一件带日期的事时使用。只提出建议，由用户点确认后再保存。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "要做什么，20 字内" },
          date: { type: "string", description: "日期，格式 YYYY-MM-DD" },
          note: { type: "string", description: "可选备注" },
        },
        required: ["title", "date"],
      },
    },
  },
];

function readScheduleProposal(args) {
  const title = String((args && args.title) || "").trim().slice(0, 30);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String((args && args.date) || "")) ? args.date : "";
  if (!title || !date) {
    return null;
  }
  return { title, date, note: String((args && args.note) || "").trim().slice(0, 60) };
}

/** 某年某月某日的日期字符串。2 月 29 日落到 2 月 28 日。 */
function dateOn(year, month, day) {
  const last = new Date(year, month, 0).getDate();
  const pad = (value) => String(value).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(Math.min(day, last))}`;
}

/** 未来 days 天内的日程、纪念日和阳历生日。农历生日不在内。 */
async function upcomingFor(openid, days) {
  const user = await ensureUser(openid);
  const partner = user.chosenOpenid ? await findUser(user.chosenOpenid) : null;
  const mutual = isMutual(user, partner);
  const today = todayShanghai();
  const end = addDays(today, days);
  const year = Number(today.slice(0, 4));
  const items = [];
  (await visibleItems("schedules", openid, partner, mutual)).forEach((item) => {
    if (item.date >= today && item.date <= end) {
      items.push({ kind: "日程", date: item.date, title: item.title, note: item.note || "" });
    }
  });
  (await visibleItems("anniversaries", openid, partner, mutual)).forEach((item) => {
    [year, year + 1].forEach((mark) => {
      const day = dateOn(mark, item.month, item.day);
      if (day >= today && day <= end) {
        items.push({ kind: "纪念日", date: day, title: item.title });
      }
    });
  });
  (await visibleItems("birthdays", openid, partner, mutual)).forEach((item) => {
    if (item.calendar === "lunar") {
      return;
    }
    [year, year + 1].forEach((mark) => {
      const day = dateOn(mark, item.month, item.day);
      if (day >= today && day <= end) {
        items.push({ kind: "生日", date: day, title: item.title });
      }
    });
  });
  items.sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0));
  return items.slice(0, 30);
}

function upcomingText(items) {
  if (!items.length) {
    return "接下来这段时间还没有安排。";
  }
  return items.map((item) => `${item.date} ${item.kind}：${item.title}`).join("\n");
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
  // 体验版先不限制每天提问次数。
  // const count = await db.collection("asks").where({ openid, date }).count();
  // if (count.total >= 10) {
  //   throw new Error("今天的提问已经用完了");
  // }
  if (wantsRemember(text)) {
    try {
      await rewriteMemory(openid, text);
    } catch (error) {
      console.error("更新记忆失败", error);
    }
  }
  const memory = await readMemory(openid);
  const reading = await db.collection("readings")
    .where({ openid, date, promptVersion: PROMPT_VERSION })
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();
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
  const messages = [
    {
      role: "system",
      content: "你是炎都拾光里的生活助手。综合五行、星座、八字和紫微斗数，用几句温和的中文回答。不要写成医疗建议。不要写出出生年月日、时辰或出生地。用户问最近的安排时调用 query_upcoming；用户明确说要记一件带日期的事时调用 create_schedule，只提出建议，由用户点确认后再保存，不要说已经记好了。",
    },
    { role: "user", content: `需要记住的信息：\n${memory && memory.text ? memory.text : "无"}\n\n今天的建议是：\n${lines}` },
  ].concat(history, [{ role: "user", content: text }]);

  const url = "https://api.deepseek.com/chat/completions";
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const first = await postJson(url, headers, {
    model: "deepseek-chat",
    temperature: 0.7,
    messages,
    tools: AI_TOOLS,
    tool_choice: "auto",
  });
  const message = (first.choices && first.choices[0] && first.choices[0].message) || {};
  let answer = String(message.content || "").trim();
  let proposal = null;
  const call = (message.tool_calls || [])[0];
  if (call && call.function) {
    let args = {};
    try {
      args = JSON.parse(call.function.arguments || "{}");
    } catch (error) {
      args = {};
    }
    if (call.function.name === "create_schedule") {
      proposal = readScheduleProposal(args);
      if (proposal) {
        answer = answer || `要记下「${proposal.title}」在 ${proposal.date} 吗？`;
      } else {
        answer = answer || "我还需要具体是哪一天，可以再说一次吗？";
      }
    } else if (call.function.name === "query_upcoming") {
      const days = clampNumber(args.days, 1, 60, 14);
      const items = await upcomingFor(openid, days);
      const second = await postJson(url, headers, {
        model: "deepseek-chat",
        temperature: 0.7,
        messages: messages.concat(
          { role: "assistant", content: message.content || "", tool_calls: message.tool_calls },
          { role: "tool", tool_call_id: call.id, content: upcomingText(items) }
        ),
      });
      const follow = (second.choices && second.choices[0] && second.choices[0].message) || {};
      answer = String(follow.content || "").trim() || upcomingText(items);
    } else {
      answer = answer || "这次没理解清楚，可以换个说法吗？";
    }
  }
  if (!answer) {
    throw new Error("没有得到回答");
  }
  await db.collection("asks").add({
    data: { openid, date, question: text, answer, createdAt: Date.now() },
  });
  return { ok: true, answer, proposal };
}
