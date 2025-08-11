// controllers/chat.js
// Wires Enter + Send button, renders messages, and calls the Netlify ask function.

import { els } from "../ui/dom.js";
import {
  appendUser,
  appendBot,
  appendThinking,
  typeOut,
  renderServerChips,
  renderVisualCard,
  setFullChatMode,
  scrollToBottom,
} from "../ui/renderers.js";

import { loadProfile, saveProfile, persistMessage, getRecentMessages, markConversationMeta } from "../services/firebase.js";
import { profileState } from "../state/profileState.js";      // you already have this per your tree
import { persist } from "../state/persistence.js";             // ditto
import { getRequiredMissingKeys } from "../domains/onboarding.js"; // used to know when onboarding is done

let isSending = false;
let lastSendAt = 0;

export async function initChatController() {
  // focus behavior
  els.inputArea?.addEventListener("click", (e) => { if (e.target !== els.input) els.input?.focus(); });
  document.getElementById("chat-wrapper")?.addEventListener("click", (e) => {
    const isClickable = e.target.closest(".fab, .chip, .message, .chip-row, .chip-wrapper");
    if (!isClickable) els.input?.focus();
  });

  // keyboard: Enter to send (Shift+Enter = newline)
  els.input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // click send
  els.sendBtn?.addEventListener("click", handleSend);

  // support server chips + card CTAs
  window.addEventListener("chip:pick", async (ev) => {
    const { label, value } = ev.detail || {};
    appendUser(label);
    persist("user", label);
    els.input.value = value ?? label;
    await handleSend(); // reuse same flow
  });

  window.addEventListener("card:cta", async (ev) => {
    const { label, value } = ev.detail || {};
    appendUser(label);
    persist("user", label);
    els.input.value = value ?? label;
    await handleSend();
  });

  // ensure we start in compact mode (full mode toggled after onboarding finishes)
  setFullChatMode(false);
}

async function handleSend() {
  const now = Date.now();
  if (isSending || now - lastSendAt < 250) return;
  lastSendAt = now;

  const text = (els.input?.value || "").trim();
  if (!text) return;

  isSending = true;

  try {
    // optimistic render + local persist
    appendUser(text);
    els.input.value = "";
    const uid = profileState?.uid || (window.__currentUser && window.__currentUser.uid) || null;

    if (uid) {
      persistMessage(uid, { sender: "user", text, clientAt: Date.now() }).catch(() => {});
    }

    // fetch fresh profile (in case of parallel updates)
    if (uid) {
      const latest = await loadProfile(uid);
      Object.assign(profileState.data, latest);
    }

    // if onboarding not complete, let backend still answer but we’ll toggle full mode once complete
    const thinking = appendThinking();

    // build recent context string
    let recent = "";
    if (uid) {
      const raw = await getRecentMessages(uid, 20);
      const sorted = raw
        .sort((a, b) => {
          const ta = a.timestamp?.toMillis?.() || 0;
          const tb = b.timestamp?.toMillis?.() || 0;
          if (tb !== ta) return tb - ta;
          const ca = typeof a.clientAt === "number" ? a.clientAt : 0;
          const cb = typeof b.clientAt === "number" ? b.clientAt : 0;
          return cb - ca;
        })
        .slice(0, 5)
        .reverse();
      recent = sorted.map((d) => `${d.sender}: ${d.text}`).join("\n");
    }

    const body = {
      systemSummary: profileState.data.conversationSummary || "",
      recentMessages: recent,
      message: text,
      userProfile: {
        ...profileState.data,
        name: profileState.data.name || (window.__currentUser?.displayName || null),
      },
    };

    // call Netlify function
    const res = await fetch("/.netlify/functions/ask-gpt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      thinking.remove();
      appendBot("⚠️ Could not reach AI. Please try again.");
      console.error("ask-gpt failed:", res.status, t);
      return;
    }

    const data = await res.json();
    thinking.remove();

    // print reply
    const bubble = await typeOut(data.reply || "Okay.");

    // persist bot reply
    if (uid) {
      persistMessage(uid, { sender: "bot", text: data.reply || "Okay.", clientAt: Date.now() }).catch(() => {});
    }

    // apply profile update (if any)
    if (data.profileUpdate && Object.keys(data.profileUpdate).length) {
      Object.assign(profileState.data, data.profileUpdate);
      if (uid) await saveProfile(uid, profileState.data);
    }

    // quick replies
    if (Array.isArray(data.quickReplies) && data.quickReplies.length) {
      renderServerChips(bubble, data.quickReplies);
    }

    // role suggestion chips
    if (data.roleSuggestion?.options?.length) {
      renderServerChips(
        bubble,
        data.roleSuggestion.options.map((v) => ({ label: v, value: v })),
        async (picked) => {
          profileState.data.agent = picked;
          if (uid) await saveProfile(uid, profileState.data);
          appendBot(`Switched role to ${picked}.`);
          scrollToBottom(true);
        }
      );
    }

    // optional visual card
    if (data.visualCard) {
      renderVisualCard(data.visualCard);
    }

    // meta (tags, urgency)
    if ((Array.isArray(data.conversationTags) && data.conversationTags.length) || typeof data.urgencyScore === "number") {
      if (uid) await markConversationMeta(uid, { tags: data.conversationTags || [], urgency: data.urgencyScore ?? null });
    }

    // onboarding → toggle full layout when finished
    const missing = getRequiredMissingKeys(profileState.data);
    const onboardingDone = missing.length === 0;
    setFullChatMode(onboardingDone);

  } catch (err) {
    console.error(err);
    appendBot(`⚠️ ${err?.message || "Something went wrong."}`);
  } finally {
    isSending = false;
  }
}
