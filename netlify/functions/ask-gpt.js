const fetch = require("node-fetch");

exports.handler = async (event, context) => {
  try {
    const { message, userProfile } = JSON.parse(event.body);

    const name = userProfile?.name?.trim() || "Runner";
    let language = (userProfile?.language || "auto").toLowerCase();
    const level = (userProfile?.level || "intermediate").toLowerCase();
    const agent = (userProfile?.agent || "coach").toLowerCase();

    const requiredFields = ["gender", "birthYear", "current5kTime", "weeklySessions"];
    const missingFields = requiredFields.filter(field => !userProfile?.[field]);

    // -----------------------------
    // 🧠 SYSTEMPROMPT
    // -----------------------------
    let systemPrompt = `
You are Run Mastery AI — a world-class running coach.

🎯 Core rules:
- Act like a human personal trainer texting a runner.
- Keep replies brief (1–2 short paragraphs), warm and practical.
- NEVER say you're an AI.
- NEVER repeat what the user already said.
- ALWAYS keep the conversation moving forward — even if the user just says "ok".

👂 If the user gives a short answer (like "20"), confirm it and rephrase it as part of a friendly reply. Example:
"So your 5K time is 20 minutes? Awesome. What are you aiming for next?"

🧠 Language handling:
- If language is "auto", detect from the user's message (e.g. presence of Swedish words).
- If the user explicitly asks to switch language (e.g. "switch to English" or "byt till svenska"), honor it and update.

✅ Greet the user by name only in your very first reply.

User profile:
- Name: ${name}
- Language: ${language}
- Level: ${level}
- Gender: ${userProfile?.gender || "unknown"}
- Birth year: ${userProfile?.birthYear || "unknown"}
- 5K time: ${userProfile?.current5kTime || "unknown"}
- Weekly sessions: ${userProfile?.weeklySessions || "unknown"}
    `.trim();

    // Ask about missing fields if appropriate
    if (missingFields.length > 0) {
      systemPrompt += `

🟡 The user's profile is incomplete.
If natural, you may gently ask about:
${missingFields.map(f => `- ${f}`).join("\n")}
But do not repeat anything already answered.`;
    }

    // Specialist role
    switch (agent) {
      case "race-planner":
        systemPrompt += `\nYou're acting as their Race Planner. Focus on pacing, tapering, and race-day strategy.`; break;
      case "strategist":
        systemPrompt += `\nYou're their Mental Strategist. Guide mindset, pacing plans, and tactics.`; break;
      case "nutritionist":
        systemPrompt += `\nYou're their Nutrition Coach. Provide fueling, hydration, recovery advice.`; break;
      case "injury-assistant":
        systemPrompt += `\nYou're their Injury Assistant. Support safe return to running, no medical diagnosis.`; break;
      default:
        systemPrompt += `\nYou're their Training Coach. Build consistent, personalized training.`; 
    }

    // Language instructions
    if (language === "swedish") {
      systemPrompt += `\nSvar bara på svenska. Korta, tydliga och coachande meningar utan engelska uttryck.`;
    } else if (language === "english") {
      systemPrompt += `\nReply only in English. Keep tone warm, smart, and concise.`;
    } else {
      systemPrompt += `\nDetect the user's language from their message and reply accordingly.`;
    }

    // Profile update block
    systemPrompt += `

📦 If you learn new user info (name, language, gender, birthYear, current5kTime, weeklySessions),
return it in a JSON block:

[PROFILE UPDATE]
{ "language": "swedish", "current5kTime": "20:00" }
[/PROFILE UPDATE]
`;

    // 📡 Call OpenAI GPT-4
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ],
        temperature: 0.7
      })
    });

    const data = await response.json();
    const rawReply = data.choices?.[0]?.message?.content || "Sorry, I couldn't think of a reply.";

    // Extract profile updates from the reply
    const profileUpdate = extractProfileFields(rawReply);

    // Clean the reply for display
    const cleanedReply = rawReply.replace(/\[PROFILE UPDATE\][\s\S]*?\[\/PROFILE UPDATE\]/g, "").trim();

    return {
      statusCode: 200,
      body: JSON.stringify({ reply: cleanedReply, profileUpdate })
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
// 🔍 EXTRACT PROFILE UPDATES
// -------------------------
function extractProfileFields(text) {
  const profileUpdate = {};

  // JSON block extraction
  const jsonMatch = text.match(/\[PROFILE UPDATE\]([\s\S]*?)\[\/PROFILE UPDATE\]/);
  if (jsonMatch) {
    try {
      Object.assign(profileUpdate, JSON.parse(jsonMatch[1].trim()));
    } catch (e) {
      console.warn("Failed to parse profile JSON:", e);
    }
  }

  // Handle manual language switch
  const langMatch = text.match(/(?:switch to|byt till|kan vi prata)\s+(english|svenska|swedish)/i);
  if (langMatch) {
    const lang = langMatch[1].toLowerCase();
    profileUpdate.language = lang.startsWith("sv") ? "swedish" : "english";
  }

  return profileUpdate;
}
