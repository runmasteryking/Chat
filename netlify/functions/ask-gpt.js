// functions/ask-gpt.js
const fetch = require("node-fetch");

exports.handler = async (event) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Server misconfiguration: missing API key" })
      };
    }

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
    }
    const {
      systemSummary = "",
      recentMessages = "",
      message = "",
      userProfile = {}
    } = body;
    if (!message) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing user message" }) };
    }

    // Bygg prompts
    const fullSystem = [
      buildBasePrompt(systemSummary, recentMessages),
      buildRolePrompt(userProfile.agent),
      buildLangPrompt(userProfile.language)
    ].filter(Boolean).join("\n\n");

    // Anropa OpenAI med timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [
          { role: "system", content: fullSystem },
          { role: "user",   content: message }
        ],
        temperature: 0.7
      })
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text();
      console.error("OpenAI API error:", res.status, errText);
      return { statusCode: 502, body: JSON.stringify({ error: "Upstream API error" }) };
    }

    const { choices } = await res.json();
    const rawReply = (choices?.[0]?.message?.content || "").trim();
    const profileUpdate = extractProfileUpdate(rawReply);
    const reply = rawReply.replace(/\[PROFILE UPDATE\][\s\S]*?\[\/PROFILE UPDATE\]/g, "").trim();

    return { statusCode: 200, body: JSON.stringify({ reply, profileUpdate }) };
  } catch (err) {
    console.error("🔥 GPT Function error:", err);
    return {
      statusCode: err.name === "AbortError" ? 504 : 500,
      body: JSON.stringify({ error: "Something went wrong." })
    };
  }
};

// ── Hjälpfunktioner ────────────────────────────────────────────
function buildBasePrompt(summary, recent) {
  return `
You are Run Mastery AI — a world-class running coach.

💡 Conversation summary:
${summary}

💬 Recent messages:
${recent}

🎯 Core rules:
- Speak like a warm, practical human coach.
- Keep replies short (1–2 paragraphs).
- Never say you're an AI.
- Never repeat what the user already said.
- Always ask a follow-up question—even after "ok".

👂 If the user gives a brief answer (e.g. "20"), confirm it:
  "So your 5K time is 20 minutes? Awesome. What’s next?"

✅ Greet by name only in your very first reply.
  `.trim();
}

function buildRolePrompt(agent = "coach") {
  switch ((agent || "").toLowerCase()) {
    case "race-planner":   return "You're their Race Planner: focus on pacing, tapering, race strategy.";
    case "strategist":      return "You're their Mental Strategist: guide mindset, pacing and tactics.";
    case "nutritionist":    return "You're their Nutrition Coach: give fueling, hydration and recovery advice.";
    case "injury-assistant":return "You're their Injury Assistant: support safe return to running, no diagnoses.";
    default:                return "You're their Training Coach: build consistent, personalized training.";
  }
}

function buildLangPrompt(lang = "english") {
  return lang.toLowerCase() === "swedish"
    ? "Svara bara på svenska. Korta, tydliga och coachande meningar."
    : "Reply only in English. Keep tone warm, smart, and concise.";
}

function extractProfileUpdate(text) {
  const m = text.match(/\[PROFILE UPDATE\]([\s\S]*?)\[\/PROFILE UPDATE\]/);
  if (!m) return {};
  try {
    return JSON.parse(m[1].trim());
  } catch (e) {
    console.warn("Failed to parse profile JSON:", e);
    return {};
  }
}
