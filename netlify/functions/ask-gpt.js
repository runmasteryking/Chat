// netlify/functions/ask-gpt.js
const fetch = require("node-fetch");
const admin = require("firebase-admin");

// Init Firebase Admin om inte redan gjort
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
      recentMessages = "",
      uid // Vi skickar med uid från frontend
    } = body;

    if (!message) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing message" }) };
    }
    if (!uid) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing UID" }) };
    }

    // 🔹 Hämta sparad profil från Firestore
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    let storedProfile = {};
    if (userSnap.exists) {
      storedProfile = userSnap.data()?.profile || {};
    }

    // 🔹 Slå ihop sparad profil med den från frontend
    const mergedProfile = { ...storedProfile, ...userProfile };

    // 🔹 Skapa system prompt med sammanfattning + profil
    const systemPrompt = `
You are a friendly and knowledgeable AI running coach.
Use the user's profile and chat history to give personalized, motivational responses.

User profile:
${JSON.stringify(mergedProfile)}

Conversation summary:
${systemSummary}

Recent messages:
${recentMessages}
`;

    // 🔹 Kör GPT-anrop
    const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ]
      })
    });

    if (!gptRes.ok) {
      const errorText = await gptRes.text();
      throw new Error(`OpenAI API error ${gptRes.status}: ${errorText}`);
    }

    const gptData = await gptRes.json();
    const reply = gptData.choices?.[0]?.message?.content?.trim() || "";

    // 🔹 Här kan vi även be GPT om uppdateringar till profilen
    const profileUpdate = {}; // Placeholder, kan fyllas med AI-logik
    // Exempel: om GPT tolkar ett nytt 5K-tidssvar

    // 🔹 Spara tillbaka i Firestore
    if (Object.keys(profileUpdate).length > 0) {
      const updatedProfile = { ...mergedProfile, ...profileUpdate };
      await userRef.set({ profile: updatedProfile, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ reply, profileUpdate })
    };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
