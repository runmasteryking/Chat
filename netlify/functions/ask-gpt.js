// netlify/functions/ask-gpt.js
import fetch from "node-fetch";

export const handler = async (event) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Server misconfiguration: missing API key" })
      };
    }

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
    }

    const {
      message = "",
      userProfile = {},
      systemSummary = "",
      recentMessages = ""
    } = body;

    if (!message) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing user message" }) };
    }

    // Hitta saknade profilfält
    const requiredFields = ["name", "gender", "birthYear", "level", "weeklySessions", "current5kTime"];
    const missingFields = requiredFields.filter(field => !userProfile[field] || userProfile[field] === "");

    // Systeminstruktion för AI
    const systemPrompt = `
You are a friendly and engaging running coach AI for Run Mastery.
You have access to the user's profile and must only ask for missing details from this profile once.
If profileComplete is true, never ask for personal details again unless the user updates them.
Use conversationSummary for context and recentMessages for continuity.
When replying, confirm and restate user's answers naturally, then move on to next relevant question or training advice.
`;

    // Om profilen är komplett, lägg fokus på coaching
    const conversationContext = `
Profile: ${JSON.stringify(userProfile)}
Conversation summary: ${systemSummary}
Recent messages:
${recentMessages}

Missing fields: ${missingFields.join(", ") || "none"}
`;

    // Kör GPT-anrop
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `${conversationContext}\nUser: ${message}` }
        ],
        temperature: 0.7
      })
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error("OpenAI API error:", openaiRes.status, errText);
      return {
        statusCode: openaiRes.status,
        body: JSON.stringify({ error: "OpenAI API error", detail: errText })
      };
    }

    const data = await openaiRes.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || "";

    // Kolla om svaret innehåller ny profilinfo att spara
    const profileUpdate = {};
    for (const field of requiredFields) {
      if (!userProfile[field] && reply.toLowerCase().includes(field.toLowerCase())) {
        profileUpdate[field] = reply; // enkel variant — kan förbättras
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ reply, profileUpdate })
    };
  } catch (err) {
    console.error("ask-gpt error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Server error", detail: err.message }) };
  }
};
