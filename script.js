/*
 * LEGACY: Denna fil ersätts av modulerna under app/, controllers/ och ui/.
 * Lämnas kvar tills vidare för referens. Använd index.html + app/bootstrap.js.
 */
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
  let pendingProfileKey = null; // vilket profilfält väntar svar?

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

    // Om profilen redan är komplett vid inloggning → hoppa onboarding
    if (userProfileState.profileComplete) {
      typeOutBotMessage(`Welcome back! Ready to pick up where we left off?`);
    } else {
      // annars ställ första saknade frågan med chips
      askNextMissingField();
    }
  }

  async function loadProfile(uid) {
    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);
    if (snap.exists() && snap.data().profile) {
      Object.assign(userProfileState, snap.data().profile);
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
        messages.innerHTML = "";
        firstMessageSent = false;
        pendingProfileKey = null;
        if (intro) intro.classList.remove("intro-hidden");

        userProfileState.conversationSummary = "";
        if (currentUser) {
          const uref = doc(db, "users", currentUser.uid);
          await setDoc(uref, { profile: { conversationSummary: "" } }, { merge: true });
        }

        typeOutBotMessage("New conversation started. How can I help you today?");
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
    const isClickable = e.target.closest(".fab, .chip, .message, .chip-row, .chip-wrapper");
    if (!isClickable) input.focus();
  });

  sendBtn.addEventListener("click", sendMessage);

  // Mutations -> auto-scroll (vi följer alltid flödet)
  const mo = new MutationObserver(() => scrollToBottom(true));
  mo.observe(messages, { childList: true, subtree: true });

  // ─────────────────────────────────────────────────────
  // MAIN SEND
  // ─────────────────────────────────────────────────────
  async function sendMessage() {
    const now = Date.now();
    if (isSending || now - lastSendAt < 350) return;
    lastSendAt = now;

    const text = input.value.trim();
    if (!text) return;

    isSending = true;
    try {
      if (!firstMessageSent) {
        if (intro) intro.classList.add("intro-hidden");
        firstMessageSent = true;
      }

      // Optimistisk render
      appendUser(text);
      const persistPromise = persist("user", text); // spara i bakgrunden
      queueSummarize("user", text);
      input.value = "";

      // 🆕 Läs in färsk profil innan vi bestämmer nästa steg
      if (currentUser) {
        const fresh = await getDoc(doc(db, "users", currentUser.uid));
        if (fresh.exists() && fresh.data().profile) {
          Object.assign(userProfileState, fresh.data().profile);
        }
      }

      // Context-aware: försök tolka profilinfo även om vi inte är i onboarding
      const inferred = tryInferProfileUpdatesFromFreeText(text);
      if (Object.keys(inferred).length) {
        Object.assign(userProfileState, inferred);
        await setDoc(doc(db, "users", currentUser.uid), { profile: userProfileState }, { merge: true });
      }

      // Om vi väntar på ett specifikt fält – spara det direkt
      if (pendingProfileKey) {
        const val = normalizeAnswer(pendingProfileKey, text);
        if (val !== null) {
          userProfileState[pendingProfileKey] = val;
          if (pendingProfileKey === "name" && userName) userName.textContent = val;
          await setDoc(doc(db, "users", currentUser.uid), { profile: userProfileState }, { merge: true });
        }
        pendingProfileKey = null;
      }

      // Kolla nu om profilen är komplett
      const required = ["name","gender","birthYear","level","weeklySessions","current5kTime"];
      const missing = required.filter(f => !userProfileState[f]);
      userProfileState.profileComplete = missing.length === 0;

      if (!userProfileState.profileComplete) {
        // Fråga exakt nästa som saknas + lägg chips
        await askNextMissingField();
        await persistPromise;
        isSending = false;
        return;
      }

      // 🚀 Profil komplett → gå till AI-svar
      const thinking = appendThinkingIndicator();
      const result = await askServerForReply(text); // <— ändrat: vi hämtar HELA objektet
      thinking.remove();

      // rendera reply (streamad) och få tillbaka bubble-elementet
      const bubble = await typeOutBotMessage(result.reply || "Okay.");

      // Spara AI-svaret i bakgrunden
      persist("bot", result.reply || "Okay.");
      queueSummarize("bot", result.reply || "Okay.");
      await persistPromise;

      // uppdatera profil om backend hittade nåt
      if (result.profileUpdate && Object.keys(result.profileUpdate).length) {
        Object.assign(userProfileState, result.profileUpdate);
        await setDoc(doc(db, "users", currentUser.uid), { profile: userProfileState, updatedAt: serverTimestamp() }, { merge: true });
      }

      // quickReplies från backend (chips-array) – rendera under senaste bot-bubble
      if (Array.isArray(result.quickReplies) && result.quickReplies.length) {
        renderServerChips(bubble, result.quickReplies);
      }

      // roleSuggestion — visa chips för roller (coach/nutrition/strength…)
      if (result.roleSuggestion && Array.isArray(result.roleSuggestion.options) && result.roleSuggestion.options.length) {
        renderServerChips(bubble, result.roleSuggestion.options.map(v => ({ label: v, value: v })), async (picked) => {
          // byt roll lokalt och spara
          userProfileState.agent = picked;
          await setDoc(doc(db, "users", currentUser.uid), { profile: userProfileState }, { merge: true });
          appendBot(`Switched role to ${picked}.`);
        });
      }

      // visualCard — t.ex. träningskort
      if (result.visualCard) {
        renderVisualCard(result.visualCard);
      }

      // meta: tags + urgency
      if ((Array.isArray(result.conversationTags) && result.conversationTags.length) || typeof result.urgencyScore === "number") {
        await setDoc(
          doc(db, "users", currentUser.uid),
          { lastConversationMeta: {
              tags: result.conversationTags || [],
              urgency: typeof result.urgencyScore === "number" ? result.urgencyScore : null,
              updatedAt: serverTimestamp()
            }
          },
          { merge: true }
        );
      }

      // nextAction — exekvera enkla åtgärder
      if (result.nextAction && result.nextAction.type) {
        await handleNextAction(result.nextAction);
      }

    } catch (err) {
      console.error(err);
      appendBot(`⚠️ ${err.message || "Something went wrong."}`);
    } finally {
      isSending = false;
    }
  }

  // ─────────────────────────────────────────────────────
  // Kallar backend (ask-gpt) och returnerar HELA svaret
  // ─────────────────────────────────────────────────────
  async function askServerForReply(userText) {
    const uref = doc(db, "users", currentUser.uid);
    const snap = await getDoc(uref);
    const summary = snap.data()?.profile?.conversationSummary || "";

    // Hämta senaste meddelanden – sortera robust med fallback till clientAt
    const msgsCol = collection(db, "users", currentUser.uid, "messages");
    const qy = query(msgsCol, orderBy("timestamp","desc"), limit(20));
    const ds = await getDocs(qy);

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
    // data: { reply, profileUpdate, quickReplies?, roleSuggestion?, visualCard?, nextAction?, conversationTags?, urgencyScore? }
    return data;
  }

  // ─────────────────────────────────────────────────────
  // Onboarding helper – ställ nästa fråga + chips (client-side)
  // ─────────────────────────────────────────────────────
  async function askNextMissingField() {
    // säkerställ färsk profil igen
    if (currentUser) {
      const fresh = await getDoc(doc(db, "users", currentUser.uid));
      if (fresh.exists() && fresh.data().profile) {
        Object.assign(userProfileState, fresh.data().profile);
      }
    }
    const required = ["name","gender","birthYear","level","weeklySessions","current5kTime"];
    const nextField = profileQuestions.find(q => required.includes(q.key) && !userProfileState[q.key]);
    if (!nextField) {
      userProfileState.profileComplete = true;
      await setDoc(doc(db, "users", currentUser.uid), { profile: userProfileState }, { merge: true });
      return;
    }

    pendingProfileKey = nextField.key;

    // Visa fråga + chips
    const text = nextField.question;
    const bubble = appendBot(text);
    persist("bot", text);
    queueSummarize("bot", text);

    // lägg chips under bubble
    const opts = getChipsForKey(nextField.key);
    if (opts && opts.length) {
      renderChips(bubble, opts, async (value) => {
        // rendera användarsvar direkt
        appendUser(value);
        persist("user", value);

        const val = normalizeAnswer(nextField.key, value);
        if (val !== null) {
          userProfileState[nextField.key] = val;
          if (nextField.key === "name" && userName) userName.textContent = val;
          await setDoc(doc(db, "users", currentUser.uid), { profile: userProfileState }, { merge: true });
        }
        pendingProfileKey = null;

        // Kolla om fler saknas
        const stillMissing = required.filter(f => !userProfileState[f]);
        userProfileState.profileComplete = stillMissing.length === 0;

        if (!userProfileState.profileComplete) {
          await askNextMissingField(); // fråga nästa
        } else {
          // Klar onboarding → liten bekräftelse och in i nästa fas
          await typeOutBotMessage("Thanks! I’ve got what I need. Want me to sketch your next week of training?");
        }
      });
    }
  }

  function getChipsForKey(key) {
    switch (key) {
      case "gender":
        return ["Male","Female","Other"];
      case "level":
        return ["Beginner","Intermediate","Advanced"];
      case "weeklySessions":
        return ["2","3","4","5"];
      case "current5kTime":
        return ["19:30","22:00","25:00"];
      default:
        return null; // inga chips för name/birthYear som default
    }
  }

  // ─────────────────────────────────────────────────────
  // Chips-renderers (client + server)
  // ─────────────────────────────────────────────────────
  function renderChips(bubbleEl, options, onPick) {
    const wrap = document.createElement("div");
    wrap.className = "chip-row";
    wrap.style.display = "flex";
    wrap.style.flexWrap = "wrap";
    wrap.style.gap = "6px";
    wrap.style.marginTop = "8px";

    options.forEach(opt => {
      const label = String(opt);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.textContent = label;
      btn.addEventListener("click", () => {
        wrap.querySelectorAll("button").forEach(b => b.disabled = true);
        onPick(label);
        wrap.remove();
      });
      wrap.appendChild(btn);
    });

    (bubbleEl || messages).appendChild(wrap);
    scrollToBottom(true);
  }

  // server-genererade chips: [{label, value}] eller ["string"]
  function renderServerChips(bubbleEl, options, customHandler) {
    const wrap = document.createElement("div");
    wrap.className = "chip-wrapper";
    options.forEach(opt => {
      const label = typeof opt === "string" ? opt : (opt.label || opt.value || "");
      const value = typeof opt === "string" ? opt : (opt.value ?? opt.label ?? "");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.textContent = label;
      btn.addEventListener("click", async () => {
        wrap.querySelectorAll("button").forEach(b => b.disabled = true);
        if (typeof customHandler === "function") {
          await customHandler(value);
        } else {
          // default: skicka som user input
          appendUser(label);
          persist("user", label);
          input.value = value;
          await sendMessage();
        }
        wrap.remove();
      });
      wrap.appendChild(btn);
    });
    (bubbleEl || messages).appendChild(wrap);
    scrollToBottom(true);
  }

  // ─────────────────────────────────────────────────────
  // Visual card renderer
  // ─────────────────────────────────────────────────────
  function renderVisualCard(card) {
    const wrap = document.createElement("div");
    wrap.className = "visual-card";
    const imgHtml = card.image ? `<img src="${card.image}" alt="">` : "";
    const bullets = Array.isArray(card.bullets) && card.bullets.length
      ? `<ul>${card.bullets.map(b => `<li>${escapeHTML(b)}</li>`).join("")}</ul>` : "";
    const ctas = Array.isArray(card.ctas) && card.ctas.length
      ? `<div class="card-ctas">${card.ctas.map(c => `<button class="chip" data-value="${escapeHTML(c.value||c.label||"")}">${escapeHTML(c.label||c.value||"OK")}</button>`).join("")}</div>`
      : "";

    wrap.innerHTML = `
      ${imgHtml}
      <div class="card-body">
        <h4>${escapeHTML(card.title || "Info")}</h4>
        ${card.description ? `<p>${escapeHTML(card.description)}</p>` : ""}
        ${bullets}
        ${ctas}
      </div>
    `;
    messages.appendChild(wrap);

    // CTA-klick
    wrap.querySelectorAll(".card-ctas .chip").forEach(btn => {
      btn.addEventListener("click", async () => {
        const val = btn.getAttribute("data-value") || btn.textContent;
        appendUser(btn.textContent);
        persist("user", btn.textContent);
        input.value = val;
        await sendMessage();
      });
    });

    scrollToBottom(true);
  }

  function escapeHTML(s){
    return String(s).replace(/[&<>"']/g, m => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[m]));
  }

  // ─────────────────────────────────────────────────────
  // nextAction handler (enkla exempel)
  // ─────────────────────────────────────────────────────
  async function handleNextAction(action) {
    switch (action.type) {
      case "startTrainingPlan":
        appendBot("Starting your training plan…");
        // här kan du trigga UI för plan-byggare osv.
        break;
      case "askFollowUp":
        if (action.payload?.question) {
          const bubble = appendBot(action.payload.question);
          // ev. rendera chips från payload.options
          if (Array.isArray(action.payload.options) && action.payload.options.length) {
            renderServerChips(bubble, action.payload.options);
          }
        }
        break;
      default:
        // okänd action → visa som text
        if (action.label) appendBot(action.label);
        break;
    }
  }

  // ─────────────────────────────────────────────────────
  // Persistence & Summary (optimistiskt)
  // ─────────────────────────────────────────────────────
  async function persist(sender, text) {
    if (!currentUser) return;
    const id = Date.now().toString();
    const ref = doc(db, "users", currentUser.uid, "messages", id);
    await setDoc(ref, {
      sender,
      text,
      timestamp: serverTimestamp(),
      clientAt: Date.now() // stabil lokal tid
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

  // ─────────────────────────────────────────────────────
  // UI helpers: typing indicator + “streamad” utskrift
  // ─────────────────────────────────────────────────────
  function appendThinkingIndicator() {
    const el = document.createElement("div");
    el.className = "message bot";
    el.setAttribute("aria-live", "polite");
    el.innerHTML = `
      <div class="thinking-indicator" role="status" aria-label="AI is typing">
        <span></span><span></span><span></span>
      </div>
    `;
    messages.appendChild(el);
    scrollToBottom(true);
    return el;
  }

  async function typeOutBotMessage(fullText) {
    const bubble = createMessage("bot", "");
    messages.appendChild(bubble);
    scrollToBottom(true);

    // streamad utskrift (simulerad)
    const minDelay = 8, maxDelay = 22;
    for (let i = 1; i <= fullText.length; i++) {
      bubble.textContent = fullText.slice(0, i);
      scrollToBottom(false);
      await sleep(rand(minDelay, maxDelay));
    }
    return bubble;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function rand(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

  // ─────────────────────────────────────────────────────
  // Context-aware profiluppdateringar från fritext
  // ─────────────────────────────────────────────────────
  function tryInferProfileUpdatesFromFreeText(s) {
    const out = {};
    if (!s || typeof s !== "string") return out;
    const t = s.toLowerCase();

    // 5k time
    const timeRe = /\b(\d{1,2}):([0-5]\d)(?::([0-5]\d))?\b/; // MM:SS eller H:MM:SS
    const m = t.match(timeRe);
    if (m) {
      const candidate = m[0];
      const norm = normalizeAnswer("current5kTime", candidate);
      if (norm) out.current5kTime = norm;
    }

    // weekly sessions
    const wsRe = /\b(\d{1,2})\s*(pass|pass\/v|pass i veckan|runs|times per week|per week|veckor|vecka)\b/;
    const w = t.match(wsRe);
    if (w) {
      const num = parseInt(w[1], 10);
      const val = normalizeAnswer("weeklySessions", String(num));
      if (val) out.weeklySessions = val;
    }

    // birth year
    const byRe = /\b(19[4-9]\d|200\d|201[0-5])\b/;
    const b = t.match(byRe);
    if (b) {
      const val = normalizeAnswer("birthYear", b[0]);
      if (val) out.birthYear = val;
    }

    // gender keywords
    if (/\b(male|man|kille|pojke|herr)\b/.test(t)) out.gender = "male";
    else if (/\b(female|woman|tjej|flicka|dam)\b/.test(t)) out.gender = "female";
    else if (/\b(other|non-binary|nb|annan)\b/.test(t)) out.gender = "other";

    return out;
  }

  // ─────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────
  function createMessage(type, text, extraClass="") {
    const div = document.createElement("div");
    div.className = `message ${type}` + (extraClass ? ` ${extraClass}` : "");
    div.textContent = text;
    return div;
  }
  function appendUser(text){
    const el = createMessage("user", text);
    messages.appendChild(el);
    scrollToBottom(true);
    return el;
  }
  function appendBot(text){
    const el = createMessage("bot", text);
    messages.appendChild(el);
    scrollToBottom(true);
    return el;
  }

  // Alltid följ flödet
  function scrollToBottom(smooth = false){
    if (smooth && "scrollTo" in messages) {
      messages.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });
    } else {
      messages.scrollTop = messages.scrollHeight;
    }
  }

  // ─────────────────────────────────────────────────────
  // Normaliserar profil-svar
  // ─────────────────────────────────────────────────────
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

      default:
        return s || null;
    }
  }
});
