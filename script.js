// script.js

import {
  auth,
  provider,
  db,
  signInWithPopup,
  onAuthStateChanged,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  collection,
  query,
  orderBy,
  limit,
  getDocs
} from "./firebase-config.js";

window.addEventListener("DOMContentLoaded", () => {
  // ── DOM
  const loginBtn    = document.getElementById("loginBtn");
  const chatWrapper = document.getElementById("chat-wrapper");
  const intro       = document.getElementById("intro");
  const messages    = document.getElementById("messages");
  const inputArea   = document.getElementById("input-area");
  const input       = document.getElementById("userInput");
  const sendBtn     = document.getElementById("sendBtn");
  const userInfo    = document.getElementById("userInfo");
  const userName    = document.getElementById("userName");

  // ── State
  let currentUser = null;
  let firstMessageSent = false;
  let isSending = false;
  let lastSendAt = 0;

  const userProfileState = {
    name: null, language: "swedish", gender: null, birthYear: null,
    level: null, weeklySessions: null, current5kTime: null,
    injuryNotes: null, raceComingUp: null, raceDate: null,
    raceDistance: null, agent: "coach", profileComplete: false,
    conversationSummary: ""
  };

  const profileQuestions = [
    { key:"name",           question:"What should I call you?" },
    { key:"gender",         question:"What's your gender?" },
    { key:"birthYear",      question:"What year were you born?" },
    { key:"level",          question:"How experienced are you? (beginner, intermediate, advanced)" },
    { key:"weeklySessions", question:"How many times do you run per week?" },
    { key:"current5kTime",  question:"What's your current 5K time?" },
    { key:"injuryNotes",    question:"Any injuries or limitations?" },
    { key:"raceComingUp",   question:"Do you have a race coming up?" },
    { key:"raceDate",       question:"When is the race?" },
    { key:"raceDistance",   question:"What distance is the race?" }
  ];

  // ── Auth
  loginBtn.addEventListener("click", async () => {
    try {
      const { user } = await signInWithPopup(auth, provider);
      await handleUserLoggedIn(user);
    } catch (e) {
      console.error("Login failed:", e);
      alert("Login failed — check console for details.");
    }
  });

  onAuthStateChanged(auth, async user => {
    if (user) await handleUserLoggedIn(user);
  });

  async function handleUserLoggedIn(user) {
    currentUser = user;
    await loadProfile(user.uid);
    showUserInfo(user);
    showChatUI();
  }

  async function loadProfile(uid) {
    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);
    if (snap.exists() && snap.data().profile) {
      Object.assign(userProfileState, snap.data().profile);

      // ✅ Kontrollera om profilen är komplett
      const requiredFields = ["name", "gender", "birthYear", "level", "weeklySessions", "current5kTime"];
      const missing = requiredFields.filter(f => !userProfileState[f]);
      userProfileState.profileComplete = missing.length === 0;
    }
    await setDoc(ref, { lastLogin: serverTimestamp(), profile: userProfileState }, { merge: true });
  }

  function showUserInfo(u) {
    loginBtn.style.display = "none";
    userInfo.style.display = "flex";
    userName.textContent = u.displayName || userProfileState.name || "Runner";
  }

  function showChatUI() {
    chatWrapper.style.display = "flex";
    messages.style.display    = "flex";
    inputArea.style.display   = "block";
  }

  // ── Composer UX
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  inputArea.addEventListener("click", e => { if (e.target !== input) input.focus(); });
  chatWrapper.addEventListener("click", e => {
    const isClickable = e.target.closest(".fab, .chip, .message");
    if (!isClickable) input.focus();
  });

  const mo = new MutationObserver(() => autoScrollIfNeeded(true));
  mo.observe(messages, { childList: true });

  sendBtn.addEventListener("click", sendMessage);

  async function sendMessage() {
    const now = Date.now();
    if (isSending || now - lastSendAt < 350) return;
    lastSendAt = now;

    const text = input.value.trim();
    if (!text) return;

    isSending = true;
    try {
      const isFirst = !firstMessageSent;
      if (isFirst) {
        if (intro) intro.classList.add("intro-hidden");
        firstMessageSent = true;
      }

      appendUser(text);
      await persist("user", text);
      summarize("user", text).catch(e => console.warn("summarize user err:", e));
      input.value = "";

      // 🔹 Fråga bara om det saknas fält i profilen
      if (!userProfileState.profileComplete) {
        const missingField = profileQuestions.find(q => !userProfileState[q.key]);
        if (missingField) {
          appendBot(missingField.question);
          await persist("bot", missingField.question);
          summarize("bot", missingField.question).catch(e => console.warn("summarize bot err:", e));
          return;
        } else {
          userProfileState.profileComplete = true;
          await setDoc(doc(db, "users", currentUser.uid), { profile: userProfileState }, { merge: true });
        }
      }

      const thinking = createMessage("bot", "…", "thinking");
      messages.appendChild(thinking);
      autoScrollIfNeeded(true);

      const reply = await generateBotReply(text);
      thinking.remove();
      appendBot(reply);
      await persist("bot", reply);
      summarize("bot", reply).catch(e => console.warn("summarize bot err:", e));
    } catch (err) {
      console.error(err);
      appendBot(`⚠️ ${err.message || "Something went wrong."}`);
    } finally {
      isSending = false;
    }
  }

  // ── Persistence & Summary
  async function persist(sender, text) {
    if (!currentUser) return;
    const id = Date.now().toString();
    const ref = doc(db, "users", currentUser.uid, "messages", id);
    await setDoc(ref, { sender, text, timestamp: serverTimestamp() });
  }

  async function summarize(sender, text) {
    if (!currentUser) return;
    const uref = doc(db, "users", currentUser.uid);
    const snap = await getDoc(uref);
    const existing = snap.data()?.profile?.conversationSummary || "";

    const res = await fetch("/.netlify/functions/summarize-gpt", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        prompt: `Existing summary:\n${existing}\n\n${sender}: ${text}\n\nUpdate summary (<=200 words):`
      })
    });

    if (!res.ok) {
      const t = await res.text();
      console.warn("summarize-gpt failed:", res.status, t);
      return;
    }

    const { summary } = await res.json();
    userProfileState.conversationSummary = summary;
    await setDoc(uref, { profile: { conversationSummary: summary } }, { merge: true });
  }

  // ── AI
  async function generateBotReply(userText) {
    const uref = doc(db, "users", currentUser.uid);
    const snap = await getDoc(uref);
    const summary = snap.data()?.profile?.conversationSummary || "";

    const msgsCol = collection(db, "users", currentUser.uid, "messages");
    const qy = query(msgsCol, orderBy("timestamp","desc"), limit(5));
    const ds = await getDocs(qy);
    const recent = ds.docs.map(d => `${d.data().sender}: ${d.data().text}`).reverse().join("\n");

    const res = await fetch("/.netlify/functions/ask-gpt", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        systemSummary:  summary,
        recentMessages: recent,
        message:        userText,
        userProfile:    { ...userProfileState, name: userProfileState.name || currentUser.displayName }
      })
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("ask-gpt failed:", res.status, text);
      throw new Error(`ask-gpt ${res.status}: ${text}`);
    }

    const data = await res.json();
    if (data.profileUpdate && Object.keys(data.profileUpdate).length) {
      Object.assign(userProfileState, data.profileUpdate);
      await setDoc(uref, { profile: userProfileState, updatedAt: serverTimestamp() }, { merge: true });
    }
    return data.reply || "";
  }

  // ── Render helpers
  function createMessage(type, text, extraClass="") {
    const div = document.createElement("div");
    div.className = `message ${type}` + (extraClass ? ` ${extraClass}` : "");
    div.textContent = text;
    return div;
  }
  function appendUser(text){
    messages.appendChild(createMessage("user", text));
    autoScrollIfNeeded(true);
  }
  function appendBot(text){
    messages.appendChild(createMessage("bot", text));
    autoScrollIfNeeded(true);
  }

  function autoScrollIfNeeded(smooth = false){
    const atBottom = messages.scrollHeight - messages.scrollTop <= messages.clientHeight + 10;
    if (atBottom) {
      if (smooth && "scrollTo" in messages) {
        messages.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });
      } else {
        messages.scrollTop = messages.scrollHeight;
      }
    }
  }
});
