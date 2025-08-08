// netlify/functions/summarize-gpt.js

exports.handler = async (event) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    if (!apiKey) return json(500, { error: "Missing OPENAI_API_KEY" });

    // Parse body
    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch { return json(400, { error: "Invalid JSON" }); }

    const uid = (body.uid || "").toString();          // valfritt (frontend skickar med)
    const prompt = (body.prompt || "").toString();
    if (!prompt) return json(400, { error: "Missing prompt" });

    // Call OpenAI
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a concise summarizer. Max 200 words. Return plain text unless explicitly asked for JSON." },
          { role: "user", content: prompt }
        ],
        temperature: 0.3
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("OpenAI Summarizer error:", res.status, errText, uid ? `(uid: ${uid})` : "");
      return json(res.status, { error: "OpenAI API error", detail: errText });
    }

    const data = await res.json();
    const text = (data.choices?.[0]?.message?.content || "").trim();

    // Try { "summary": "..." } else use text
    let summary = text;
    try {
      const maybe = JSON.parse(text);
      if (maybe && typeof maybe.summary === "string") summary = maybe.summary.trim();
    } catch { /* plain text is fine */ }

    return json(200, { summary, uid });

  } catch (err) {
    console.error("🔥 summarize-gpt.js error:", err);
    return json(500, { error: "Server error", detail: String(err?.message || err) });
  }
};

function json(statusCode, obj) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
