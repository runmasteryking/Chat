// -------------------------------
// IMPORTS & FIREBASE INIT
// -------------------------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Firebase-konfiguration
const firebaseConfig = { /* dina creds här */ };
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const db = getFirestore(app);

// -------------------------------
// DOM ELEMENTS
// -------------------------------
const loginBtn    = document.getElementById("loginBtn");
const chatWrapper = document.getElementById("chat-wrapper");
const intro       = document.getElementById("intro");
const input       = document.getElementById("userInput");
const sendBtn     = document.getElementById("sendBtn");
const messages    = document.getElementById("messages");
const userInfo    = document.getElementById("userInfo");
const userName    = document.getElementById("userName");

// -------------------------------
// USER PROFILE STATE
// -------------------------------
const userProfileState = {
  name: null,
  language: null,
  gender: null,
  birthYear: null,
  level: null,
  weeklySessions: null,
  current5kTime: null,
  injuryNotes: null,
  raceComingUp: null,
  raceDate: null,
  raceDistance: null,
  agent: null,
  profileComplete: false
};

const profileQuestions = [
  { key:"name",           question:"What should I call you?" },
  { key:"gender",         question:"What's your gender?" },
  { key:"birthYear",      question:"What year were you born?" },
  { key:"level",          question:"How experienced are you? (beginner, intermediate, advanced)" },
  { key:"weeklySessions", question:"How many times do you run per week?" },
  { key:"current5kTime",  question:"What's your current 5K time?" },
  { key:"injuryNotes",    question:"Any injuries or limitations?" },
  { key:"raceComingUp",   question:"Do you have a race coming up?" },
  { key:"raceDate",       question:"When is the race?" },
  { key:"raceDistance",   question:"What distance is the race?" }
];

let currentUser = null;
let currentQuestionKey = null;
let firstMessageSent = false;
let firstLangHandled  = false;

// -------------------------------
// AUTH + LOAD PROFILE
// -------------------------------
loginBtn.addEventListener("click", () => {
  signInWithPopup(auth, provider)
    .then(async ({ user }) => {
      currentUser = user;
      await loadProfile(user.uid);
      showUserInfo(user);
      showChatUI();
      // Vi frågar inte direkt; vänta på första användar-hälsning
    })
    .catch(err => console.error("Login failed:", err));
});

onAuthStateChanged(auth, async user => {
  if (user) {
    currentUser = user;
    await loadProfile(user.uid);
    showUserInfo(user);
    showChatUI();
  }
});

async function loadProfile(uid) {
  const ref  = doc(db,"users",uid);
  const snap = await getDoc(ref);
  if (snap.exists() && snap.data().profile) {
    Object.assign(userProfileState, snap.data().profile);
  }
  await setDoc(ref, { lastLogin: serverTimestamp(), profile: userProfileState }, { merge:true });
}

// -------------------------------
// SHOW USER INFO
// -------------------------------
function showUserInfo(user) {
  loginBtn.style.display = "none";
  userInfo.style.display = "block";
  userName.textContent = user.displayName || "Runner";
}

// -------------------------------
// UI CONTROL
// -------------------------------
function showChatUI() {
  chatWrapper.style.display = "flex";
  messages.style.display = "flex";
  document.getElementById("input-area").style.display = "flex";
}

// -------------------------------
// TYPEWRITER ANIMATION (oförändrad)
// -------------------------------
// ... behåll din typ-animation ...

// -------------------------------
// CHAT FUNCTIONALITY
// -------------------------------
sendBtn.addEventListener("click", sendMessage);
input.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

