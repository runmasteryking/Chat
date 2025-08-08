// netlify/functions/ask-gpt.js
const fetch = require("node-fetch");
const admin = require("firebase-admin");

// Initiera Firebase Admin en gång
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}
const db = admin.firestore();

exports.handler = async (event) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing API key" }) };
    }

    // 1) Läs indata
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
    }
    const { message = "", uid = "", systemSummary = "", recentMessages = "" } = body;
    if (!message || !uid) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing message or uid" }) };
    }

    // 2) Hämta profil från Firestore
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    let userProfile = {};
    if (userSnap.exists) {
      userProfile = userSnap.data();
    }

    // 3) Grunddata för prompt
    const name     = userProfile.name?.trim() || "Runner";
    const language = (userProfile.language || "english").toLowerCase();
    const level    = (userProfile.level || "intermediate").toLowerCase();
    const agent    = (userProfile.agent || "coach").toLowerCase();

    const requiredFields = ["gender", "birthYear", "current5kTime", "weeklySessions"];
    const missingFields  = requiredFields.filter(f => !userProfile[f]);

    // 4) System-prompt
    let systemPrompt = `
You are Run Mastery AI — a world-class running coach.

💡 Conversation summary:
${systemSummary}

💬 Recent messages:
${recentMessages}

🎯 Core rules:
- Speak like a supportive human coach texting a runner.
- Keep replies brief (1–2 short paragraphs), warm and practical.
- NEVER say you're an AI.
- NEVER repeat what the user already said.
- ALWAYS follow up with a relevant question.
- Remember what the user has told you before and be consistent.

👂 If the user gives a short answer (e.g. "20"), confirm it:
  "So your 5K time is 20 minutes? Awesome. What's next?"

✅ Greet by name only in your first reply.

User profile:
${JSON.stringify(userProfile, null, 2)}
`.trim();

    if (missingFields.length) {
      systemPrompt += `

🟡 The user's profile is incomplete.
If natural, you may gently ask about:
${missingFields.map(f => `- ${f}`).join("\n")}
`;
    }

    // Roll-specifik prompt
    const roleMap = {
      "race-planner":    "You're their Race Planner: focus on pacing, tapering, race strategy.",
      "strategist":       "You're their Mental Strategist: guide mindset, pacing and tactics.",
      "nutritionist":     "You're their Nutrition Coach: give fueling, hydration and recovery advice.",
      "injury-assistant": "You're their Injury Assistant: support safe return to running, no diagnoses."
    };
    const rolePrompt = roleMap[agent] || "You're their Training Coach: build consistent, personalized training.";
    systemPrompt += `\n${rolePrompt}`;

    // Språkinstruktion
    let langPrompt;
    if (language === "swedish") {
      langPrompt = "Svara bara på svenska. Korta, tydliga och coachande meningar.";
    } else if (language === "english") {
      langPrompt = "Reply only in English. Keep tone warm, smart, and concise.";
    } else {
      langPrompt = "Detect the user's language from their message and reply accordingly.";
    }
    systemPrompt += `\n${langPrompt}`;

    // Profiluppdateringsinstruktion
    systemPrompt += `

📦 If you learn new info, return it only in this JSON block:
[PROFILE UPDATE]
{ /* your JSON here */ }
[/PROFILE UPDATE]
`;

    // 5) Anropa OpenAI
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ],
        temperature: 0.7
      })
    });
    clearTimeout(timeoutId);

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error("OpenAI API error:", openaiRes.status, errText);
      return { statusCode: 502, body: JSON.stringify({ error: "Upstream API error" }) };
    }

    const { choices } = await openaiRes.json();
    const rawReply = (choices?.[0]?.message?.content || "").trim();

    // 6) Hantera profiluppdatering
    const profileUpdate = {};
    const match = rawReply.match(/\[PROFILE UPDATE\]([\s\S]*?)\[\/PROFILE UPDATE\]/);
    if (match) {
      try {
        Object.assign(profileUpdate, JSON.parse(match[1].trim()));
      } catch (e) {
        console.warn("Failed to parse profile JSON:", e);
      }
    }

    // Spara uppdaterad profil
    if (Object.keys(profileUpdate).length > 0) {
      await userRef.set({ ...userProfile, ...profileUpdate }, { merge: true });
    }

    // 7) Skicka svar till klienten
    const cleanedReply = rawReply.replace(/\[PROFILE UPDATE\][\s\S]*?\[\/PROFILE UPDATE\]/g, "").trim();

    return {
      statusCode: 200,
      body: JSON.stringify({ reply: cleanedReply, profileUpdate })
    };

  } catch (err) {
    console.error("🔥 GPT Function error:", err);
    return {
      statusCode: err.name === "AbortError" ? 504 : 500,
      body: JSON.stringify({ error: "Something went wrong." })
    };
  }
};
