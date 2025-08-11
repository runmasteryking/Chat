// controllers/chat.js

// ─────────────────────────────────────────────────────────
// Förväntade beroenden (du har/kommer få dessa moduler):
//  - services/firebase.js
//      loadProfile(uid) -> profileObj
//      saveProfile(uid, patch)
//      persistMessage(uid, { sender, text, clientAt })
//      getRecentMessages(uid, n) -> [{sender,text,timestamp,clientAt}, ...]
//      markConversationMeta(uid, { tags, urgency })
//  - services/api.js
//      askGpt({ systemSummary, recentMessages, message, userProfile }) -> 
//        { reply, profileUpdate?, quickReplies?, roleSuggestion?, visualCard?, nextAction?, conversationTags?, urgencyScore? }
//      summarize({ prompt }) -> { summary }
//  - ui/renderers.js
//      appendUser(text) -> el
//      appendBot(text) -> el
//      appendThinking() -> el (med remove())
//      typeOut(text) -> el
//      renderChips(bubbleEl, optionsArray, onPick)
//      renderServerChips(bubbleEl, optionsArrayOrObjects, customHandler?)
//      renderVisualCard(cardObj)
//      scrollToBottom(smooth?)
//      setFullChatMode(enabled:boolean)  // sätter t.ex. .chat--full-klassen
//  - ui/dom.js
//      els: { intro, userName, messages, chatWrapper, input }
//  - utils/normalization.js
//      normalizeAnswer(key, raw), normalizeTime, isValidTime
//  - utils/infer.js
//      inferProfileFromFreeText(text) -> { weeklySessions?, current5kTime?, birthYear?, gender? }
//  - constants/onboarding.js
//      REQUIRED_FIELDS = ["name","gender","birthYear","level","weeklySessions","current5kTime"];
//      PROFILE_QUESTIONS = [{key,question}, ...]
//      getChipsForKey(key) -> array eller null
// ─────────────────────────────────────────────────────────

import * as api from "../services/api.js";
import * as fb from "../services/firebase.js";
import * as r from "../ui/renderers.js";
import { els } from "../ui/dom.js";

import { normalizeAnswer } from "../utils/normalization.js";
import { inferProfileFromFreeText } from "../utils/infer.js";

import { REQUIRED_FIELDS, PROFILE_QUESTIONS, getChipsForKey } from "../constants/onboarding.js";

const SUMMARY_IDLE_MS = 12000; // 12s inaktivitet
const SUMMARY_BATCH_N  = 3;    // var 3:e meddelande

// Modul-lokalt state
let currentUser = null;
let userProfileState = {
  name: null, language: "swedish", gender: null, birthYear: null,
  level: null, weeklySessions: null, current5kTime: null,
  injuryNotes: null, raceComingUp: null, raceDate: null,
  raceDistance: null, agent: "coach", profileComplete: false,
  conversationSummary: ""
};
let pendingProfileKey = null;    // vilket fält väntar vi på?
let firstMessageSent  = false;
let isSending         = false;
let lastSendAt        = 0;

// Debounce-sammanfattning
let summarizeTimer         = null;
let summarizeDirty         = false;
let summarizeQueueCount    = 0;
let lastSummaryPayload     = null; // { sender, text }

// ─────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────
export async function initChat(user) {
  currentUser = user;

  // 1) Ladda profil
  const profile = await fb.loadProfile(currentUser.uid);
  if (profile) {
    userProfileState = { ...userProfileState, ...profile };
  }

  // Har user.displayName men saknar name? -> sätt name
  if (!userProfileState.name && user.displayName) {
    userProfileState.name = user.displayName;
    await fb.saveProfile(currentUser.uid, { name: user.displayName });
  }

  // 2) UI: header-info
  if (els.userName) {
    els.userName.textContent = user.displayName || userProfileState.name || "Runner";
  }

  // 3) Räkna ut profileComplete
  userProfileState.profileComplete = REQUIRED_FIELDS.every(f => !!userProfileState[f]);

  // 4) Visa chat-UI (renderers ansvarar för layout)
  //    Om du har en introsektion – låt den vara tills första meddelandet
  //    (detta matchar tidigare beteende).
  //    Ingen kod behövs här; antas redan vara synligt.

  // 5) Om profil komplett: fullskärmsläge + hälsa
  if (userProfileState.profileComplete) {
    r.setFullChatMode(true);
    await r.typeOut(`Welcome back${userProfileState.name ? ", " + userProfileState.name : ""}! Ready to pick up where we left off?`);
  } else {
    r.setFullChatMode(false);
    askNextMissingField(); // Starta onboarding
  }
}

