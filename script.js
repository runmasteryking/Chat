function sendMessage() {
  const input = document.getElementById("userInput");
  const text = input.value.trim();
  if (!text) return;

  const messages = document.getElementById("messages");

  const userMsg = document.createElement("div");
  userMsg.className = "message user";
  userMsg.textContent = text;
  messages.appendChild(userMsg);

  input.value = "";

  const botMsg = document.createElement("div");
  botMsg.className = "message bot";
  botMsg.textContent = generateBotReply(text);
  messages.appendChild(botMsg);
}

function generateBotReply(userText) {
  return "🧠 Thanks! I’m building a personalized plan. Stay tuned!";
}
