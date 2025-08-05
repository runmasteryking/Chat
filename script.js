// -------------------------------
// IMPORTS & FIREBASE INIT
// -------------------------------
import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Firebase-konfiguration
const firebaseConfig = {
  apiKey: "AIzaSyBx8seK9f-ZTV3JemDQ9sdTZkoiwSTvtqI",
  authDomain: "run-mastery-ai.firebaseapp.com",
  projectId: "run-mastery-ai",
  storageBucket: "run-mastery-ai.appspot.com",
  messagingSenderId: "599923677042",
  appId: "1:599923677042:web:bc968a22483c7b3f916feb"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const db = getFirestore(app);

// -------------------------------
// DOM ELEMENTS
// -------------------------------
const loginBtn = document.getElementById("loginBtn");
const chatWrapper = document.getElementById("chat-wrapper");
const intro = document.getElementById("intro");

// -------------------------------
// AUTH LOGIC + FIRESTORE USER SAVE
// -------------------------------
loginBtn.addEventListener("click", () => {
  signInWithPopup(auth, provider)
    .then(async result => {
      const user = result.user;
      console.log("✅ Logged in as", user.displayName);
      await saveUserToFirestore(user);
      showChatUI();
    })
    .catch(error => {
      console.error("❌ Login failed:", error);
    });
});

onAuthStateChanged(auth, async user => {
  if (user) {
    console.log("🔁 Already logged in as", user.displayName);
    await saveUserToFirestore(user);
    showChatUI();
  }
});

async function saveUserToFirestore(user) {
  const userRef = doc(db, "users", user.uid);
  await setDoc(userRef, {
    name: user.displayName || null,
    email: user.email || null,
    photoURL: user.photoURL || null,
    lastLogin: serverTimestamp()
  }, { merge: true });
}

// -------------------------------
// UI CONTROL
// -------------------------------
function showChatUI() {
  loginBtn.style.display = "none";
  intro.style.display = "none";
  chatWrapper.style.display = "flex";
}

// -------------------------------
// TYPEWRITER ANIMATION
// -------------------------------
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

// -------------------------------
// CHAT FUNCTIONALITY
// -------------------------------
const input = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const messages = document.getElementById("messages");

sendBtn.addEventListener("click", sendMessage);
input.addEventListener("keydown", handleKey);

function handleKey(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text) return;

  appendMessage("user", text);
  input.value = "";
  autoScroll();

  const thinking = document.createElement("div");
  thinking.className = "message bot thinking";
  thinking.innerHTML = '<span class="bot-avatar">🤖</span><div class="dot"></div><div class="dot"></div><div class="dot"></div>';
  messages.appendChild(thinking);
  autoScroll();

  try {
    const reply = await generateBotReply(text);
    thinking.remove();
    appendMessage("bot", reply);
  } catch (err) {
    thinking.remove();
    appendMessage("bot", "⚠️ Oops! Something went wrong.");
    console.error(err);
  }

  autoScroll();
}

function appendMessage(type, text) {
  const msg = document.createElement("div");
  msg.className = `message ${type}`;
  if (type === "bot") {
    msg.innerHTML = `<span class="bot-avatar">🤖</span>${text}`;
  } else {
    msg.textContent = text;
  }
  messages.appendChild(msg);
}

function autoScroll() {
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