async function sendMessage() {
  const text = input.value.trim();
  if (!text) return;

  // Första meddelandet = hälsning
  if (!firstMessageSent) {
    intro.style.display = "none";
    firstMessageSent = true;
    // Be användaren om namn
    currentQuestionKey = profileQuestions[0].key;
    appendMessage("bot", profileQuestions[0].question);
    await saveMsg("bot", profileQuestions[0].question);
    input.value = "";
    return;
  }

  // Visa användartext
  appendMessage("user", text);
  await saveMsg("user", text);
  input.value = "";
  autoScroll();

  // Språkbyte om kommando
  const sw = text.match(/(?:switch to|byt till|prata på)\s+(english|svenska|swedish)/i);
  if (sw) {
    const nl = sw[1].toLowerCase().startsWith("sv") ? "swedish" : "english";
    userProfileState.language = nl;
    await setDoc(doc(db,"users",currentUser.uid),{
      profile: userProfileState, updatedAt: serverTimestamp()
    },{ merge:true });
    appendMessage("bot", nl==="swedish" ? 
      "Nu kör vi på svenska!" : "Alright, switching to English!");
    await saveMsg("bot", messages.lastChild.textContent);
    return;
  }

  // Auto-detect språk första gången
  if (!firstLangHandled && !userProfileState.language) {
    const isSw = /[åäö]|hej|och/i.test(text);
    userProfileState.language = isSw ? "swedish" : "english";
    await setDoc(doc(db,"users",currentUser.uid),{
      profile: userProfileState, updatedAt: serverTimestamp()
    },{ merge:true });
    firstLangHandled = true;
  }

  // Onboarding: spara svar och fråga nästa
  if (!userProfileState.profileComplete && currentQuestionKey) {
    userProfileState[currentQuestionKey] = text;
    await setDoc(doc(db,"users",currentUser.uid),{
      profile: userProfileState, updatedAt: serverTimestamp()
    },{ merge:true });

    // hitta nästa fråga
    const idx = profileQuestions.findIndex(q => q.key === currentQuestionKey);
    if (idx < profileQuestions.length - 1) {
      currentQuestionKey = profileQuestions[idx+1].key;
      const q = profileQuestions[idx+1].question;
      appendMessage("bot", q);
      await saveMsg("bot", q);
    } else {
      userProfileState.profileComplete = true;
    }
    return;
  }

  // När onboarding är klar -> AI-anrop
  const thinking = document.createElement("div");
  thinking.className = "message bot thinking";
  thinking.textContent = "...";
  messages.appendChild(thinking);
  autoScroll();

  try {
    const reply = await generateBotReply(text);
    thinking.remove();
    appendMessage("bot", reply);
    await saveMsg("bot", reply);
  } catch (e) {
    thinking.remove();
    appendMessage("bot", "⚠️ Something went wrong.");
    await saveMsg("bot", "⚠️ Something went wrong.");
    console.error(e);
  }
  autoScroll();
}

// -------------------------------
// MESSAGE HELPERS
// -------------------------------
function appendMessage(type, text) {
  const cleaned = text.replace(/\[PROFILE UPDATE\][\s\S]*?\[\/PROFILE UPDATE\]/g, "").trim();
  if (!cleaned) return;
  const msg = document.createElement("div");
  msg.className = `message ${type}`;
  msg.textContent = cleaned;
  messages.appendChild(msg);
}

function autoScroll() {
  messages.scrollTop = messages.scrollHeight;
}

// -------------------------------
// SAVE FIRESTORE MESSAGE
// -------------------------------
async function saveMsg(sender, text) {
  const ref = doc(db,"users",currentUser.uid,"messages",Date.now().toString());
  await setDoc(ref,{ sender, text, timestamp: serverTimestamp() });
}

// -------------------------------
// GPT CALL + PROFILE UPDATE
// -------------------------------
async function generateBotReply(userText) {
  const res = await fetch('/.netlify/functions/ask-gpt', {
    method: 'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({
      message: userText,
      userProfile:{
        ...userProfileState,
        name: userProfileState.name || currentUser.displayName
      }
    })
  });
  if (!res.ok) {
    console.error('GPT error', res.status, await res.text());
    return '⚠️ AI didn’t respond.';
  }
  const data = await res.json();
  if (data.profileUpdate && Object.keys(data.profileUpdate).length) {
    Object.assign(userProfileState, data.profileUpdate);
    await setDoc(doc(db,"users",currentUser.uid),{
      profile: userProfileState, updatedAt: serverTimestamp()
    },{ merge:true });
  }
  return data.reply || '';
}
