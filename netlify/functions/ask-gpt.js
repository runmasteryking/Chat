// netlify/functions/ask-gpt.js
const fetch = require("node-fetch");

exports.handler = async (event) => {
  try {
    // 1) Kolla API-nyckel
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing OPENAI_API_KEY" })
      };
    }

    // 2) Läs request-body
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
      return { statusCode: 400, body: JSON.stringify({ error: "Missing message" }) };
    }

    // 3) Extrahera profil
    const name     = (userProfile.name || "Runner").toString().trim();
    const language = (userProfile.language || "english").toLowerCase();
    const level    = (userProfile.level || "intermediate").toLowerCase();
    const agent    = (userProfile.agent || "coach").toLowerCase();

    const requiredFields = ["gender", "birthYear", "current5kTime", "weeklySessions"];
    const missingFields = requiredFields.filter(f => !userProfile[f]);

    // 4) Systemprompt
    const roleMap = {
      "race-planner":     "You're their Race Planner: focus on pacing, taper, course strategy, negative splits.",
      "strategist":       "You're their Mental Strategist: mindset cues, in-race decisions, calm under pressure.",
      "nutritionist":     "You're their Nutrition Coach: fueling, hydration, carb loads, gels timing, recovery.",
      "injury-assistant": "You're their Injury Assistant: caution first, modify load, suggest safe progressions. No diagnoses."
    };

    let systemPrompt = `
You are Run Mastery AI — a world-class running coach.

Conversation summary:
${systemSummary || "(empty)"}

Recent messages:
${recentMessages || "(none)"}

Rules:
- Sound like a supportive human coach texting a runner.
- Warm, practical, precise. Avoid fluff.
- Never say you're an AI.
- Never repeat the user's words back.
- Always ask one relevant follow-up question.
- If the user answers briefly, confirm and move forward.
- Greet by name only in your first reply.

User profile:
- Name: ${name}
- Language: ${language}
- Level: ${level}
- Gender: ${userProfile.gender || "unknown"}
- Birth year: ${userProfile.birthYear || "unknown"}
- 5K time: ${userProfile.current5kTime || "unknown"}
- Weekly sessions: ${userProfile.weeklySessions || "unknown"}
${missingFields.length ? `- Missing info: ${missingFields.join(", ")}. Ask naturally if relevant.` : ""}

${roleMap[agent] || "You're their Training Coach: build consistent, personalized training."}

${
  language === "swedish"
    ? "Svara bara på svenska. Varmt, smart, kortfattat."
    : "Reply only in English. Warm, smart, concise."
}

If you learn new profile info, output it strictly inside:
[PROFILE UPDATE]{ "key": "value", ... }[/PROFILE UPDATE]
`.trim();

    // 5) Skapa meddelanden
    const messagesForOpenAI = [
      { role: "system", content: systemPrompt },
      { role: "user", content: message }
    ];

    // 6) Anropa OpenAI
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: messagesForOpenAI,
        temperature: 0.7
      })
    });

    // 7) Tydlig felhantering
    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error("OpenAI API error:", openaiRes.status, errText);
      return {
        statusCode: openaiRes.status,
        body: JSON.stringify({ error: "OpenAI API error", detail: errText })
      };
    }

    const data = await openaiRes.json();
    const rawReply = (data.choices?.[0]?.message?.content || "").trim();

    // 8) Extrahera ev. profiluppdatering
    let profileUpdate = {};
    const match = rawReply.match(/\[PROFILE UPDATE\]([\s\S]*?)\[\/PROFILE UPDATE\]/);
    if (match) {
      try {
        profileUpdate = JSON.parse(match[1].trim());
      } catch (e) {
        console.warn("Failed to parse profile update JSON:", e);
      }
    }

    const cleanedReply = rawReply.replace(/\[PROFILE UPDATE\][\s\S]*?\[\/PROFILE UPDATE\]/g, "").trim();

    // 9) Returnera
    return {
      statusCode: 200,
      body: JSON.stringify({
        reply: cleanedReply,
        profileUpdate
      })
    };

  } catch (err) {
    console.error("🔥 ask-gpt.js error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Server error", detail: String(err?.message || err) }) };
  }
};
