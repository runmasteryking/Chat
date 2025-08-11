// services/api.js

/**
 * Skickar ett meddelande till vår Netlify Function (ask-gpt)
 * och returnerar AI-svaret samt ev. uppdaterad profil.
 *
 * @param {string} message - Användarens meddelande
 * @param {object} userProfile - Aktuell användarprofil
 * @param {string} systemSummary - Summerad kontext från tidigare dialog
 * @param {string} recentMessages - De senaste meddelandena i råtext
 * @returns {Promise<{ reply: string, profileUpdate: object }>}
 */
export async function sendMessageToAI(message, userProfile, systemSummary = "", recentMessages = "") {
  try {
    const res = await fetch("/.netlify/functions/ask-gpt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        userProfile,
        systemSummary,
        recentMessages
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("API request failed:", res.status, errorText);
      throw new Error(`AI request failed: ${res.status}`);
    }

    const data = await res.json();
    return {
      reply: data.reply || "Sorry, I didn’t understand that.",
      profileUpdate: data.profileUpdate || {}
    };

  } catch (err) {
    console.error("sendMessageToAI error:", err);
    return {
      reply: "⚠️ There was a problem talking to the AI. Please try again.",
      profileUpdate: {}
    };
  }
}
