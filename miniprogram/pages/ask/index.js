const app = getApp();

Page({
  data: {
    question: "",
    messages: [],
    remaining: 10,
    writing: false,
  },

  onShow() {
    this.loadHistory();
  },

  onUnload() {
    this.stopTyping();
  },

  async loadHistory() {
    const result = await app.call("listAsks");
    if (!result.ok) {
      return;
    }
    const messages = [];
    (result.items || []).forEach((item) => {
      messages.push({ id: `${item.question}-${messages.length}`, role: "user", text: item.question });
      messages.push({ id: `ai-${messages.length}`, role: "ai", text: item.answer, shown: item.answer });
    });
    this.setData({ messages, remaining: result.remaining });
  },

  onQuestion(event) {
    this.setData({ question: event.detail.value });
  },

  async send() {
    const question = this.data.question.trim();
    if (!question || this.data.writing) {
      return;
    }
    const messages = this.data.messages.concat([
      { id: `u-${Date.now()}`, role: "user", text: question },
      { id: `a-${Date.now()}`, role: "ai", text: "", shown: "" },
    ]);
    this.setData({ question: "", messages, writing: true });
    const result = await app.call("ask", { question });
    if (!result.ok) {
      messages.pop();
      this.setData({ messages, writing: false });
      wx.showToast({ title: result.message, icon: "none" });
      return;
    }
    const last = messages.length - 1;
    messages[last].text = result.answer;
    this.setData({ messages, remaining: result.remaining });
    this.typeAnswer(last, result.answer);
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
      this.setData({ messages });
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
});
