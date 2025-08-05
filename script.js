const phrases = [
  "reach your goals",
  "beat 10K under 50 mins",
  "build a training plan that fits you",
  "get faster and stronger",
  "train smarter – not harder"
];
let currentPhrase = 0;
const el = document.getElementById("typewriter");

function typeText(text, i = 0) {
  el.textContent = text.slice(0, i);
  if (i < text.length) {
    setTimeout(() => typeText(text, i + 1), 60);
  } else {
    setTimeout(() => eraseText(text.length), 1800);
  }
}

function eraseText(i) {
  el.textContent = phrases[currentPhrase].slice(0, i);
  if (i > 0) {
    setTimeout(() => eraseText(i - 1), 30);
  } else {
    currentPhrase = (currentPhrase + 1) % phrases.length;
    typeText(phrases[currentPhrase]);
  }
}
typeText(phrases[currentPhrase]);

function handleKey(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

async function sendMessage() {
  const input = document.getElementById("userInput");
  const text = input.value.trim();
  if (!text) return;

  const messages = document.getElementById("messages");

  const userMsg = document.createElement("div");
  userMsg.className = "message user";
  userMsg.textContent = text;
  messages.appendChild(userMsg);

  input.value = "";
  autoScroll();

  const thinking = document.createElement("div");
  thinking.className = "message bot thinking";
  thinking.innerHTML = '<span class="bot-avatar">🤖</span><div class="dot"></div><div class="dot"></div><div class="dot"></div>';
  messages.appendChild(thinking);

  try {
    const reply = await generateBotReply(text);
    thinking.remove();

    const botMsg = document.createElement("div");
    botMsg.className = "message bot";
    botMsg.innerHTML = `<span class="bot-avatar">🤖</span>${reply}`;
    messages.appendChild(botMsg);
    autoScroll();
  } catch (err) {
    thinking.remove();
    const botMsg = document.createElement("div");
    botMsg.className = "message bot";
    botMsg.innerHTML = `<span class="bot-avatar">🤖</span>⚠️ Oops! Something went wrong.`;
    messages.appendChild(botMsg);
    autoScroll();
  }
}

function autoScroll() {
  const messages = document.getElementById("messages");
  messages.scrollTop = messages.scrollHeight;
}

async function generateBotReply(userText) {
  const response = await fetch('/.netlify/functions/ask-gpt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: userText })
  });

  const data = await response.json();
  return data.reply || "Sorry, I couldn’t generate a reply.";
}
