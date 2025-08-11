// ui/dom.js
// Samlar DOM-referenser på ett ställe så renderers/controllers kan dela.

// Exporterar ett objekt som kan uppdateras vid behov
export const els = {
  intro: null,
  chatWrapper: null,
  messages: null,
  inputArea: null,
  input: null,
  sendBtn: null,
  loginBtn: null,
  userInfo: null,
  userName: null,
  newThreadBtn: null,
};

// Funktion som fyller på referenser när DOM finns
export function cacheDom() {
  els.intro = document.getElementById("intro");
  els.chatWrapper = document.getElementById("chat-wrapper");
  els.messages = document.getElementById("messages");
  els.inputArea = document.getElementById("input-area");
  els.input = document.getElementById("userInput");
  els.sendBtn = document.getElementById("sendBtn");
  els.loginBtn = document.getElementById("loginBtn");
  els.userInfo = document.getElementById("userInfo");
  els.userName = document.getElementById("userName");
  els.newThreadBtn = document.getElementById("newThreadBtn");
}
