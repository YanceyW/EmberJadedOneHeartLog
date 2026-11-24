/**
 * 一次性订阅。模板 ID 还没在小程序后台配好时留空，发送留言不会弹窗。
 * 配好后把模板 ID 填在这里，字段名要和后台模板一致。
 */
const TEMPLATE_ID = "";

function requestOnce() {
  return new Promise((resolve) => {
    if (!TEMPLATE_ID || !wx.requestSubscribeMessage) {
      resolve(false);
      return;
    }
    wx.requestSubscribeMessage({
      tmplIds: [TEMPLATE_ID],
      complete: () => resolve(true),
    });
  });
}

module.exports = {
  TEMPLATE_ID,
  requestOnce,
};
