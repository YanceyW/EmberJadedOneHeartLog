const app = getApp();
const { getTabClearance, watchTabClearance } = require("../../utils/layout");
const { defaultRemind } = require("../../utils/remind");

function dayText(date) {
  if (!date) {
    return "";
  }
  const today = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const now = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  if (date === now) {
    return "今天";
  }
  const [year, month, day] = date.split("-");
  if (year === now.slice(0, 4)) {
    return `${Number(month)}月${Number(day)}日`;
  }
  return `${year}年${Number(month)}月${Number(day)}日`;
}

Component({
  properties: {
    active: {
      type: Boolean,
      value: false,
    },
  },
  data: {
    question: "",
    messages: [],
    writing: false,
    selecting: false,
    picked: {},
    pickedCount: 0,
    settingsOpen: false,
    memoryText: "",
    scrollInto: "",
    hasMore: false,
    tabClearance: 120,
  },
  observers: {
    active(value) {
      if (value) {
        this.setData({ tabClearance: getTabClearance() });
        if (!this.historyLoaded) {
          this.loadHistory();
        }
      }
    },
  },
  lifetimes: {
    attached() {
      this.setData({ tabClearance: getTabClearance() });
      this.hasMore = false;
      this.before = 0;
      this.loadingOlder = false;
      this.historyLoaded = false;
      this.unwatchClearance = watchTabClearance((value) => {
        this.setData({ tabClearance: value });
      });
    },
    detached() {
      if (this.unwatchClearance) {
        this.unwatchClearance();
        this.unwatchClearance = null;
      }
      this.stopTyping();
    },
  },
  pageLifetimes: {
    show() {
      this.setData({ tabClearance: getTabClearance() });
    },
  },
  methods: {
    decorate(items) {
      let lastDate = "";
      return (items || []).map((item) => {
        const showDay = item.date !== lastDate;
        lastDate = item.date;
        return {
          id: item.id,
          date: item.date,
          createdAt: item.createdAt || 0,
          showDay,
          dayText: dayText(item.date),
          question: item.question,
          answer: item.answer,
          shown: item.shown !== undefined ? item.shown : item.answer,
        };
      });
    },

    applyItems(items, anchorId) {
      const messages = this.decorate(items);
      const oldest = messages.reduce((min, item) => {
        if (!item.createdAt) return min;
        return min ? Math.min(min, item.createdAt) : item.createdAt;
      }, 0);
      this.before = oldest;
      this.setData({
        messages,
        hasMore: !!this.hasMore,
        scrollInto: anchorId ? `m-${anchorId}` : (messages.length ? "end" : ""),
      });
    },

    async loadHistory() {
      const result = await app.call("listAsks");
      if (!result.ok) {
        wx.showToast({ title: result.message, icon: "none" });
        return;
      }
      this.historyLoaded = true;
      this.hasMore = !!result.hasMore;
      this.applyItems(result.items);
    },

    async loadOlder() {
      if (!this.hasMore || this.loadingOlder || !this.before) {
        return;
      }
      this.loadingOlder = true;
      const anchor = this.data.messages[0] && this.data.messages[0].id;
      const result = await app.call("listAsks", { before: this.before });
      this.loadingOlder = false;
      if (!result.ok) {
        wx.showToast({ title: result.message, icon: "none" });
        return;
      }
      this.hasMore = !!result.hasMore;
      const seen = new Set(this.data.messages.map((item) => item.id));
      const older = (result.items || []).filter((item) => !seen.has(item.id));
      if (!older.length) {
        this.hasMore = false;
        this.setData({ hasMore: false });
        return;
      }
      const merged = older.concat(this.data.messages.map((item) => ({
        id: item.id,
        date: item.date,
        createdAt: item.createdAt,
        question: item.question,
        answer: item.answer,
        shown: item.shown,
      })));
      this.applyItems(merged, anchor);
    },

    onQuestion(event) {
      this.setData({ question: event.detail.value });
    },

    async send() {
      const question = this.data.question.trim();
      if (!question || this.data.writing || this.data.selecting) {
        return;
      }
      const today = dayText((() => {
        const now = new Date();
        const pad = (value) => String(value).padStart(2, "0");
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      })());
      const last = this.data.messages[this.data.messages.length - 1];
      const localId = `local-${Date.now()}`;
      const messages = this.data.messages.concat({
        id: localId,
        date: "",
        createdAt: Date.now(),
        showDay: !last || last.dayText !== "今天",
        dayText: today,
        question,
        answer: "",
        shown: "",
      });
      this.setData({ question: "", messages, writing: true, scrollInto: "end" });
      const result = await app.call("ask", { question });
      if (!result.ok) {
        messages.pop();
        this.setData({ messages, writing: false });
        wx.showToast({ title: result.message, icon: "none" });
        return;
      }
      const now = new Date();
      const pad = (value) => String(value).padStart(2, "0");
      const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const next = this.data.messages.slice();
      const index = next.length - 1;
      if (index >= 0) {
        next[index] = {
          id: localId,
          date,
          createdAt: Date.now(),
          showDay: next[index].showDay,
          dayText: today,
          question,
          answer: result.answer,
          shown: "",
          proposal: result.proposal || null,
        };
        this.setData({ messages: next, writing: true, scrollInto: "end" });
        this.typeAnswer(index, result.answer);
      } else {
        this.setData({ writing: false });
      }
    },

    typeAnswer(index, text) {
      this.stopTyping();
      let count = 0;
      this.timer = setInterval(() => {
        count += 1;
        const messages = this.data.messages.slice();
        if (!messages[index]) {
          this.stopTyping();
          return;
        }
        messages[index].shown = text.slice(0, count);
        this.setData({ messages, scrollInto: "end" });
        if (count >= text.length) {
          this.stopTyping();
        }
      }, 30);
    },

    stopTyping() {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      if (this.data.writing) {
        this.setData({ writing: false });
      }
    },

    async confirmProposal(event) {
      const index = Number(event.currentTarget.dataset.index);
      const message = this.data.messages[index];
      if (!message || !message.proposal || message.proposalDone) {
        return;
      }
      const proposal = message.proposal;
      const result = await app.call("saveSchedule", {
        title: proposal.title,
        date: proposal.date,
        note: proposal.note || "",
        visibility: "both",
        remind: defaultRemind(1),
      });
      if (!result.ok) {
        wx.showToast({ title: result.message, icon: "none" });
        return;
      }
      app.globalData.session = result;
      const messages = this.data.messages.slice();
      messages[index] = { ...messages[index], proposalDone: true, proposalSkipped: false };
      this.setData({ messages });
      wx.showToast({ title: "已记到日程", icon: "none" });
    },

    dismissProposal(event) {
      const index = Number(event.currentTarget.dataset.index);
      const messages = this.data.messages.slice();
      if (!messages[index] || !messages[index].proposal) {
        return;
      }
      messages[index] = { ...messages[index], proposalDone: true, proposalSkipped: true };
      this.setData({ messages });
    },

    openSettings() {
      this.setData({ settingsOpen: true });
      app.call("getMemory").then((result) => {
        if (!result.ok) {
          wx.showToast({ title: result.message, icon: "none" });
          return;
        }
        this.setData({ memoryText: result.text || "" });
      });
    },

    closeSettings() {
      this.setData({ settingsOpen: false });
    },

    onMemory(event) {
      this.setData({ memoryText: event.detail.value });
    },

    clearMemory() {
      wx.showModal({
        title: "要清空吗",
        content: "清空后，AI 就不再参考这段记忆",
        success: async (res) => {
          if (!res.confirm) {
            return;
          }
          const result = await app.call("saveMemory", { text: "" });
          if (!result.ok) {
            wx.showToast({ title: result.message, icon: "none" });
            return;
          }
          this.setData({ memoryText: "", settingsOpen: false });
          wx.showToast({ title: "已清空" });
        },
      });
    },

    async saveSettings() {
      const result = await app.call("saveMemory", { text: this.data.memoryText });
      if (!result.ok) {
        wx.showToast({ title: result.message, icon: "none" });
        return;
      }
      this.setData({ settingsOpen: false, memoryText: result.text || "" });
      wx.showToast({ title: "已保存" });
    },

    startDelete() {
      if (this.data.selecting) {
        this.setData({ selecting: false, picked: {}, pickedCount: 0 });
        return;
      }
      this.setData({ selecting: true, picked: {}, pickedCount: 0 });
    },

    onPair(event) {
      if (!this.data.selecting) {
        return;
      }
      const id = event.currentTarget.dataset.id;
      if (!id || String(id).indexOf("local-") === 0) {
        return;
      }
      const picked = { ...this.data.picked };
      picked[id] = !picked[id];
      const pickedCount = Object.keys(picked).filter((key) => picked[key]).length;
      this.setData({ picked, pickedCount });
    },

    noop() {},

    confirmDelete() {
      const ids = Object.keys(this.data.picked).filter((key) => this.data.picked[key]);
      if (!ids.length) {
        wx.showToast({ title: "先选中要删除的对话", icon: "none" });
        return;
      }
      wx.showModal({
        title: "要删除吗",
        content: "要删除选中的聊天记录吗",
        success: async (res) => {
          if (!res.confirm) {
            return;
          }
          const result = await app.call("deleteAsks", { ids });
          if (!result.ok) {
            wx.showToast({ title: result.message, icon: "none" });
            return;
          }
          this.setData({ selecting: false, picked: {}, pickedCount: 0 });
          const idSet = new Set(ids);
          const kept = this.data.messages
            .filter((item) => !idSet.has(item.id))
            .map((item) => ({
              id: item.id,
              date: item.date,
              createdAt: item.createdAt,
              question: item.question,
              answer: item.answer,
              shown: item.shown,
            }));
          this.applyItems(kept);
        },
      });
    },
  },
});
