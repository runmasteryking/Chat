const fetch = require("node-fetch");

exports.handler = async (event, context) => {
  try {
    const { message, userProfile } = JSON.parse(event.body);

    const name = userProfile?.name?.trim() || "Runner";
    let language = (userProfile?.language || "auto").toLowerCase();
    const level = userProfile?.level?.toLowerCase() || "intermediate";
    const agent = userProfile?.agent?.toLowerCase() || "coach";

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
- ALWAYS keep the conversation moving forward — even if user just says "ok".

👂 If the user gives a short answer (like "20"), confirm it and rephrase it as part of a friendly reply. Example:
"So your 5K time is 20 minutes? Awesome. What are you aiming for next?"

🧠 Language detection:
- If language is set to "auto", guess from the user’s message.
- If the user clearly asks to switch language (e.g. "switch to english" or "kan vi prata svenska?") — follow the instruction and update the language accordingly.

✅ Always greet the user by name in your very first reply only.

User profile:
- Name: ${name}
- Language: ${language}
- Level: ${level}
- Gender: ${userProfile?.gender || "❓ unknown"}
- Birth year: ${userProfile?.birthYear || "❓ unknown"}
- 5K time: ${userProfile?.current5kTime || "❓ unknown"}
- Weekly sessions: ${userProfile?.weeklySessions || "❓ unknown"}
    `.trim();

    // Saknade fält
    if (missingFields.length > 0) {
      systemPrompt += `
      
🟡 The user’s profile is incomplete.
If relevant, you may gently ask about:
${missingFields.map(f => `- ${f}`).join("\n")}
But do not repeat things already answered.`;
    }

    // Specialistroll
    switch (agent) {
      case "race-planner":
        systemPrompt += `\nYou're acting as their *Race Planner*. Focus on tapering, pacing, and race-day strategy.`; break;
      case "strategist":
        systemPrompt += `\nYou're their *Mental Strategist*. Focus on mindset, pacing plans and confidence.`; break;
      case "nutritionist":
        systemPrompt += `\nYou're their *Nutrition Coach*. Offer practical advice about fueling, hydration and recovery.`; break;
      case "injury-assistant":
        systemPrompt += `\nYou're their *Injury Assistant*. Support safe return to running. Never diagnose.`; break;
      default:
        systemPrompt += `\nYou're their *Training Coach*. Build consistency, structure, and adaptation.`;
    }

    // Språkhantering
    if (language === "swedish") {
      systemPrompt += `\nSvar bara på svenska. Undvik engelska uttryck. Skriv kort och tydligt.`;
    } else if (language === "english") {
      systemPrompt += `\nReply only in English. Be conversational, smart and encouraging.`;
    } else {
      systemPrompt += `\nDetect the user's preferred language based on their message.`;
    }

    // [PROFILE UPDATE]
    systemPrompt += `
    
📦 If you learn new user info (name, language, gender, birthYear, current5kTime, weeklySessions),
return it in a JSON block like this:

[PROFILE UPDATE]
{ "language": "swedish", "current5kTime": "20:00" }
[/PROFILE UPDATE]
`;

    // GPT-anrop
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
      body: JSON.stringify({ error: "Something went wrong." });
    };
  }
};

// -------------------------
// 🔍 PROFILUPPDATERING
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

  const matchLanguageSwitch = text.match(/(?:switch to|byt till|kan vi prata)\s(english|swedish)/i);
  if (matchLanguageSwitch) {
    const lang = matchLanguageSwitch[1].toLowerCase();
    profileUpdate.language = lang === "swedish" ? "swedish" : "english";
  }

  return profileUpdate;
}
