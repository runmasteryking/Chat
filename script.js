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
  let isSending = false; // prevents double sends

  const userProfileState = {
    name: null, language: null, gender: null, birthYear: null,
    level: null, weeklySessions: null, current5kTime: null,
    injuryNotes: null, raceComingUp: null, raceDate: null,
    raceDistance: null, agent: null, profileComplete: false,
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
    inputArea.style.display   = "block";  // keep layout stable
  }

  // ── Chat flow ─────────────────────────────────────────────────────────────
  sendBtn.addEventListener("click", sendMessage);

  // SINGLE keydown handler (no inline onkeydown in HTML)
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Optional: don't scroll page when focusing the composer
  input.addEventListener("focus", () => {
    // Do nothing that triggers scroll; keep page stable
  });

  async function sendMessage() {
    if (isSending) return; // guard against double triggers

    const text = input.value.trim();
    if (!text) return;
    isSending = true;

    try {
      const isFirst = !firstMessageSent;

      if (isFirst) {
        intro.style.display = "none";
        firstMessageSent = true;
      }

      // Always append user's message first
      appendUser(text);
      await persist("user", text);
      await summarize("user", text);
      input.value = "";

      // Onboarding: ask first profile question AFTER user's first message (once)
      const needsOnboarding = !userProfileState.profileComplete && isFirst;
      if (needsOnboarding) {
        const q = profileQuestions[0].question;
        appendBot(q);
        await persist("bot", q);
        await summarize("bot", q);
        return;
      }

      // Normal AI flow
      const thinking = createMessage("bot", "…", "thinking");
      messages.appendChild(thinking);
      autoScroll();

      const reply = await generateBotReply(text);
      thinking.remove();
      appendBot(reply);
      await persist("bot", reply);
      await summarize("bot", reply);
    } catch (err) {
      console.error(err);
      appendBot("⚠️ Something went wrong.");
    } finally {
      isSending = false;
    }
  }

  // ── Persistence & Summary ─────────────────────────────────────────────────
  async function persist(sender, text) {
    if (!currentUser) return;
    const ref = doc(db, "users", currentUser.uid, "messages", Date.now().toString());
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
    const { summary } = await res.json();
    userProfileState.conversationSummary = summary;
    await setDoc(uref, { profile: { conversationSummary: summary } }, { merge: true });
  }

  // ── AI Call ────────────────────────────────────────────────────────────────
  async function generateBotReply(userText) {
    const uref = doc(db, "users", currentUser.uid);
    const snap = await getDoc(uref);
    const summary = snap.data()?.profile?.conversationSummary || "";

    const msgsCol = collection(db, "users", currentUser.uid, "messages");
    const q = query(msgsCol, orderBy("timestamp","desc"), limit(5));
    const ds = await getDocs(q);
    const recent = ds.docs.map(d => `${d.data().sender}: ${d.data().text}`)
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

    if (data.profileUpdate && Object.keys(data.profileUpdate).length) {
      Object.assign(userProfileState, data.profileUpdate);
      await setDoc(uref, { profile: userProfileState, updatedAt: serverTimestamp() }, { merge: true });
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

  function appendUser(text){
    messages.appendChild(createMessage("user", text));
    autoScroll();
  }
  function appendBot(text){
    messages.appendChild(createMessage("bot", text));
    autoScroll();
  }
  function autoScroll(){
    messages.scrollTop = messages.scrollHeight;
  }
});
// Auto-scroll till botten om användaren redan är där
function scrollToBottomIfNeeded() {
  const messagesEl = document.getElementById("messages");
  const atBottom =
    messagesEl.scrollHeight - messagesEl.scrollTop <= messagesEl.clientHeight + 10;

  if (atBottom) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

// Kör varje gång ett nytt meddelande läggs till
const messagesEl = document.getElementById("messages");
const observer = new MutationObserver(scrollToBottomIfNeeded);
observer.observe(messagesEl, { childList: true });
// Gör hela input-området klickbart för att börja skriva
document.getElementById("input-area").addEventListener("click", function(e) {
  const textarea = document.getElementById("userInput");
  if (e.target !== textarea) {
    textarea.focus();
  }
});
