// ui/dom.js
// Samlar DOM-referenser på ett ställe så renderers/controllers kan dela.

export const els = {
  intro: document.getElementById("intro"),
  chatWrapper: document.getElementById("chat-wrapper"),
  messages: document.getElementById("messages"),
  inputArea: document.getElementById("input-area"),
  input: document.getElementById("userInput"),
  sendBtn: document.getElementById("sendBtn"),
  loginBtn: document.getElementById("loginBtn"),
  userInfo: document.getElementById("userInfo"),
  userName: document.getElementById("userName"),
  newThreadBtn: document.getElementById("newThreadBtn"),
};
