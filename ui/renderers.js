// ui/renderers.js
// UI-hjälpare: skriver bubblor, chips, “tänker”-indikator, visual cards,
// autoscroll och fullskärmsläge vid färdig onboarding.

import { els } from "./dom.js";

function createMessage(role, text, extraClass = "") {
  const div = document.createElement("div");
  div.className = `message ${role}${extraClass ? " " + extraClass : ""}`;
  div.textContent = text || "";
  return div;
}

export function appendUser(text) {
  const el = createMessage("user", text);
  els.messages.appendChild(el);
  scrollToBottom(true);
  return el;
}

export function appendBot(text) {
  const el = createMessage("bot", text);
  els.messages.appendChild(el);
  scrollToBottom(true);
  return el;
}

export function appendThinking() {
  const el = document.createElement("div");
  el.className = "message bot";
  el.setAttribute("aria-live", "polite");
  el.innerHTML = `
    <div class="thinking-indicator" role="status" aria-label="AI is typing">
      <span></span><span></span><span></span>
    </div>
  `;
  els.messages.appendChild(el);
  scrollToBottom(true);
  return { remove: () => el.remove() };
}

/** “Streamad” utskrift (simulerad) */
export async function typeOut(fullText) {
  const bubble = createMessage("bot", "");
  els.messages.appendChild(bubble);
  scrollToBottom(true);

  const minDelay = 8,
    maxDelay = 22;
  for (let i = 1; i <= fullText.length; i++) {
    bubble.textContent = fullText.slice(0, i);
    scrollToBottom(false);
    // liten jitter
    await new Promise((r) =>
      setTimeout(r, Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay)
    );
  }
  return bubble;
}

/** Client-side chips: array av strängar */
export function renderChips(bubbleEl, options, onPick) {
  const wrap = document.createElement("div");
  wrap.className = "chip-row";
  wrap.style.display = "flex";
  wrap.style.flexWrap = "wrap";
  wrap.style.gap = "6px";
  wrap.style.marginTop = "8px";

  options.forEach((opt) => {
    const label = String(opt);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      wrap.querySelectorAll("button").forEach((b) => (b.disabled = true));
      onPick(label);
      wrap.remove();
    });
    wrap.appendChild(btn);
  });

  (bubbleEl || els.messages).appendChild(wrap);
  scrollToBottom(true);
}

/** Server-chips: [{label, value}] ELLER ["str"] */
export function renderServerChips(bubbleEl, options, customHandler) {
  const wrap = document.createElement("div");
  wrap.className = "chip-wrapper";
  wrap.style.display = "flex";
  wrap.style.flexWrap = "wrap";
  wrap.style.gap = "6px";
  wrap.style.marginTop = "8px";

  options.forEach((opt) => {
    const label = typeof opt === "string" ? opt : opt.label || opt.value || "";
    const value = typeof opt === "string" ? opt : opt.value ?? opt.label ?? "";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = label;
    btn.addEventListener("click", async () => {
      wrap.querySelectorAll("button").forEach((b) => (b.disabled = true));
      if (typeof customHandler === "function") {
        await customHandler(value);
      } else {
        // default-beteende lämnas till controller (den brukar sätta input och kalla send)
        const ev = new CustomEvent("chip:pick", { detail: { label, value } });
        window.dispatchEvent(ev);
      }
      wrap.remove();
    });
    wrap.appendChild(btn);
  });

  (bubbleEl || els.messages).appendChild(wrap);
  scrollToBottom(true);
}

/** Visual card (titel, text, bullets, CTA-knappar) */
export function renderVisualCard(card) {
  const wrap = document.createElement("div");
  wrap.className = "visual-card";
  const imgHtml = card.image ? `<img src="${escapeHTML(card.image)}" alt="">` : "";
  const bullets =
    Array.isArray(card.bullets) && card.bullets.length
      ? `<ul>${card.bullets.map((b) => `<li>${escapeHTML(b)}</li>`).join("")}</ul>`
      : "";
  const ctas =
    Array.isArray(card.ctas) && card.ctas.length
      ? `<div class="card-ctas">${card.ctas
          .map(
            (c) =>
              `<button class="chip" data-value="${escapeHTML(
                c.value || c.label || ""
              )}">${escapeHTML(c.label || c.value || "OK")}</button>`
          )
          .join("")}</div>`
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
  els.messages.appendChild(wrap);

  wrap.querySelectorAll(".card-ctas .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = btn.getAttribute("data-value") || btn.textContent;
      const ev = new CustomEvent("card:cta", { detail: { label: btn.textContent, value } });
      window.dispatchEvent(ev);
    });
  });

  scrollToBottom(true);
}

export function scrollToBottom(smooth = false) {
  if (!els.messages) return;
  if (smooth && "scrollTo" in els.messages) {
    els.messages.scrollTo({ top: els.messages.scrollHeight, behavior: "smooth" });
  } else {
    els.messages.scrollTop = els.messages.scrollHeight;
  }
}

/** Litet → fullskärm-läge när onboarding är klar */
export function setFullChatMode(enabled) {
  const cls = "chat--full";
  if (!els.chatWrapper) return;
  if (enabled) {
    els.chatWrapper.classList.add(cls);
    document.body.classList.add("chat-full-active");
  } else {
    els.chatWrapper.classList.remove(cls);
    document.body.classList.remove("chat-full-active");
  }
}

// utils
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
}
