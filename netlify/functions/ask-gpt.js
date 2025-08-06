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

    // 🧠 KONSTRUKTION AV SYSTEMPROMPT
    let systemPrompt = `
You are Run Mastery AI — a world-class running coach.

🎯 Core rules:
- Speak like a supportive human coach texting a runner.
- Keep replies brief (1–2 short paragraphs), warm and practical.
- NEVER say you're an AI.
- NEVER repeat what the user already said.
- ALWAYS follow up with a relevant question to keep the conversation moving—even after "ok".

👂 If the user gives a short answer (like "20"), confirm it in a friendly way:
"So your 5K time is 20 minutes? Awesome. What are you aiming for next?"

🧠 Language handling:
- If language is "auto", detect from the message.
- Honor explicit switch commands ("switch to English", "byt till svenska") and update.

✅ Greet by name only in your very first reply.

User profile:
- Name: ${name}
- Language: ${language}
- Level: ${level}
- Gender: ${userProfile?.gender || "unknown"}
- Birth year: ${userProfile?.birthYear || "unknown"}
- 5K time: ${userProfile?.current5kTime || "unknown"}
- Weekly sessions: ${userProfile?.weeklySessions || "unknown"}
`.trim();

    if (missingFields.length) {
      systemPrompt += `

🟡 The user's profile is incomplete.
If natural, you may gently ask about:
${missingFields.map(f => `- ${f}`).join("\n")}
But do not repeat already answered items.`;
    }

    // Specialistroll
    switch (agent) {
      case "race-planner":
        systemPrompt += `\nYou're their Race Planner: focus on pacing, tapering, race strategy.`; break;
      case "strategist":
        systemPrompt += `\nYou're their Mental Strategist: guide mindset, pacing plans, tactics.`; break;
      case "nutritionist":
        systemPrompt += `\nYou're their Nutrition Coach: provide fueling, hydration, recovery advice.`; break;
      case "injury-assistant":
        systemPrompt += `\nYou're their Injury Assistant: support safe return to running, no diagnoses.`; break;
      default:
        systemPrompt += `\nYou're their Training Coach: build consistent, personalized training.`; 
    }

    // Språkinstruktioner
    if (language === "swedish") {
      systemPrompt += `\nSvar bara på svenska. Håll det kort, tydligt och coachande utan engelska uttryck.`;
    } else if (language === "english") {
      systemPrompt += `\nReply only in English. Keep tone warm, smart, and concise.`;
    } else {
      systemPrompt += `\nDetect the user's language from their message and reply accordingly.`;
    }

    // Profiluppdateringsblock
    systemPrompt += `

📦 If you learn new info (name, language, gender, birthYear, current5kTime, weeklySessions),
return it only in this JSON block:

[PROFILE UPDATE]
{ "language": "swedish", "current5kTime": "20:00" }
[/PROFILE UPDATE]
`;

    // 📡 Anropa GPT-4
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

    if (!response.ok) {
      console.error("OpenAI error:", response.status, await response.text());
      throw new Error("OpenAI API error");
    }

    const data = await response.json();
    const rawReply = data.choices?.[0]?.message?.content || "Sorry, I couldn't think of a reply.";

    // Extrahera profiluppdateringar
    const profileUpdate = extractProfileFields(rawReply);

    // Rensa ut blocket innan visning
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

  // JSON-block
  const jsonMatch = text.match(/\[PROFILE UPDATE\]([\s\S]*?)\[\/PROFILE UPDATE\]/);
  if (jsonMatch) {
    try {
      Object.assign(profileUpdate, JSON.parse(jsonMatch[1].trim()));
    } catch (e) {
      console.warn("Failed to parse profile JSON:", e);
    }
  }

  // Manuell språkväxling
  const langMatch = text.match(/(?:switch to|byt till|kan vi prata)\s+(english|svenska|swedish)/i);
  if (langMatch) {
    const lang = langMatch[1].toLowerCase();
    profileUpdate.language = lang.startsWith("sv") ? "swedish" : "english";
  }

  return profileUpdate;
}
