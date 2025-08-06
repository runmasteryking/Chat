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

    // 🧠 Systemprompt
    let systemPrompt = `
You are Run Mastery AI — a virtual running expert and coach.
You give short, helpful, and human-sounding answers — as if texting a friend.

🟢 Personality:
- Be encouraging and smart
- Use short paragraphs (max 2 lines)
- Avoid repeating the user's name unless it's the first reply
- Never say you're an AI. You're their personal coach.

🟢 User info:
- Name: ${name}
- Language: ${language}
- Level: ${level}
- Gender: ${userProfile?.gender || "❓ unknown"}
- Birth year: ${userProfile?.birthYear || "❓ unknown"}
- 5K time: ${userProfile?.current5kTime || "❓ unknown"}
- Weekly sessions: ${userProfile?.weeklySessions || "❓ unknown"}
`;

    // Samla in saknade fält om möjligt
    if (missingFields.length > 0) {
      systemPrompt += `
The user's profile is incomplete.
If it fits naturally in the conversation, you may ask about:
${missingFields.map(field => `- ${field}`).join("\n")}
But do NOT repeat anything already said.`;
    }

    // Specialistroll
    switch (agent) {
      case "race-planner":
        systemPrompt += `\nYou're the user's Race Planner. Focus on pacing, tapering, and race strategy.`;
        break;
      case "strategist":
        systemPrompt += `\nYou're the user's Mental Strategist. Help with mindset, pacing plans and performance focus.`;
        break;
      case "nutritionist":
        systemPrompt += `\nYou're the user's Nutrition Coach. Give fueling, hydration and recovery tips.`;
        break;
      case "injury-assistant":
        systemPrompt += `\nYou're the user's Injury Assistant. Help with safe return to running, not medical advice.`;
        break;
      default:
        systemPrompt += `\nYou're the user's Training Coach. Focus on building consistent, personalized training.`;
    }

    // Språk
    if (language === "swedish") {
      systemPrompt += `
Svar bara på svenska. Skriv som en coachande person, inte en robot. Korta stycken.`;
    } else {
      systemPrompt += `
Reply only in English. Keep tone natural, smart, brief.`;
    }

    // Profiluppdatering i JSON
    systemPrompt += `
If you learn something new about the runner (like gender, birth year, etc),
include it in a [PROFILE UPDATE]...[/PROFILE UPDATE] block as JSON.`;

    // 📡 GPT-anrop
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
    let rawReply = data.choices?.[0]?.message?.content || "Sorry, I couldn't think of a reply.";

    // Rensa [PROFILE UPDATE] innan visning
    const profileUpdate = extractProfileFields(rawReply);
    const cleanedReply = rawReply.replace(/\[PROFILE UPDATE\][\s\S]*?\[\/PROFILE UPDATE\]/g, "").trim();

    return {
      statusCode: 200,
      body: JSON.stringify({
        reply: cleanedReply,
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
// 🔍 Profilparser (JSON + fallback regex)
// -------------------------
function extractProfileFields(text) {
  const profileUpdate = {};

  const jsonMatch = text.match(/\[PROFILE UPDATE\]([\s\S]*?)\[\/PROFILE UPDATE\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      Object.assign(profileUpdate, parsed);
    } catch (err) {
      console.warn("⚠️ Failed to parse profile JSON:", err);
    }
  }

  // Fallbacks
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
