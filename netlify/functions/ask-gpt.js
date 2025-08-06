const fetch = require("node-fetch");

exports.handler = async (event, context) => {
  try {
    const { message, userProfile } = JSON.parse(event.body);

    const name = userProfile?.name?.trim() || "Runner";
    const language = (userProfile?.language || "english").toLowerCase();
    const level = userProfile?.level?.toLowerCase() || "intermediate";
    const agent = userProfile?.agent?.toLowerCase() || "coach";

    const requiredFields = ["gender", "birthYear", "current5kTime", "weeklySessions"];
    const missingFields = requiredFields.filter(field => !userProfile?.[field]);

    // 🧠 Bas-prompt
    let systemPrompt = `
You are Run Mastery AI — a world-class virtual running coach.
You give motivating, expert-level, and personalized advice to runners of all levels.

Your tone is supportive, smart, and clear. You're having a real conversation 1-on-1 with the runner.

✅ Always greet the user by name: "${name}" — especially in your first reply.
✅ Adapt your advice to their level: "${level}".
✅ Use short paragraphs.
❌ Never repeat questions already answered.
❌ Never say you're an AI — you're their personal running coach.

User profile:
- Name: ${name}
- Language: ${language}
- Level: ${level}
- Gender: ${userProfile?.gender || "❓ unknown"}
- Birth year: ${userProfile?.birthYear || "❓ unknown"}
- 5K time: ${userProfile?.current5kTime || "❓ unknown"}
- Weekly sessions: ${userProfile?.weeklySessions || "❓ unknown"}
`;

    if (missingFields.length > 0) {
      systemPrompt += `
🟡 The user's profile is incomplete.
Gently try to collect missing info if it fits naturally into the conversation:
${missingFields.map(field => `- ${field}`).join("\n")}
But do NOT repeat what the user already told you.`;
    }

    // 👤 Specialistroll (agent)
    switch (agent) {
      case "race-planner":
        systemPrompt += `
🎯 You are now the user's *Race Planner*.
Focus on pacing, tapering, fueling and race-day preparation.`;
        break;
      case "strategist":
        systemPrompt += `
🧠 You are now the user's *Strategist*.
Help with mental tactics, pacing plans and competitive edge.`;
        break;
      case "nutritionist":
        systemPrompt += `
🍽️ You are now the user's *Nutritionist*.
Give advice about fueling, hydration and recovery nutrition.`;
        break;
      case "injury-assistant":
        systemPrompt += `
🩹 You are now the user's *Injury Assistant*.
Help them manage pain, recovery and safe return to training.
Avoid medical diagnosis — be practical and cautious.`;
        break;
      default:
        systemPrompt += `
🏃 You are the user's *Training Coach*.
Focus on programming, structure, consistency and adaptation.`;
    }

    // 🌍 Språk
    if (language === "swedish") {
      systemPrompt += `
Svara endast på svenska. Använd ett tydligt, varmt och coachande språk.
Undvik engelska uttryck.`;
    } else {
      systemPrompt += `
Reply only in English. Be friendly, professional, and encouraging.
Avoid Swedish expressions.`;
    }

    // 🔁 Profiluppdatering via JSON
    systemPrompt += `
If you learn anything new about the user (like gender, birth year or 5K time),
include it inside a [PROFILE UPDATE] ... [/PROFILE UPDATE] block as valid JSON.`;

    // 📡 Anrop till OpenAI GPT-4
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [
          { role: "system", content: systemPrompt.trim() },
          { role: "user", content: message }
        ],
        temperature: 0.7
      })
    });

    const data = await response.json();
    const replyText = data.choices?.[0]?.message?.content || "Sorry, I couldn't think of a reply.";
    const profileUpdate = extractProfileFields(replyText);

    return {
      statusCode: 200,
      body: JSON.stringify({
        reply: replyText,
        profileUpdate
      })
    };

  } catch (err) {
    console.error("🔥 GPT Function error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Something went wrong." })
    };
  }
};

// -------------------------
// 🔍 Profilparser (JSON + regex fallback)
// -------------------------
function extractProfileFields(text) {
  const profileUpdate = {};

  // ✅ Försök extrahera JSON från [PROFILE UPDATE] block
  const jsonMatch = text.match(/\[PROFILE UPDATE\]([\s\S]*?)\[\/PROFILE UPDATE\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      Object.assign(profileUpdate, parsed);
    } catch (err) {
      console.warn("⚠️ Failed to parse profile JSON:", err);
    }
  }

  // ✅ Fallback med regex
  const matchName = text.match(/(?:Your name is|You are called|Hej|Hello)\s([A-ZÅÄÖa-zåäö]+)/);
  const matchLanguage = text.match(/(?:Language:|language is|Språk:)\s([A-Za-zåäöÅÄÖ]+)/);
  const matchGender = text.match(/(?:Gender:|gender is|You are a|Du är en)\s([A-Za-zåäöÅÄÖ]+)/);
  const match5kTime = text.match(/(?:5K|5-kilometer).{0,10}(\d{1,2}:?\d{0,2})/i);
  const matchBirthYear = text.match(/(?:born in|född\s?)(\d{4})/i);
  const matchSessions = text.match(/(?:run|springer|train|pass).{0,10}(\d).{0,10}(?:times|gånger|per week|i veckan)/i);

  if (matchName) profileUpdate.name = matchName[1];
  if (matchLanguage) {
    const lang = matchLanguage[1].toLowerCase();
    profileUpdate.language = lang.includes("svensk") ? "swedish" : "english";
  }
  if (matchGender) {
    const g = matchGender[1].toLowerCase();
    profileUpdate.gender = g === "man" ? "male" : g === "kvinna" ? "female" : g;
  }
  if (match5kTime) profileUpdate.current5kTime = match5kTime[1];
  if (matchBirthYear) profileUpdate.birthYear = matchBirthYear[1];
  if (matchSessions) profileUpdate.weeklySessions = matchSessions[1];

  return profileUpdate;
}
