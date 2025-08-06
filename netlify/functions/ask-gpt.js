const fetch = require("node-fetch");

exports.handler = async (event, context) => {
  try {
    const { message, userProfile } = JSON.parse(event.body);

    const name = userProfile?.name || "Runner";
    const language = (userProfile?.language || "english").toLowerCase();
    const level = userProfile?.level || "intermediate";

    // 🧠 Dynamisk systemprompt
    let systemPrompt = `
You are Run Mastery AI – a world-class virtual running coach.
You specialize in personalized advice for runners of all levels, from beginners to elites.

Your goal is to give expert, motivating and helpful answers — in a supportive and human tone.
You NEVER repeat yourself. You never ask the same question twice. You respond like a coach who truly understands the user.

Speak to the user as if you are their coach in a private conversation.
Use short paragraphs. Be direct but warm. Always consider the user's level.

Name: ${name}
Experience level: ${level}
Language: ${language}
`;

    // 🌐 Språkstyrning
    if (language === "swedish") {
      systemPrompt += `
Svara endast på svenska. Använd ett vänligt, tydligt och coachande språk.
Undvik engelska uttryck.`;
    } else {
      systemPrompt += `
Reply only in English. Be friendly, clear, and supportive.
Avoid using Swedish phrases.`;
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
