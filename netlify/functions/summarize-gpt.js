// functions/summarize-gpt.js
const fetch = require("node-fetch");

exports.handler = async (event) => {
  try {
    const { prompt } = JSON.parse(event.body);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [
          { role: "system", content: "You are a concise summarizer. Keep to 200 words max." },
          { role: "user",   content: prompt }
        ],
        temperature: 0.5
      })
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    // Antag att GPT svarar med: { "summary": "..." }
    // Om inte, plocka hela texten som summary
    const text = data.choices[0].message.content.trim();
    // Förväntat format: { "summary": "..." }
    let summary = text;
    try {
      const obj = JSON.parse(text);
      summary = obj.summary || summary;
    } catch {}
    return {
      statusCode: 200,
      body: JSON.stringify({ summary })
    };
  } catch (err) {
    console.error("Summarizer error:", err);
    return { statusCode: 500, body: "" };
  }
};