// ─────────────────────────────────────────────────────────
// Send message (från events.js kallas sendMessage(els.input.value))
// ─────────────────────────────────────────────────────────
export async function sendMessage(rawText) {
  const now = Date.now();
  if (isSending || now - lastSendAt < 350) return;
  lastSendAt = now;

  const text = String(rawText || "").trim();
  if (!text) return;

  isSending = true;
  try {
    if (!firstMessageSent && els.intro) {
      els.intro.classList.add("intro-hidden");
      firstMessageSent = true;
    }

    // Optimistisk: visa + persist user
    r.appendUser(text);
    const persistPromise = fb.persistMessage(currentUser.uid, {
      sender: "user",
      text,
      clientAt: Date.now()
    });
    queueSummarize("user", text);

    // Läs färsk profil igen (om någon annan session uppdaterat)
    const fresh = await fb.loadProfile(currentUser.uid);
    if (fresh) userProfileState = { ...userProfileState, ...fresh };

    // Försök tolka profilinfo från fritext
    const inferred = inferProfileFromFreeText(text);
    if (Object.keys(inferred).length) {
      userProfileState = { ...userProfileState, ...inferred };
      await fb.saveProfile(currentUser.uid, inferred);
      if (inferred.name && els.userName) els.userName.textContent = inferred.name;
    }

    // Väntar vi på ett specifikt fält? Spara direkt
    if (pendingProfileKey) {
      const val = normalizeAnswer(pendingProfileKey, text);
      if (val !== null) {
        userProfileState[pendingProfileKey] = val;
        await fb.saveProfile(currentUser.uid, { [pendingProfileKey]: val });
        if (pendingProfileKey === "name" && els.userName) els.userName.textContent = val;
      }
      pendingProfileKey = null;
    }

    // Kolla profilkomplett
    userProfileState.profileComplete = REQUIRED_FIELDS.every(f => !!userProfileState[f]);

    if (!userProfileState.profileComplete) {
      // Fortsätt onboarding
      await askNextMissingField();
      await persistPromise;
      isSending = false;
      return;
    }

    // Profil komplett → fullskärm (om inte redan)
    r.setFullChatMode(true);

    // Hämta kontext och fråga backend
    const thinking = r.appendThinking();
    const result = await askServerForReply(text);
    thinking.remove();

    // Skriv svaret (simulerad streaming)
    const replyText = result.reply || "Okay.";
    const botBubble = await r.typeOut(replyText);

    // Persist + sammanfattning
    fb.persistMessage(currentUser.uid, { sender: "bot", text: replyText, clientAt: Date.now() });
    queueSummarize("bot", replyText);
    await persistPromise;

    // Profilupdate från backend
    if (result.profileUpdate && Object.keys(result.profileUpdate).length) {
      userProfileState = { ...userProfileState, ...result.profileUpdate };
      await fb.saveProfile(currentUser.uid, { ...result.profileUpdate, updatedAt: Date.now() });
      if (result.profileUpdate.name && els.userName) els.userName.textContent = result.profileUpdate.name;
    }

    // quickReplies
    if (Array.isArray(result.quickReplies) && result.quickReplies.length) {
      r.renderServerChips(botBubble, result.quickReplies);
    }

    // roleSuggestion
    if (result.roleSuggestion?.options?.length) {
      r.renderServerChips(
        botBubble,
        result.roleSuggestion.options.map(v => ({ label: v, value: v })),
        async (picked) => {
          userProfileState.agent = picked;
          await fb.saveProfile(currentUser.uid, { agent: picked });
          r.appendBot(`Switched role to ${picked}.`);
        }
      );
    }

    // visualCard
    if (result.visualCard) {
      r.renderVisualCard(result.visualCard);
    }

    // meta
    const hasTags = Array.isArray(result.conversationTags) && result.conversationTags.length;
    const hasUrg  = typeof result.urgencyScore === "number";
    if (hasTags || hasUrg) {
      await fb.markConversationMeta(currentUser.uid, {
        tags: hasTags ? result.conversationTags : [],
        urgency: hasUrg ? result.urgencyScore : null
      });
    }

    // nextAction
    if (result.nextAction?.type) {
      await handleNextAction(result.nextAction);
    }

  } catch (err) {
    console.error(err);
    r.appendBot(`⚠️ ${err.message || "Something went wrong."}`);
  } finally {
    isSending = false;
  }
}

