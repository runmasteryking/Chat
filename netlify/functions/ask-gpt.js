// netlify/functions/ask-gpt.js

exports.handler = async (event) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
    if (!apiKey) return json(500, { error: "Server misconfiguration: missing API key" });

    // Parse body
    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch { return json(400, { error: "Invalid JSON" }); }

    const {
      message = "",
      userProfile = {},
      systemSummary = "",
      recentMessages = ""
    } = body;

    if (!message) return json(400, { error: "Missing user message" });

    const requiredFields = ["name","gender","birthYear","level","weeklySessions","current5kTime"];
    const missingFields = requiredFields.filter(f => !userProfile[f] || userProfile[f] === "");

    const systemPrompt = `
You are a friendly and engaging running coach AI for Run Mastery.
Use the provided profile and ask for missing details at most once.
If profileComplete is true, never ask for personal details again unless the user updates them.
Use conversationSummary for context and recentMessages for continuity.
Return STRICT JSON with two keys:
- "reply": string — your natural-language coaching reply for the user
- "profileUpdate": object — ONLY include fields the user explicitly provided/confirmed in THIS turn (use lowercase enum values)
Do not guess or infer; leave profileUpdate empty if nothing was provided.
`;

    const conversationContext = `
Profile: ${JSON.stringify(userProfile)}
Conversation summary: ${systemSummary}
Recent messages:
${recentMessages}

Missing fields: ${missingFields.join(", ") || "none"}

User: ${message}
`;

    // Call OpenAI with json_object (not json_schema)
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: conversationContext }
        ],
        temperature: 0.7,
        response_format: { type: "json_object" }
      })
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text().catch(() => "");
      console.error("OpenAI API error:", openaiRes.status, errText);
      return json(openaiRes.status, { error: "OpenAI API error", detail: errText });
    }

    const data = await openaiRes.json();
    const content = data?.choices?.[0]?.message?.content || "{}";

    // Parse JSON from model (json_object guarantees JSON)
    let modelObj = {};
    try { modelObj = JSON.parse(content); } catch {}

    const reply = (modelObj.reply || "").toString();
    const rawUpdate = modelObj.profileUpdate || {};
    const sanitizedUpdate = sanitizeProfileUpdate(rawUpdate, userProfile);

    return json(200, { reply: reply || "Ok.", profileUpdate: sanitizedUpdate });
  } catch (err) {
    console.error("ask-gpt error:", err);
    return json(500, { error: "Server error", detail: String(err?.message || err) });
  }
};

// helpers
function json(statusCode, obj) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

function sanitizeProfileUpdate(update, existing) {
  const out = {};
  const allowIfMissing = (k) => !existing?.[k];

  if (allowIfMissing("name") && isNonEmptyString(update.name, 50)) out.name = String(update.name).trim();

  if (allowIfMissing("gender")) {
    const g = String(update.gender || "").toLowerCase();
    if (["male","female","other"].includes(g)) out.gender = g;
  }

  if (allowIfMissing("birthYear")) {
    const y = toInt(update.birthYear);
    if (y >= 1940 && y <= 2015) out.birthYear = y;
  }

  if (allowIfMissing("level")) {
    const lvl = String(update.level || "").toLowerCase();
    if (["beginner","intermediate","advanced"].includes(lvl)) out.level = lvl;
  }

  if (allowIfMissing("weeklySessions")) {
    const ws = toInt(update.weeklySessions);
    if (ws >= 1 && ws <= 14) out.weeklySessions = ws;
  }

  if (allowIfMissing("current5kTime")) {
    const t = String(update.current5kTime || "").trim();
    if (isValidTime(t)) out.current5kTime = normalizeTime(t);
  }

  return out;
}

function isNonEmptyString(v, maxLen = 100) {
  return typeof v === "string" && v.trim().length > 0 && v.trim().length <= maxLen;
}
function toInt(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : NaN; }
function isValidTime(s) {
  if (typeof s !== "string") return false;
  const mmss = /^[0-5]?\d:[0-5]\d$/;
  const hmmss = /^\d{1,2}:[0-5]?\d:[0-5]\d$/;
  return mmss.test(s) || hmmss.test(s);
}
function normalizeTime(s) {
  if (/^[0-5]?\d:[0-5]\d$/.test(s)) return `00:${s.padStart(5,"0")}`;
  const parts = s.split(":").map(p => p.padStart(2,"0"));
  return parts.length === 3 ? parts.join(":") : s;
}
