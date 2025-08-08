// netlify/functions/ask-gpt.js

exports.handler = async (event) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    if (!apiKey) return json(500, { error: "Missing OPENAI_API_KEY" });

    // Parse body
    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch { return json(400, { error: "Invalid JSON" }); }

    const systemSummary = (body.systemSummary || "").toString();
    const recentMessages = (body.recentMessages || "").toString();
    const message = (body.message || "").toString();
    const userProfile = body.userProfile || {};
    if (!message) return json(400, { error: "Missing message" });

    // Profile fields in request
    const name     = (userProfile.name || "Runner").toString().trim();
    const language = (userProfile.language || "english").toLowerCase();
    const level    = (userProfile.level || "intermediate").toLowerCase();
    const agent    = (userProfile.agent || "coach").toLowerCase();

    const requiredFields = ["gender", "birthYear", "current5kTime", "weeklySessions"];
    const missingFields = requiredFields.filter(f => !userProfile[f]);

    // Role lines
    const roleMap = {
      "race-planner":     "You're their Race Planner: focus on pacing, taper, course strategy, negative splits.",
      "strategist":       "You're their Mental Strategist: mindset cues, in-race decisions, calm under pressure.",
      "nutritionist":     "You're their Nutrition Coach: fueling, hydration, carb loads, gels timing, recovery.",
      "injury-assistant": "You're their Injury Assistant: caution first, modify load, suggest safe progressions. No diagnoses."
    };
    const roleLine = roleMap[agent] || "You're their Training Coach: build consistent, personalized training.";
    const langLine = language === "swedish"
      ? "Svara bara på svenska. Varmt, smart, kortfattat."
      : "Reply only in English. Warm, smart, concise.";

    // Build system prompt as a simple joined string (avoids backtick issues)
    const systemPrompt = [
      "You are Run Mastery AI — a world-class running coach.",
      "",
      "Conversation summary:",
      systemSummary || "(empty)",
      "",
      "Recent messages:",
      recentMessages || "(none)",
      "",
      "Rules:",
      "- Sound like a supportive human coach texting a runner.",
      "- Warm, practical, precise. Avoid fluff.",
      "- Never say you're an AI.",
      "- Never repeat the user's words back.",
      "- Always ask one relevant follow-up question.",
      "- If the user answers briefly, confirm and move forward.",
      "- Greet by name only in your first reply.",
      "",
      "User profile:",
      "- Name: " + name,
      "- Language: " + language,
      "- Level: " + level,
      "- Gender: " + (userProfile.gender || "unknown"),
      "- Birth year: " + (userProfile.birthYear || "unknown"),
      "- 5K time: " + (userProfile.current5kTime || "unknown"),
      "- Weekly sessions: " + (userProfile.weeklySessions || "unknown"),
      (missingFields.length ? "- Missing info: " + missingFields.join(", ") + ". Ask naturally if relevant." : ""),
      "",
      roleLine,
      "",
      langLine,
      "",
      "If you learn new profile info, output it strictly inside:",
      "[PROFILE UPDATE]{",
      '  "name": "string (optional)",',
      '  "language": "swedish|english (optional)",',
      '  "gender": "male|female|other (optional)",',
      '  "birthYear": 1990,',
      '  "level": "beginner|intermediate|advanced (optional)",',
      '  "weeklySessions": 3,',
      '  "current5kTime": "MM:SS",',
      '  "injuryNotes": "string or null",',
      '  "raceComingUp": true|false|null,',
      '  "raceDate": "YYYY-MM-DD" or null,',
      '  "raceDistance": "5k|10k|21k|42k|trail|other" or null,',
      '  "agent": "coach|race-planner|strategist|nutritionist|injury-assistant" (optional)',
      "}[/PROFILE UPDATE]",
      "",
      "Do not include any other JSON. Write normal coaching text outside the update block."
    ].join("\n");

    const messagesForOpenAI = [
      { role: "system", content: systemPrompt },
      { role: "user", content: message }
    ];

    // Call OpenAI with small retry for 429
    const payload = { model, messages: messagesForOpenAI, temperature: 0.7 };
    const data = await chatWithRetry(apiKey, payload, 2);

    const rawReply = ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "").trim();

    // Extract PROFILE UPDATE
    let profileUpdate = {};
    try {
      const match = rawReply.match(/\[PROFILE UPDATE\]([\s\S]*?)\[\/PROFILE UPDATE\]/);
      if (match) profileUpdate = JSON.parse(match[1].trim());
    } catch (e) {
      console.warn("Failed to parse profile update JSON:", e);
    }

    // Normalize to your schema and compute profileComplete against current profile
    const normalizedUpdate = normalizeProfileUpdate(profileUpdate, userProfile);

    const cleanedReply = rawReply
      .replace(/\[PROFILE UPDATE\][\s\S]*?\[\/PROFILE UPDATE\]/g, "")
      .trim();

    return json(200, { reply: cleanedReply, profileUpdate: normalizedUpdate });

  } catch (err) {
    console.error("🔥 ask-gpt.js error:", err);
    return json(500, { error: "Server error", detail: String(err?.message || err) });
  }
};

