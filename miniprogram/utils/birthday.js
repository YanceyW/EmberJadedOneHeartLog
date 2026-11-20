const { addDays, anniversaryOn, diffDays, todayString } = require("./date");
const { leapMonth, solarToLunar } = require("./lunar");

function sameLunar(lunar, item) {
  if (!lunar || lunar.month !== Number(item.month) || lunar.day !== Number(item.day)) {
    return false;
  }
  if (item.leap) {
    if (lunar.isLeap) {
      return true;
    }
    return leapMonth(lunar.year) !== Number(item.month);
  }
  return !lunar.isLeap;
}

/** 这一天是不是这条生日。 */
function occursOn(item, date) {
  const [year, month, day] = String(date).split("-").map(Number);
  if (!year || !month || !day) {
    return false;
  }
  if (item.calendar === "lunar") {
    return sameLunar(solarToLunar(year, month, day), item);
  }
  return anniversaryOn(year, item.month, item.day) === date;
}

/** 下一次生日的阳历日期，以及现年龄和下一次的岁数。 */
function nextBirthday(item, today) {
  const startYear = Number(item.year);
  if (!startYear || !item.month || !item.day) {
    return null;
  }
  const from = today || todayString();
  if (item.calendar === "lunar") {
    let cursor = from;
    for (let step = 0; step < 400; step += 1) {
      const [year, month, day] = cursor.split("-").map(Number);
      const lunar = solarToLunar(year, month, day);
      if (sameLunar(lunar, item)) {
        const nextAge = lunar.year - startYear;
        const age = cursor === from ? nextAge : nextAge - 1;
        return { date: cursor, age: Math.max(age, 0), nextAge: Math.max(nextAge, 0) };
      }
      cursor = addDays(cursor, 1);
    }
    return null;
  }
  const nowYear = Number(from.slice(0, 4));
  let date = anniversaryOn(nowYear, item.month, item.day);
  if (date < from) {
    date = anniversaryOn(nowYear + 1, item.month, item.day);
  }
  const nextAge = Number(date.slice(0, 4)) - startYear;
  const age = date === from ? nextAge : nextAge - 1;
  return { date, age: Math.max(age, 0), nextAge: Math.max(nextAge, 0) };
}

function birthdayPhrase(item, today) {
  const from = today || todayString();
  const next = nextBirthday(item, from);
  if (!next) {
    return { date: "", days: 0, age: 0, nextAge: 0, text: "" };
  }
  const days = diffDays(from, next.date);
  let text = `现年${next.age}岁，还有${days}天满${next.nextAge}岁`;
  if (days === 0) {
    text = `今天满${next.nextAge}岁`;
  }
  return { ...next, days, text };
}

module.exports = {
  occursOn,
  nextBirthday,
  birthdayPhrase,
};
