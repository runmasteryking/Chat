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
  autoScroll();

  const thinking = document.createElement("div");
  thinking.className = "message bot thinking";
  thinking.innerHTML = '<span class="bot-avatar">🤖</span><div class="dot"></div><div class="dot"></div><div class="dot"></div>';
  messages.appendChild(thinking);

  setTimeout(() => {
    thinking.remove();
    const botMsg = document.createElement("div");
    botMsg.className = "message bot";
    botMsg.innerHTML = '<span class="bot-avatar">🤖</span>' + generateBotReply(text);
    messages.appendChild(botMsg);
    autoScroll();
  }, 1000);
}

function autoScroll() {
  const messages = document.getElementById("messages");
  messages.scrollTop = messages.scrollHeight;
}

function generateBotReply(userText) {
  if (/3x|3 times/i.test(userText)) {
    return `Thanks! Here's a week 1 training proposal based on your input:<br><br>
      ✓ Monday: 5K easy run<br>
      ✓ Wednesday: 4×800m intervals<br>
      ✓ Saturday: 8K distance<br><br>
      Want to add rest days, pace targets or race dates?`;
  } else {
    return `🧠 Thanks! I’m building a personalized plan. Would you like to focus on speed, endurance, or injury-free training?`;
  }
}