// --- Helpers ---

function json(statusCode, obj) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

async function chatWithRetry(apiKey, payload, retries) {
  let attempt = 0;
  while (true) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
      body: JSON.stringify(payload)
    });

    if (res.ok) return res.json();

    const errText = await res.text().catch(() => "");
    if (res.status === 429 && attempt < retries) {
      const waitMs = 600 * Math.pow(2, attempt);
      console.warn("429 from OpenAI. Retrying in", waitMs, "ms");
      await new Promise(r => setTimeout(r, waitMs));
      attempt++;
      continue;
    }
    console.error("OpenAI API error:", res.status, errText);
    throw new Error(`OpenAI API error ${res.status}: ${errText}`);
  }
}

function normalizeProfileUpdate(update, current) {
  if (!update || typeof update !== "object") update = {};

  const out = {};

  // Accept multiple spellings and map to your schema
  // Name
  if (isNonEmpty(update.name)) out.name = String(update.name).trim();

  // Language
  if (isNonEmpty(update.language)) {
    const lang = String(update.language).toLowerCase();
    if (["swedish", "english"].includes(lang)) out.language = lang;
  }

  // Gender
  if (isNonEmpty(update.gender)) {
    const g = String(update.gender).toLowerCase();
    if (["male", "female", "other"].includes(g)) out.gender = g;
  }

  // Birth year
  if (update.birthYear !== undefined && update.birthYear !== null) {
    const by = Number(update.birthYear);
    if (Number.isFinite(by) && by > 1900 && by < 2100) out.birthYear = by;
  }

  // Level
  if (isNonEmpty(update.level)) {
    const lvl = String(update.level).toLowerCase();
    if (["beginner", "intermediate", "advanced"].includes(lvl)) out.level = lvl;
  }

  // Weekly sessions
  if (update.weeklySessions !== undefined && update.weeklySessions !== null) {
    const ws = Number(update.weeklySessions);
    if (Number.isFinite(ws) && ws >= 0 && ws <= 14) out.weeklySessions = ws;
  }

  // Current 5k time: allow "5K time", "5k_time", etc.
  const fiveK = update.current5kTime ?? update["5K time"] ?? update["5k_time"] ?? update["5kTime"];
  if (isNonEmpty(fiveK)) {
    const t = String(fiveK).trim();
    // simple sanity: mm:ss or m:ss
    if (/^\d{1,2}:\d{2}$/.test(t)) out.current5kTime = t;
  }

  // Injury notes
  if (update.injuryNotes === null || isNonEmpty(update.injuryNotes)) {
    out.injuryNotes = update.injuryNotes === null ? null : String(update.injuryNotes).trim();
  }

  // Race data
  if (update.raceComingUp !== undefined) {
    if (typeof update.raceComingUp === "boolean" || update.raceComingUp === null) {
      out.raceComingUp = update.raceComingUp;
    }
  }
  if (update.raceDate !== undefined) {
    const rd = update.raceDate === null ? null : String(update.raceDate).trim();
    if (rd === null || /^\d{4}-\d{2}-\d{2}$/.test(rd)) out.raceDate = rd;
  }
  if (update.raceDistance !== undefined) {
    const rd = update.raceDistance === null ? null : String(update.raceDistance).toLowerCase();
    if (rd === null || ["5k","10k","21k","42k","trail","other"].includes(rd)) out.raceDistance = rd;
  }

  // Agent
  if (isNonEmpty(update.agent)) {
    const a = String(update.agent).toLowerCase();
    if (["coach","race-planner","strategist","nutritionist","injury-assistant"].includes(a)) {
      out.agent = a;
    }
  }

  // Compute profileComplete against merged state (current + out)
  const merged = { ...(current || {}), ...out };
  const complete = !!(merged.gender && merged.birthYear && merged.weeklySessions !== undefined && merged.current5kTime);
  out.profileComplete = complete;

  return out;
}

function isNonEmpty(v) {
  return v !== undefined && v !== null && String(v).trim().length > 0;
}
