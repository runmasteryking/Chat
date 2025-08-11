// netlify/functions/ask-gpt.js

// CommonJS export (matchar ditt summarize-gpt.js)
exports.handler = async (event) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
    if (!apiKey) {
      return json(500, { error: "Server misconfiguration: missing API key" });
    }

    // ── Parse body
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Invalid JSON" });
    }

    const {
      message = "",
      userProfile = {},
      systemSummary = "",
      recentMessages = ""
    } = body;

    if (!message) return json(400, { error: "Missing user message" });

    // ── Missing fields
    const requiredFields = ["name", "gender", "birthYear", "level", "weeklySessions", "current5kTime"];
    const missingFields = requiredFields.filter(
      (f) => !userProfile[f] || userProfile[f] === ""
    );

    // ── System prompt
    const systemPrompt = `
You are a friendly and engaging running coach AI for Run Mastery.
Use the provided profile and ask for missing details at most once.
If profileComplete is true, never ask for personal details again unless the user updates them.
Use conversationSummary for context and recentMessages for continuity.
First, generate a natural-language coaching reply to the user's message (field "reply").
Second, return a "profileUpdate" JSON object that ONLY includes fields that are missing AND were explicitly provided or confirmed by the user in this turn.
Do not guess or infer.
`;

    // ── User/context prompt
    const conversationContext = `
Profile: ${JSON.stringify(userProfile)}
Conversation summary: ${systemSummary}
Recent messages:
${recentMessages}

Missing fields: ${missingFields.join(", ") || "none"}

User: ${message}
`;

    // ── JSON Schema the model must follow
    const jsonSchema = {
      name: "AskGptStructuredResponse",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          reply: { type: "string" },
          profileUpdate: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string", minLength: 1, maxLength: 50 },
              gender: { type: "string", enum: ["male", "female", "other"] },
              birthYear: { type: "integer", minimum: 1940, maximum: 2015 },
              level: { type: "string", enum: ["beginner", "intermediate", "advanced"] },
              weeklySessions: { type: "integer", minimum: 1, maximum: 14 },
              // Accept common formats like "19:52" or "00:19:52"
              current5kTime: { type: "string", pattern: "^(\\d{1,2}:)?[0-5]?\\d:[0-5]\\d$" }
            }
          }
        },
        required: ["reply", "profileUpdate"]
      },
      strict: true
    };

    // ── Call OpenAI
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
        response_format: { type: "json_schema", json_schema: jsonSchema }
      })
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text().catch(() => "");
      console.error("OpenAI API error:", openaiRes.status, errText);
      return json(openaiRes.status, { error: "OpenAI API error", detail: errText });
    }

    const data = await openaiRes.json();
    const content = data?.choices?.[0]?.message?.content || "";

    // ── Parse JSON from model
    let modelObj;
    try {
      modelObj = JSON.parse(content);
    } catch {
      // Fallback: if model didn't honor schema, return raw reply without updates
      const fallbackReply = (typeof content === "string" && content.trim()) ? content.trim() : "";
      return json(200, { reply: fallbackReply || "Ok.", profileUpdate: {} });
    }

    // ── Extract + validate profileUpdate
    const reply = (modelObj.reply || "").toString();
    const rawUpdate = modelObj.profileUpdate || {};
    const sanitizedUpdate = sanitizeProfileUpdate(rawUpdate, userProfile);

    return json(200, { reply, profileUpdate: sanitizedUpdate });

  } catch (err) {
    console.error("ask-gpt error:", err);
    return json(500, { error: "Server error", detail: String(err?.message || err) });
  }
};

// ───────────────────────── helpers ─────────────────────────

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj)
  };
}

function sanitizeProfileUpdate(update, existingProfile) {
  const out = {};
  // Only allow missing fields to be set
  const allowIfMissing = (key) => !existingProfile?.[key];

  if (allowIfMissing("name") && isNonEmptyString(update.name, 50)) out.name = update.name.trim();

  if (allowIfMissing("gender") && ["male", "female", "other"].includes(String(update.gender).toLowerCase())) {
    out.gender = String(update.gender).toLowerCase();
  }

  if (allowIfMissing("birthYear")) {
    const y = toInt(update.birthYear);
    if (y >= 1940 && y <= 2015) out.birthYear = y;
  }

  if (allowIfMissing("level")) {
    const lvl = String(update.level || "").toLowerCase();
    if (["beginner", "intermediate", "advanced"].includes(lvl)) out.level = lvl;
  }

  if (allowIfMissing("weeklySessions")) {
    const ws = toInt(update.weeklySessions);
    if (ws >= 1 && ws <= 14) out.weeklySessions = ws;
  }

  if (allowIfMissing("current5kTime")) {
    const t = String(update.current5kTime || "").trim();
    if (isValidTime(t)) out.current5kTime = normalizeTime(t); // normalize to HH:MM:SS
  }

  return out;
}

function isNonEmptyString(v, maxLen = 100) {
  return typeof v === "string" && v.trim().length > 0 && v.trim().length <= maxLen;
}

function toInt(v) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}

// Accept "MM:SS" or "H:MM:SS"
function isValidTime(s) {
  if (typeof s !== "string") return false;
  const mmss = /^[0-5]?\d:[0-5]\d$/;            // 0-59:00-59
  const hmmss = /^\d{1,2}:[0-5]?\d:[0-5]\d$/;   // H:MM:SS or HH:MM:SS
  return mmss.test(s) || hmmss.test(s);
}

function normalizeTime(s) {
  // convert "MM:SS" -> "00:MM:SS"
  if (/^[0-5]?\d:[0-5]\d$/.test(s)) {
    return `00:${s.padStart(5, "0")}`;
  }
  // already H:MM:SS; ensure HH
  const parts = s.split(":").map((p) => p.padStart(2, "0"));
  if (parts.length === 3) return parts.join(":");
  return s;
}
