/**
 * 今年的黄历宜忌。用 lunar-javascript 的默认流派（节气当天起月）。
 * 只覆盖当前公历年，翻到别的年份不显示。
 */
const { Solar } = require("./lunar-lib.js");

function joinItems(list) {
  return (list || []).filter((item) => item && item !== "无").join("、");
}

function dayAlmanac(year, month, day) {
  const now = new Date();
  if (year !== now.getFullYear()) {
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
