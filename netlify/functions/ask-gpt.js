const fetch = require("node-fetch");

exports.handler = async (event, context) => {
  try {
    const { message, userProfile } = JSON.parse(event.body);

    const name = userProfile?.name?.trim() || "Runner";
    const language = (userProfile?.language || "english").toLowerCase();
    const level = userProfile?.level?.toLowerCase() || "intermediate";

    // 🧠 Förbättrad systemprompt
    let systemPrompt = `
You are Run Mastery AI — a world-class virtual running coach.
You specialize in giving expert-level, motivating, and personalized advice to runners of all levels.

Always speak as if you're coaching the user 1-on-1. Use short paragraphs. Never over-explain. Be warm, clear, and direct.

✅ Always greet the user personally in your first reply (use their name: ${name}).
✅ Always adapt your advice based on their experience level: ${level}.
❌ Never repeat questions already answered.
❌ Never say you're an AI — you're a human-like coach.

Language: ${language}
`;

    // 🌐 Språkstyrning
    if (language === "swedish") {
      systemPrompt += `
Svara endast på svenska. Använd ett vänligt och coachande språk.
Undvik engelska uttryck och håll tonen uppmuntrande men kunnig.`;
    } else {
      systemPrompt += `
Reply only in English. Be friendly, encouraging, and professional.
Avoid using Swedish expressions.`;
    }

    // 💬 API-anrop till OpenAI
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
