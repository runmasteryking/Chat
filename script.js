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
  // ── DOM Elements ──────────────────────────────────────────────────────────
  const loginBtn    = document.getElementById("loginBtn");
  const chatWrapper = document.getElementById("chat-wrapper");
  const intro       = document.getElementById("intro");
  const messages    = document.getElementById("messages");
  const inputArea   = document.getElementById("input-area");
  const input       = document.getElementById("userInput");
  const sendBtn     = document.getElementById("sendBtn");
  const userInfo    = document.getElementById("userInfo");
  const userName    = document.getElementById("userName");

  // ── State ─────────────────────────────────────────────────────────────────
  let currentUser = null;
  let firstMessageSent = false;

  const userProfileState = {
    name: null, language: null, gender: null, birthYear: null,
    level: null, weeklySessions: null, current5kTime: null,
    injuryNotes: null, raceComingUp: null, raceDate: null,
    raceDistance: null, agent: null, profileComplete: false,
    conversationSummary: ""
  };

  const profileQuestions = [
    { key:"name", question:"What should I call you?" },
    { key:"gender", question:"What's your gender?" },
    { key:"birthYear", question:"What year were you born?" },
    { key:"level", question:"How experienced are you? (beginner, intermediate, advanced)" },
    { key:"weeklySessions", question:"How many times do you run per week?" },
    { key:"current5kTime", question:"What's your current 5K time?" },
    { key:"injuryNotes", question:"Any injuries or limitations?" },
    { key:"raceComingUp", question:"Do you have a race coming up?" },
    { key:"raceDate", question:"When is the race?" },
    { key:"raceDistance", question:"What distance is the race?" }
  ];

  // ── Helper: controlled auto-resize textarea ───────────────────────────────
  const BASE_H = 44;   // single-line baseline height (matches CSS)
  const MAX_H  = 160;  // max auto-expand height

  function updateTextareaLayout() {
    const hasText = input.value.trim().length > 0;

    if (!hasText) {
      // Empty: keep one line, don't wrap placeholder
      input.style.whiteSpace = "nowrap";
      input.style.height = BASE_H + "px";
    } else {
      // With text: allow wrapping and grow up to MAX_H
      input.style.whiteSpace = "normal";
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, MAX_H) + "px";
    }
  }

  // Re-layout on input & focus
  input.addEventListener("input", updateTextareaLayout);
  input.addEventListener("focus", () => {
    // ensure correct height after any late fonts/layout
    setTimeout(updateTextareaLayout, 0);
  });

  // ── Authentication ────────────────────────────────────────────────────────
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
    if (user) {
      await handleUserLoggedIn(user);
    }
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
    }
    await setDoc(ref, {
      lastLogin: serverTimestamp(),
      profile: userProfileState
    }, { merge: true });
  }

  function showUserInfo(u) {
    loginBtn.style.display = "none";
    userInfo.style.display = "flex";
    userName.textContent = u.displayName || "Runner";
  }

  function showChatUI() {
    chatWrapper.style.display = "flex";
    messages.style.display    = "flex";
    inputArea.style.display   = "flex";
    updateTextareaLayout(); // set baseline height/nowrap
  }

  // ── Chat flow ─────────────────────────────────────────────────────────────
  sendBtn.addEventListener("click", sendMessage);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;

    // Onboarding first question
    if (!firstMessageSent) {
      intro.style.display = "none";
      firstMessageSent = true;
      appendBot(profileQuestions[0].question);
      await persist("bot", profileQuestions[0].question);
      await summarize("bot", profileQuestions[0].question);
      input.value = "";
      updateTextareaLayout();
      return;
    }

    // User message
    appendUser(text);
    await persist("user", text);
    await summarize("user", text);
    input.value = "";
    updateTextareaLayout();

    // Bot thinking indicator
    const thinking = createMessage("bot", "…", "thinking");
    messages.appendChild(thinking);
    autoScroll();

    try {
      const reply = await generateBotReply(text);
      thinking.remove();
      appendBot(reply);
      await persist("bot", reply);
      await summarize("bot", reply);
    } catch (err) {
      thinking.remove();
      appendBot("⚠️ Something went wrong.");
      console.error(err);
    }
  }

  // ── Persistence & Summary ─────────────────────────────────────────────────
  async function persist(sender, text) {
    const ref = doc(db, "users", currentUser.uid, "messages", Date.now().toString());
    await setDoc(ref, { sender, text, timestamp: serverTimestamp() });
  }

  async function summarize(sender, text) {
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
    const { summary } = await res.json();
    userProfileState.conversationSummary = summary;
    await setDoc(uref, {
      profile: { conversationSummary: summary }
    }, { merge: true });
  }

  // ── AI Call ────────────────────────────────────────────────────────────────
  async function generateBotReply(userText) {
    const uref = doc(db, "users", currentUser.uid);
    const snap = await getDoc(uref);
    const summary = snap.data()?.profile?.conversationSummary || "";
    const msgsCol = collection(db, "users", currentUser.uid, "messages");
    const q = query(msgsCol, orderBy("timestamp","desc"), limit(5));
    const dsnap = await getDocs(q);
    const recent = dsnap.docs.map(d => `${d.data().sender}: ${d.data().text}`)
                           .reverse().join("\n");
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
    if (!res.ok) throw new Error(`GPT error ${res.status}`);
    const data = await res.json();
    // Apply any profile updates
    if (data.profileUpdate && Object.keys(data.profileUpdate).length) {
      Object.assign(userProfileState, data.profileUpdate);
      await setDoc(uref, {
        profile: userProfileState,
        updatedAt: serverTimestamp()
      }, { merge: true });
    }
    return data.reply || "";
  }

  // ── Rendering Helpers ─────────────────────────────────────────────────────
  function createMessage(type, text, extraClass="") {
    const div = document.createElement("div");
    div.className = `message ${type}` + (extraClass ? ` ${extraClass}` : "");
    div.textContent = text;
    return div;
  }

  function appendUser(text) {
    const msg = createMessage("user", text);
    messages.appendChild(msg);
    autoScroll();
  }

  function appendBot(text) {
    const msg = createMessage("bot", text);
    messages.appendChild(msg);
    autoScroll();
  }

  function autoScroll() {
    messages.scrollTop = messages.scrollHeight;
  }

  // ── Expose for inline onkeydown ──────────────────────────────────────────
  window.handleKey = e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };
});
