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
  const loginBtn     = document.getElementById("loginBtn");
  const chatWrapper  = document.getElementById("chat-wrapper");
  const intro        = document.getElementById("intro");
  const messages     = document.getElementById("messages");
  const inputArea    = document.getElementById("input-area");
  const input        = document.getElementById("userInput");
  const sendBtn      = document.getElementById("sendBtn");
  const userInfo     = document.getElementById("userInfo");
  const userName     = document.getElementById("userName");
  const newThreadBtn = document.getElementById("newThreadBtn");

  // ── State
  let currentUser = null;
  let firstMessageSent = false;
  let isSending = false;
  let lastSendAt = 0;

  // Vilket profilfält väntar vi svar på?
  let pendingProfileKey = null;

  // Debounce state för summaries
  let summarizeTimer = null;
  let summarizeDirty = false;
  let summarizeQueueCount = 0;
  let lastSummaryPayload = null;  // { sender, text }

  const SUMMARY_IDLE_MS = 12000;  // 12s inaktivitet
  const SUMMARY_BATCH_N = 3;      // eller var 3:e meddelande

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

    // Om displayName finns och vi saknar name → använd det direkt
    if (!userProfileState.name && user.displayName) {
      userProfileState.name = user.displayName;
      await setDoc(doc(db, "users", currentUser.uid), { profile: userProfileState }, { merge: true });
    }

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

  // ── New Thread
  if (newThreadBtn) {
    newThreadBtn.addEventListener("click", async () => {
      try {
        // Nollställ lokalt
        messages.innerHTML = "";
        firstMessageSent = false;
        pendingProfileKey = null;

        // Visa intro igen (valfritt)
        if (intro) intro.classList.remove("intro-hidden");

        // Nollställ summary i state + Firestore
        userProfileState.conversationSummary = "";
        if (currentUser) {
          const uref = doc(db, "users", currentUser.uid);
          await setDoc(uref, { profile: { conversationSummary: "" } }, { merge: true });
        }

        appendBot("New conversation started. How can I help you today?");
      } catch (e) {
        console.error("newThread error:", e);
        appendBot("⚠️ Could not start a new conversation. Please try again.");
      }
    });
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
      queueSummarize("user", text); // debounced
      input.value = "";

      // 🆕 Läs in färsk profil innan vi bestämmer nästa steg
      if (currentUser) {
        const fresh = await getDoc(doc(db, "users", currentUser.uid));
        if (fresh.exists() && fresh.data().profile) {
          Object.assign(userProfileState, fresh.data().profile);
        }
      }

      // Om vi väntade på svar för ett specifikt profilfält – spara nu
      if (pendingProfileKey) {
        const val = normalizeAnswer(pendingProfileKey, text);
        if (val !== null) {
          userProfileState[pendingProfileKey] = val;

          // uppdatera display i UI om namnet sattes
          if (pendingProfileKey === "name" && userName) {
            userName.textContent = val;
          }

          await setDoc(doc(db, "users", currentUser.uid), { profile: userProfileState }, { merge: true });
        }
        pendingProfileKey = null;
      }

      // Kolla om profilen nu är komplett
      const requiredFields = ["name", "gender", "birthYear", "level", "weeklySessions", "current5kTime"];
      const missing = requiredFields.filter(f => !userProfileState[f]);
      userProfileState.profileComplete = missing.length === 0;

      // Om inte komplett → fråga precis nästa sak som saknas
      if (!userProfileState.profileComplete) {
        const nextField = profileQuestions.find(q => !userProfileState[q.key]);
        if (nextField) {
          pendingProfileKey = nextField.key;
          appendBot(nextField.question);
          await persist("bot", nextField.question);
          queueSummarize("bot", nextField.question); // debounced
          isSending = false;
          return; // fråga en sak i taget
        }
      }

      // 🚀 Profil komplett → gå direkt till AI-svar (nästa fas)
      const thinking = createMessage("bot", "…", "thinking");
      messages.appendChild(thinking);
      autoScrollIfNeeded(true);

      const reply = await generateBotReply(text);
      thinking.remove();
      appendBot(reply);
      await persist("bot", reply);
      queueSummarize("bot", reply); // debounced
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
    await setDoc(ref, {
      sender,
      text,
      timestamp: serverTimestamp(),
      clientAt: Date.now() // <— stabil lokal tid
    });
  }

  // Debounced summarize wrapper
  function queueSummarize(sender, text) {
    summarizeDirty = true;
    summarizeQueueCount += 1;
    lastSummaryPayload = { sender, text };

    if (summarizeTimer) clearTimeout(summarizeTimer);
    // Triggera direkt om vi nått batch-gräns
    if (summarizeQueueCount >= SUMMARY_BATCH_N) {
      summarizeNow().catch(e => console.warn("summarizeNow err:", e));
      return;
    }
    // Annars vänta på inaktivitet
    summarizeTimer = setTimeout(() => {
      summarizeNow().catch(e => console.warn("summarizeNow err:", e));
    }, SUMMARY_IDLE_MS);
  }

  async function summarizeNow() {
    if (!currentUser || !summarizeDirty || !lastSummaryPayload) return;
    summarizeDirty = false;
    summarizeQueueCount = 0;
    if (summarizeTimer) {
      clearTimeout(summarizeTimer);
      summarizeTimer = null;
    }

    const { sender, text } = lastSummaryPayload;
    lastSummaryPayload = null;

    try {
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
    } catch (e) {
      console.warn("summarizeNow failed:", e);
    }
  }

  // ── AI
  async function generateBotReply(userText) {
    const uref = doc(db, "users", currentUser.uid);
    const snap = await getDoc(uref);
    const summary = snap.data()?.profile?.conversationSummary || "";

    // Hämta senaste meddelanden – sortera robust med fallback till clientAt
    const msgsCol = collection(db, "users", currentUser.uid, "messages");
    const qy = query(msgsCol, orderBy("timestamp","desc"), limit(20));
    const ds = await getDocs(qy);

    // Sortera lokalt: primärt serverTimestamp (kan vara null), sekundärt clientAt
    const sorted = ds.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = a.timestamp?.toMillis?.() || 0;
        const tb = b.timestamp?.toMillis?.() || 0;
        if (tb !== ta) return tb - ta;
        const ca = typeof a.clientAt === "number" ? a.clientAt : 0;
        const cb = typeof b.clientAt === "number" ? b.clientAt : 0;
        return cb - ca;
      });

    const recentList = sorted.slice(0, 5).reverse(); // äldst först i sträng
    const recent = recentList.map(d => `${d.sender}: ${d.text}`).join("\n");

    const res = await fetch("/.netlify/functions/ask-gpt", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        systemSummary:  summary,
        recentMessages: recent,
        message:        userText,
        userProfile:    { ...userProfileState, name: userProfileState.name || (currentUser?.displayName || null) }
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

  // ── Normaliserar profil-svar
  function normalizeAnswer(key, raw) {
    const s = String(raw || "").trim();

    switch (key) {
      case "name":
        return s.length ? s.slice(0, 50) : null;

      case "gender": {
        const g = s.toLowerCase();
        if (["male","man","m","kille","pojke","herr","h"].includes(g)) return "male";
        if (["female","woman","f","tjej","flicka","dam","d"].includes(g)) return "female";
        if (["other","annan","övrigt","non-binary","nb"].includes(g)) return "other";
        return null;
      }

      case "birthYear": {
        const y = parseInt(s, 10);
        return (y >= 1940 && y <= 2015) ? y : null;
      }

      case "level": {
        const l = s.toLowerCase();
        if (["beginner","nybörjare"].includes(l)) return "beginner";
        if (["intermediate","medel","medelvan"].includes(l)) return "intermediate";
        if (["advanced","avancerad","erfaren"].includes(l)) return "advanced";
        return null;
      }

      case "weeklySessions": {
        const n = parseInt(s, 10);
        return (n >= 1 && n <= 14) ? n : null;
      }

      case "current5kTime": {
        const t = s.replace(/\s+/g, "");
        const mmss = /^[0-5]?\d:[0-5]\d$/;          // MM:SS
        const hmmss = /^\d{1,2}:[0-5]?\d:[0-5]\d$/; // H:MM:SS / HH:MM:SS
        if (mmss.test(t)) return `00:${t.padStart(5, "0")}`;
        if (hmmss.test(t)) return t.split(":").map(p => p.padStart(2, "0")).join(":");
        return null;
      }

      // valfritt: fler fält (injuryNotes, raceComingUp etc)
      default:
        return s || null;
    }
  }
});