// ─────────────────────────────────────────────────────────
// Onboarding – fråga nästa fält (med chips)
// ─────────────────────────────────────────────────────────
export async function askNextMissingField() {
  // Färsk profil
  const fresh = await fb.loadProfile(currentUser.uid);
  if (fresh) userProfileState = { ...userProfileState, ...fresh };

  const next = PROFILE_QUESTIONS.find(q => REQUIRED_FIELDS.includes(q.key) && !userProfileState[q.key]);
  if (!next) {
    // Klar!
    userProfileState.profileComplete = true;
    await fb.saveProfile(currentUser.uid, { profileComplete: true });
    // Effektfull övergång till full chat
    r.setFullChatMode(true);
    await r.typeOut("Thanks! I’ve got what I need. Want me to sketch your next week of training?");
    return;
  }

  pendingProfileKey = next.key;

  const bubble = r.appendBot(next.question);
  // föreslagna chips
  const opts = getChipsForKey(next.key);
  if (opts && opts.length) {
    r.renderChips(bubble, opts, async (value) => {
      // Visa användarsvar
      r.appendUser(value);
      fb.persistMessage(currentUser.uid, { sender: "user", text: value, clientAt: Date.now() });

      const val = normalizeAnswer(next.key, value);
      if (val !== null) {
        userProfileState[next.key] = val;
        await fb.saveProfile(currentUser.uid, { [next.key]: val });
        if (next.key === "name" && els.userName) els.userName.textContent = val;
      }
      pendingProfileKey = null;

      // Nästa?
      if (REQUIRED_FIELDS.every(f => !!userProfileState[f])) {
        userProfileState.profileComplete = true;
        await fb.saveProfile(currentUser.uid, { profileComplete: true });
        r.setFullChatMode(true);
        await r.typeOut("Thanks! I’ve got everything I need. Ready to begin?");
      } else {
        await askNextMissingField();
      }
    });
  }
}

// ─────────────────────────────────────────────────────────
// Backend-kall med kontext (hela svaret)
// ─────────────────────────────────────────────────────────
async function askServerForReply(userText) {
  const fresh = await fb.loadProfile(currentUser.uid);
  if (fresh) userProfileState = { ...userProfileState, ...fresh };

  const summary = fresh?.conversationSummary || userProfileState.conversationSummary || "";

  // Hämta senaste 20
  const recentDocs = await fb.getRecentMessages(currentUser.uid, 20);
  // sortera äldst → nyast
  const sorted = [...recentDocs].sort((a, b) => {
    const ta = a.timestamp?.toMillis?.() || a.timestamp || 0;
    const tb = b.timestamp?.toMillis?.() || b.timestamp || 0;
    if (ta !== tb) return ta - tb;
    const ca = typeof a.clientAt === "number" ? a.clientAt : 0;
    const cb = typeof b.clientAt === "number" ? b.clientAt : 0;
    return ca - cb;
  });

  const recent = sorted.slice(-5).map(d => `${d.sender}: ${d.text}`).join("\n");

  const payload = {
    systemSummary: summary,
    recentMessages: recent,
    message: userText,
    userProfile: { ...userProfileState, name: userProfileState.name }
  };

  const data = await api.askGpt(payload);
  return data;
}

// ─────────────────────────────────────────────────────────
// nextAction – enkla exempel
// ─────────────────────────────────────────────────────────
async function handleNextAction(action) {
  switch (action.type) {
    case "startTrainingPlan":
      r.appendBot("Starting your training plan…");
      // TODO: trigga planbyggare UI
      break;
    case "askFollowUp":
      if (action.payload?.question) {
        const bubble = r.appendBot(action.payload.question);
        if (Array.isArray(action.payload.options) && action.payload.options.length) {
          r.renderServerChips(bubble, action.payload.options);
        }
      }
      break;
    default:
      if (action.label) r.appendBot(action.label);
      break;
  }
}

// ─────────────────────────────────────────────────────────
// Sammanfattning (debounced) – återanvänder server-funktion
// ─────────────────────────────────────────────────────────
function queueSummarize(sender, text) {
  summarizeDirty = true;
  summarizeQueueCount += 1;
  lastSummaryPayload = { sender, text };

  if (summarizeTimer) clearTimeout(summarizeTimer);
  if (summarizeQueueCount >= SUMMARY_BATCH_N) {
    summarizeNow().catch(e => console.warn("summarizeNow err:", e));
    return;
  }
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
    // Läs befintlig summary
    const fresh = await fb.loadProfile(currentUser.uid);
    const existing = fresh?.conversationSummary || userProfileState.conversationSummary || "";

    const res = await api.summarize({
      prompt: `Existing summary:\n${existing}\n\n${sender}: ${text}\n\nUpdate summary (<=200 words):`
    });

    const summary = res?.summary || existing;
    userProfileState.conversationSummary = summary;
    await fb.saveProfile(currentUser.uid, { conversationSummary: summary });
  } catch (e) {
    console.warn("summarizeNow failed:", e);
  }
}

// ─────────────────────────────────────────────────────────
// Hjälpmetod om du vill trigga fullskärm från andra ställen
// ─────────────────────────────────────────────────────────
export function forceFullChatMode() {
  r.setFullChatMode(true);
}

// (valfritt) enkel getter för profil i UI/debug
export function getProfile() {
  return { ...userProfileState };
}
