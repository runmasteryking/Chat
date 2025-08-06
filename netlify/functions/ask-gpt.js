const fetch = require("node-fetch");

exports.handler = async (event, context) => {
  try {
    const { message, userProfile } = JSON.parse(event.body);

    const name = userProfile?.name || "Runner";
    const language = (userProfile?.language || "english").toLowerCase();

    let systemPrompt = `You are a world-class running coach called Run Mastery AI. Speak clearly, supportively, and only reply based on the user's profile and message. Be friendly and smart.`;

    if (language === "swedish") {
      systemPrompt += ` Answer only in Swedish.`;
    } else {
      systemPrompt += ` Answer only in English.`;
    }

    if (userProfile) {
      systemPrompt += `\n\nUser profile:\n${JSON.stringify(userProfile, null, 2)}`;
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: systemPrompt },
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
