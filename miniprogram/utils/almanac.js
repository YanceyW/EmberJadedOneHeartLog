/**
 * 黄历宜忌。用 lunar-javascript 的默认流派（节气当天起月）。
 * 农历库覆盖 1920–2100，这之外返回 null；范围内任何一年都能算，不用每年更新。
 */
const { Solar } = require("./lunar-lib.js");

const FIRST_YEAR = 1920;
const LAST_YEAR = 2100;

function joinItems(list) {
  return (list || []).filter((item) => item && item !== "无").join("、");
}

function dayAlmanac(year, month, day) {
  if (!year || year < FIRST_YEAR || year > LAST_YEAR) {
    return null;
  }
  try {
    const lunar = Solar.fromYmd(year, month, day).getLunar();
    const yi = joinItems(lunar.getDayYi(1));
    const ji = joinItems(lunar.getDayJi(1));
    if (!yi && !ji) {
      return null;
    }
    return { yi, ji };
  } catch (error) {
    return null;
  }
}

module.exports = { dayAlmanac };
