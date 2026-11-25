/**
 * 提醒时机。所有提醒都是同一个结构：提前几天 + 几点几分。
 * 日期列按目标日算出来，选中后换算成 leadDays，所以生日这类每年滚动也不会失效。
 */
const { addDays, diffDays, todayString } = require("./date");

const SPAN = 30;
const MINUTE_STEP = 5;

const OFF = { enabled: false, leadDays: 1, hour: 9, minute: 0 };
const FALLBACK = { enabled: true, leadDays: 1, hour: 9, minute: 0 };

function pad(value) {
  return String(value).padStart(2, "0");
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}

/** 非对象（空值、布尔等）一律当成没有提醒。 */
function normalizeRemind(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...OFF };
  }
  const minute = Number.isFinite(Number(value.minute))
    ? clampNumber(Math.round(Number(value.minute) / MINUTE_STEP) * MINUTE_STEP, 0, 55, FALLBACK.minute)
    : FALLBACK.minute;
  return {
    enabled: value.enabled !== false,
    leadDays: clampNumber(value.leadDays, 0, SPAN, FALLBACK.leadDays),
    hour: clampNumber(value.hour, 0, 23, FALLBACK.hour),
    minute,
  };
}

function clockText(remind) {
  return `${pad(remind.hour)}:${pad(remind.minute)}`;
}

/** 新建记录时的默认时机：默认早上 9 点。 */
function defaultRemind(leadDays) {
  return { enabled: true, leadDays: clampNumber(leadDays, 0, SPAN, 0), hour: FALLBACK.hour, minute: FALLBACK.minute };
}

function describe(remind) {
  const value = normalizeRemind(remind);
  if (!value.enabled) {
    return "不提醒";
  }
  if (!value.leadDays) {
    return `当天 ${clockText(value)} 提醒`;
  }
  if (value.leadDays === 1) {
    return `前一天 ${clockText(value)} 提醒`;
  }
  return `提前 ${value.leadDays} 天 ${clockText(value)} 提醒`;
}

function dateLabel(text, target) {
  const label = `${Number(text.slice(5, 7))}月${Number(text.slice(8, 10))}日`;
  if (text === target) {
    return `${label}（当天）`;
  }
  if (text === addDays(target, -1)) {
    return `${label}（前一天）`;
  }
  return label;
}

/** picker 的三列内容与当前选中位置。targetDate 为空时按今天算。 */
function buildPicker(remind, targetDate) {
  const value = normalizeRemind(remind);
  const target = /^\d{4}-\d{2}-\d{2}$/.test(String(targetDate || "")) ? targetDate : todayString();
  const dates = [];
  for (let offset = SPAN; offset >= 0; offset -= 1) {
    dates.push(addDays(target, -offset));
  }
  const hours = [];
  for (let hour = 0; hour < 24; hour += 1) {
    hours.push(pad(hour));
  }
  const minutes = [];
  for (let minute = 0; minute < 60; minute += MINUTE_STEP) {
    minutes.push(pad(minute));
  }
  const wanted = addDays(target, -value.leadDays);
  const dateIndex = dates.indexOf(wanted);
  return {
    range: [dates.map((text) => dateLabel(text, target)), hours, minutes],
    dates,
    target,
    index: [dateIndex < 0 ? dates.length - 1 : dateIndex, value.hour, Math.round(value.minute / MINUTE_STEP)],
  };
}

/** picker 选中值换回 remind 对象。 */
function fromPicker(dates, picked, targetDate) {
  const target = /^\d{4}-\d{2}-\d{2}$/.test(String(targetDate || "")) ? targetDate : todayString();
  const list = Array.isArray(dates) && dates.length ? dates : [target];
  const chosen = list[clampNumber(picked && picked[0], 0, list.length - 1, list.length - 1)];
  return {
    enabled: true,
    leadDays: clampNumber(Math.abs(diffDays(chosen, target)), 0, SPAN, 0),
    hour: clampNumber(picked && picked[1], 0, 23, FALLBACK.hour),
    minute: clampNumber(picked && picked[2], 0, 11, 0) * MINUTE_STEP,
  };
}

module.exports = {
  SPAN,
  MINUTE_STEP,
  normalizeRemind,
  defaultRemind,
  describe,
  buildPicker,
  fromPicker,
};
