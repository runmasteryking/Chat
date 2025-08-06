const fetch = require("node-fetch");

exports.handler = async (event, context) => {
  try {
    const { message, userProfile } = JSON.parse(event.body);

    const name = userProfile?.name?.trim() || "Runner";
    const language = (userProfile?.language || "english").toLowerCase();
    const level = userProfile?.level?.toLowerCase() || "intermediate";

    // 🔍 Identifiera saknade fält
    const requiredFields = ["gender", "birthYear", "current5kTime", "weeklySessions"];
    const missingFields = requiredFields.filter(field => !userProfile?.[field]);

    // 🧠 Systemprompt
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

    // 🌐 Språkstyrning
    if (language === "swedish") {
      systemPrompt += `
Svara endast på svenska. Använd ett tydligt, varmt och coachande språk.
Undvik engelska uttryck. Du är användarens personliga löparcoach.`;
    } else {
      systemPrompt += `
Reply only in English. Be friendly, professional, and encouraging.
Avoid Swedish expressions.`;
    }

    // 📡 API-anrop till OpenAI
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: systemPrompt.trim() },
          { role: "user", content: message }
        ],
        temperature: 0.7
      })
    });

    const data = await response.json();
    const replyText = data.choices?.[0]?.message?.content || "Sorry, I couldn't think of a reply.";

    // 🧠 Extrahera profiluppdateringar från GPT:s svar
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
// 🔍 Enkelt extraktionsfilter
// -------------------------
function extractProfileFields(text) {
  const profileUpdate = {};
  
  const matchName = text.match(/(?:Your name is|You are called|Hej|Hello)\s([A-ZÅÄÖa-zåäö]+)/);
  const matchLanguage = text.match(/(?:Language:|language is|Språk:)\s([A-Za-zåäöÅÄÖ]+)/);
  const matchGender = text.match(/(?:Gender:|gender is|You are a|Du är en)\s([A-Za-zåäöÅÄÖ]+)/);
  const match5kTime = text.match(/(?:5K|5-kilometer)\s?(?:time|tid)?(?:\s*[:\-–])?\s*(\d{1,2}:?\d{0,2})/);
  const matchBirthYear = text.match(/(?:born in|född\s?)(\d{4})/);
  const matchSessions = text.match(/(?:run|springer)\s?(\d)\s?(?:times|gånger)\s?(?:per week|i veckan)/i);

  if (matchName) profileUpdate.name = matchName[1];
  if (matchLanguage) profileUpdate.language = matchLanguage[1];
  if (matchGender) profileUpdate.gender = matchGender[1];
  if (match5kTime) profileUpdate.current5kTime = match5kTime[1];
  if (matchBirthYear) profileUpdate.birthYear = matchBirthYear[1];
  if (matchSessions) profileUpdate.weeklySessions = matchSessions[1];

  return profileUpdate;
}
