/**
 * 一次性订阅：谁点谁收，一次授权换一条额度。
 * 模板 key 见云函数 TEMPLATES：schedule / note / period / birthday / anniversary / decision / capsule。
 * 模板 ID 由云端 getSubscriptions 下发，前端不写死。
 */
const KEY_LIMIT = 5;
let cache = {};

function gapp() {
  return getApp();
}

/** 页面显示时先拉一次，点击 +1 时才能同步取到模板 ID。 */
async function preload() {
  const result = await gapp().call("getSubscriptions");
  if (result.ok) {
    const next = {};
    (result.templates || []).forEach((item) => {
      next[item.key] = item;
    });
    cache = next;
  }
  return list();
}

function list() {
  return Object.keys(cache).map((key) => cache[key]);
}

function ready(keys) {
  return (keys || []).filter((key) => cache[key] && cache[key].templateId && cache[key].enabled !== false);
}

function save(result) {
  if (result && result.ok) {
    const next = {};
    (result.templates || []).forEach((item) => {
      next[item.key] = item;
    });
    cache = next;
  }
  return list();
}

/**
 * 必须在用户点击的同步回调里调用，前面不能有 await，否则微信会拒。
 * @param {string[]} keys 要加额度的模板
 */
function request(keys) {
  const todo = ready(keys).slice(0, KEY_LIMIT);
  if (!todo.length || !wx.requestSubscribeMessage) {
    return Promise.resolve([]);
  }
  const accepted = [];
  return new Promise((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds: todo.map((key) => cache[key].templateId),
      success: (res) => {
        todo.forEach((key) => {
          if (res[cache[key].templateId] === "accept") {
            accepted.push(key);
          }
        });
      },
      complete: () => resolve(accepted),
    });
  }).then(async (keys) => {
    if (!keys.length) {
      return [];
    }
    const result = await gapp().call("grantSubscribe", { keys });
    save(result);
    return keys;
  });
}

async function setEnabled(key, enabled) {
  const result = await gapp().call("setSubscribeEnabled", { key, enabled: !!enabled });
  return save(result);
}

async function openSettings() {
  return new Promise((resolve) => {
    wx.openSetting({ complete: () => resolve() });
  });
}

module.exports = {
  preload,
  list,
  cache: () => cache,
  request,
  setEnabled,
  openSettings,
};

