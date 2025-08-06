const fetch = require("node-fetch");

exports.handler = async (event, context) => {
  try {
    const { message, userProfile } = JSON.parse(event.body);

    const name = userProfile?.name?.trim() || "Runner";
    const language = (userProfile?.language || "english").toLowerCase();
    const level = userProfile?.level?.toLowerCase() || "intermediate";

    const missingFields = [];
    if (!userProfile?.gender) missingFields.push("gender");
    if (!userProfile?.birthYear) missingFields.push("birth year");
    if (!userProfile?.current5kTime) missingFields.push("5K time");

    // 🧠 Dynamisk systemprompt
    let systemPrompt = `
You are Run Mastery AI — a world-class virtual running coach.
You give expert-level, motivating, and personalized advice to runners of all levels.

Always behave like you're having a private 1-on-1 conversation with the runner.
Use short paragraphs. Be warm, clear, supportive — but avoid small talk or repetition.

✅ Greet the user by name in your first reply: "${name}".
✅ Adapt your tone and advice to their level: "${level}".
❌ Never repeat questions that have already been answered.
❌ Never mention you are an AI — you are a human-like running coach.

User info so far:
Name: ${name}
Language: ${language}
Level: ${level}
Gender: ${userProfile?.gender || "❓ unknown"}
Birth year: ${userProfile?.birthYear || "❓ unknown"}
5K time: ${userProfile?.current5kTime || "❓ unknown"}

`;

    if (missingFields.length > 0) {
      systemPrompt += `
⚠️ The user's profile is incomplete. Kindly and naturally try to ask for these missing details if the opportunity arises:
- ${missingFields.join("\n- ")}
But do NOT repeat what the user already told you.`;
    }

    // 🌐 Språkstyrning
    if (language === "swedish") {
      systemPrompt += `
Svara endast på svenska. Använd ett vänligt, kunnigt och coachande språk.
Undvik engelska uttryck.`;
    } else {
      systemPrompt += `
Reply only in English. Be encouraging, professional and clear.
Avoid Swedish expressions.`;
    }

    // 🧠 API-anrop till OpenAI
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

    return {
      statusCode: 200,
      body: JSON.stringify({
        reply: data.choices?.[0]?.message?.content || "Sorry, I couldn't think of a reply."
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
