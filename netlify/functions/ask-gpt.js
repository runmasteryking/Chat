// netlify/functions/ask-gpt.js
const fetch = require("node-fetch");
const admin = require("firebase-admin");

// Initiera Firebase Admin SDK (en gång per kallstart)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
  });
}
const db = admin.firestore();

exports.handler = async (event) => {
  try {
    // 1) Hämta och validera API-nycklar
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing OPENAI_API_KEY" }) };
    }
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing FIREBASE_SERVICE_ACCOUNT_KEY" }) };
    }

    // 2) Läs indata
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
    }

    const {
      message = "",
      userId = "",
      userProfile = {},
    } = body;

    if (!message || !userId) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing message or userId" }) };
    }

    // 3) Hämta tidigare konversation & profil från Firestore
    const userRef = db.collection("users").doc(userId);
    const userSnap = await userRef.get();
    let pastMessages = [];
    let profileData = { ...userProfile };

    if (userSnap.exists) {
      const data = userSnap.data();
      pastMessages = data.conversation || [];
      profileData = { ...data.profile, ...userProfile };
    }

    // 4) Lägg till nya meddelandet i historiken
    pastMessages.push({ role: "user", content: message });

    // 5) Bygg systemprompt
    const name     = profileData.name?.trim() || "Runner";
    const language = (profileData.language || "english").toLowerCase();
    const level    = (profileData.level || "intermediate").toLowerCase();
    const agent    = (profileData.agent || "coach").toLowerCase();

    const requiredFields = ["gender","birthYear","current5kTime","weeklySessions"];
    const missingFields  = requiredFields.filter(f => !profileData[f]);

    let systemPrompt = `
You are Run Mastery AI — a world-class running coach.

💡 Conversation so far: ${pastMessages.map(m => `${m.role}: ${m.content}`).join("\n")}

🎯 Rules:
- Speak like a supportive human coach texting a runner.
- Keep replies warm, natural, and practical.
- NEVER say you're an AI.
- NEVER repeat what the user already said.
- ALWAYS follow up with a relevant question.
- If the user gives a short answer, confirm and move forward.
- Greet by name only in your first reply.

User profile:
- Name: ${name}
- Language: ${language}
- Level: ${level}
- Gender: ${profileData.gender || "unknown"}
- Birth year: ${profileData.birthYear || "unknown"}
- 5K time: ${profileData.current5kTime || "unknown"}
- Weekly sessions: ${profileData.weeklySessions || "unknown"}
`.trim();

    if (missingFields.length) {
      systemPrompt += `\n🟡 Missing info: ${missingFields.join(", ")}. Ask naturally if relevant.`;
    }

    const roleMap = {
      "race-planner":    "You're their Race Planner: focus on pacing, tapering, race strategy.",
      "strategist":      "You're their Mental Strategist: guide mindset, pacing and tactics.",
      "nutritionist":    "You're their Nutrition Coach: give fueling, hydration and recovery advice.",
      "injury-assistant":"You're their Injury Assistant: support safe return to running, no diagnoses."
    };
    systemPrompt += `\n${roleMap[agent] || "You're their Training Coach: build consistent, personalized training."}`;

    if (language === "swedish") {
      systemPrompt += `\nSvara bara på svenska. Kortfattat men engagerande.`;
    } else {
      systemPrompt += `\nReply only in English. Warm, smart, concise.`;
    }

    systemPrompt += `\nIf you learn new profile info, output it inside: [PROFILE UPDATE]{...}[/PROFILE UPDATE]`;

    // 6) Skicka till OpenAI
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [
          { role: "system", content: systemPrompt },
          ...pastMessages,
        ],
        temperature: 0.7,
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error("OpenAI API error:", errText);
      return { statusCode: 502, body: JSON.stringify({ error: "OpenAI API error" }) };
    }

    const data = await openaiRes.json();
    const rawReply = (data.choices?.[0]?.message?.content || "").trim();

    // 7) Extrahera ev. profiluppdatering
    const profileUpdate = {};
    const match = rawReply.match(/\[PROFILE UPDATE\]([\s\S]*?)\[\/PROFILE UPDATE\]/);
    if (match) {
      try {
        Object.assign(profileUpdate, JSON.parse(match[1].trim()));
      } catch (e) {
        console.warn("Failed to parse profile update JSON:", e);
      }
    }
    const cleanedReply = rawReply.replace(/\[PROFILE UPDATE\][\s\S]*?\[\/PROFILE UPDATE\]/g, "").trim();

    // 8) Uppdatera Firestore
    const updatedProfile = { ...profileData, ...profileUpdate };
    pastMessages.push({ role: "assistant", content: cleanedReply });

    await userRef.set({
      profile: updatedProfile,
      conversation: pastMessages.slice(-20) // bara spara senaste 20 meddelanden för att hålla nere kontext
    }, { merge: true });

    // 9) Returnera svaret
    return {
      statusCode: 200,
      body: JSON.stringify({ reply: cleanedReply, profileUpdate }),
    };

  } catch (err) {
    console.error("🔥 ask-gpt.js error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Server error" }) };
  }
};
