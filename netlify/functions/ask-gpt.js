// functions/ask-gpt.js
const fetch = require("node-fetch");

exports.handler = async (event, context) => {
  try {
    // Ta emot både summarien och de senaste meddelandena
    const {
      systemSummary = "",
      recentMessages = "",
      message,
      userProfile
    } = JSON.parse(event.body);

    const name     = userProfile?.name?.trim()       || "Runner";
    const language = (userProfile?.language || "english").toLowerCase();
    const level    = (userProfile?.level    || "intermediate").toLowerCase();
    const agent    = (userProfile?.agent    || "coach").toLowerCase();

    // Bygg system-prompt
    const systemPrompt = `
You are Run Mastery AI — a world-class running coach.

💡 Conversation summary:
${systemSummary}

💬 Recent messages:
${recentMessages}

🎯 Core rules:
- Speak like a warm, practical human coach.
- Keep replies short (1–2 paragraphs).
- Never say you're an AI.
- Never repeat what the user already said.
- Always ask a follow-up question—even after "ok".

👂 If the user gives a brief answer (e.g. "20"), confirm it:
  "So your 5K time is 20 minutes? Awesome. What’s next?"

✅ Greet by name only in your very first reply.

User profile:
- Name: ${name}
- Language: ${language}
- Level: ${level}
- Gender: ${userProfile?.gender    || "unknown"}
- Birth year: ${userProfile?.birthYear || "unknown"}
- 5K time: ${userProfile?.current5kTime  || "unknown"}
- Weekly sessions: ${userProfile?.weeklySessions || "unknown"}
`.trim();

    // Lägg till roll-specifika instruktioner
    let rolePrompt = "";
    switch (agent) {
      case "race-planner":
        rolePrompt = "You're their Race Planner: focus on pacing, tapering, race strategy.";
        break;
      case "strategist":
        rolePrompt = "You're their Mental Strategist: guide mindset, pacing and tactics.";
        break;
      case "nutritionist":
        rolePrompt = "You're their Nutrition Coach: give fueling, hydration and recovery advice.";
        break;
      case "injury-assistant":
        rolePrompt = "You're their Injury Assistant: support safe return to running, no diagnoses.";
        break;
      default:
        rolePrompt = "You're their Training Coach: build consistent, personalized training.";
    }

    // Språkinstruktion
    let langPrompt = "";
    if (language === "swedish") {
      langPrompt = "Svara bara på svenska. Korta, tydliga och coachande meningar.";
    } else {
      langPrompt = "Reply only in English. Keep tone warm, smart, and concise.";
    }

    // Komplett systemprompt
    const fullSystem = [systemPrompt, rolePrompt, langPrompt].join("\n\n");

    // Anropa OpenAI GPT-4
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
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

    if (!response.ok) {
      console.error("OpenAI error:", response.status, await response.text());
      throw new Error("OpenAI API error");
    }

    const data     = await response.json();
    const rawReply = data.choices?.[0]?.message?.content || "";

    // Extrahera profiluppdateringar
    const profileUpdate = {};
    const jsonMatch = rawReply.match(/\[PROFILE UPDATE\]([\s\S]*?)\[\/PROFILE UPDATE\]/);
    if (jsonMatch) {
      try {
        Object.assign(profileUpdate, JSON.parse(jsonMatch[1].trim()));
      } catch (e) {
        console.warn("Failed to parse profile JSON:", e);
      }
    }

    // Rensa ut PROFILE UPDATE-blocket innan klienten visar texten
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
