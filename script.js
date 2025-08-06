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
  getDoc,
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
const input = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const messages = document.getElementById("messages");

// -------------------------------
// USER PROFILE STATE
// -------------------------------
const userProfileState = {
  gender: null,
  birthYear: null,
  level: null,
  weeklySessions: null,
  current5kTime: null,
  injuryNotes: null,
  raceComingUp: null,
  raceDate: null,
  raceDistance: null,
  profileComplete: false
};

const profileQuestions = [
  { key: "gender", question: "First, what's your gender?" },
  { key: "birthYear", question: "What year were you born?" },
  { key: "level", question: "How experienced are you with running? (beginner, intermediate, advanced)" },
  { key: "weeklySessions", question: "How many times do you run per week on average?" },
  { key: "current5kTime", question: "What’s your current 5K time (or best guess)?" },
  { key: "injuryNotes", question: "Do you currently have any injuries or limitations?" },
  { key: "raceComingUp", question: "Do you have a race coming up?" },
  { key: "raceDate", question: "When is the race? (Please write the date)" },
  { key: "raceDistance", question: "What distance is the race? (e.g. 5K, 10K, half marathon)" }
];

let currentUser = null;
let currentQuestionKey = null;

// -------------------------------
// AUTH LOGIC + FIRESTORE USER SAVE
// -------------------------------
loginBtn.addEventListener("click", () => {
  signInWithPopup(auth, provider)
    .then(async result => {
      const user = result.user;
      currentUser = user;
      console.log("✅ Logged in as", user.displayName);
      await saveUserToFirestore(user);
      showChatUI();
      askNextProfileQuestion();
    })
    .catch(error => {
      console.error("❌ Login failed:", error);
    });
});

onAuthStateChanged(auth, async user => {
  if (user) {
    currentUser = user;
    console.log("🔁 Already logged in as", user.displayName);
    await saveUserToFirestore(user);
    showChatUI();
    askNextProfileQuestion();
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

  if (!userProfileState.profileComplete && currentQuestionKey) {
    userProfileState[currentQuestionKey] = text;
    currentQuestionKey = askNextProfileQuestion();

    if (userProfileState.profileComplete) {
      await setDoc(doc(db, "users", currentUser.uid), {
        profile: userProfileState,
        updatedAt: serverTimestamp()
      }, { merge: true });
      appendMessage("bot", "✅ Thanks! Now let me analyze your goals...");
      requestPlanFromGPT();
    }
    return;
  }

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

function askNextProfileQuestion() {
  for (const q of profileQuestions) {
    if (!userProfileState[q.key]) {
      appendMessage("bot", q.question);
      return q.key;
    }
  }
  userProfileState.profileComplete = true;
  return null;
}

async function requestPlanFromGPT() {
  const userRef = doc(db, "users", currentUser.uid);
  const snapshot = await getDoc(userRef);
  const profile = snapshot.data();

  const response = await fetch('/.netlify/functions/ask-gpt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Create a training plan for this user: ${JSON.stringify(profile)}`
    })
  });

  const data = await response.json();
  appendMessage("bot", data.reply || "Could not generate plan.");
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
