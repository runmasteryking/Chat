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
  { key:"name",          question:"What should I call you?" },
  { key:"gender",        question:"What's your gender?" },
  { key:"birthYear",     question:"What year were you born?" },
  { key:"level",         question:"Your running experience? (beginner/intermediate/advanced)" },
  { key:"weeklySessions",question:"How many runs per week?" },
  { key:"current5kTime", question:"Current 5K time?" },
  { key:"injuryNotes",   question:"Any injuries or limitations?" },
  { key:"raceComingUp",  question:"Do you have a race coming up?" },
  { key:"raceDate",      question:"When is the race?" },
  { key:"raceDistance",  question:"Race distance? (e.g. 5K, 10K)" }
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
      askNextProfileQuestion();
    })
    .catch(err => console.error("Login failed:", err));
});

onAuthStateChanged(auth, async user => {
  if (user) {
    currentUser = user;
    await loadProfile(user.uid);
    showUserInfo(user);
    showChatUI();
    askNextProfileQuestion();
  }
});

async function loadProfile(uid) {
  const ref  = doc(db,"users",uid);
  const snap = await getDoc(ref);
  if (snap.exists() && snap.data().profile) {
    Object.assign(userProfileState, snap.data().profile);
  }
  // update lastLogin
  await setDoc(ref, { lastLogin: serverTimestamp(), profile: userProfileState }, { merge:true });
}

// -------------------------------
// SHOW USER INFO
// -------------------------------
function showUserInfo(user) {
  loginBtn.style.display = "none";
  userInfo.style.display = "block";
  userName.textContent = user.displayName;
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
// TYPEWRITER ANIMATION
// -------------------------------
const phrases = ["reach your goals","beat 10K under 50 mins","build a plan","get faster","train smarter"];
let currentPhrase=0;
const el=document.getElementById("typewriter");
(function typeText(t,i=0){
  el.textContent=t.slice(0,i);
  if(i<t.length) setTimeout(()=>typeText(t,i+1),60);
  else setTimeout(()=>eraseText(t.length),1800);
})(phrases[0]);
function eraseText(i){
  el.textContent=phrases[currentPhrase].slice(0,i);
  if(i>0) setTimeout(()=>eraseText(i-1),30);
  else{currentPhrase=(currentPhrase+1)%phrases.length;typeText(phrases[currentPhrase]);}
}

// -------------------------------
// CHAT
// -------------------------------
sendBtn.addEventListener("click",sendMessage);
input.addEventListener("keydown",e=>{
  if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();}
});

async function sendMessage(){
  const text=input.value.trim(); if(!text) return;
  if(!firstMessageSent){ intro.style.display="none"; firstMessageSent=true; }
  appendMessage("user",text);
  input.value=""; autoScroll();
  await saveMsg("user",text);

  // Language switch command?
  const sw=text.match(/(?:switch to|byt till|prata på)\s+(english|svenska|swedish)/i);
  if(sw){
    const nl=sw[1].toLowerCase().startsWith("sv")?"swedish":"english";
    userProfileState.language=nl;
    await setDoc(doc(db,"users",currentUser.uid),{
      profile:userProfileState,updatedAt:serverTimestamp()
    },{merge:true});
    appendMessage("bot",nl==="swedish"?"Nu pratar vi svenska!":"Sure, switching to English!");
    return;
  }
  // auto-detect first message
  if(!firstLangHandled&&!userProfileState.language){
    const isSw=/[åäö]|hej|och/i.test(text);
    userProfileState.language=isSw?"swedish":"english";
    await setDoc(doc(db,"users",currentUser.uid),{
      profile:userProfileState,updatedAt:serverTimestamp()
    },{merge:true});
    firstLangHandled=true;
  }

  // Onboarding
  if(!userProfileState.profileComplete && currentQuestionKey){
    userProfileState[currentQuestionKey]=text;
    await setDoc(doc(db,"users",currentUser.uid),{
      profile:userProfileState,updatedAt:serverTimestamp()
    },{merge:true});
    currentQuestionKey=askNextProfileQuestion(); return;
  }

  // GPT
  const thinking=document.createElement("div");
  thinking.className="message bot thinking";
  thinking.innerHTML='<span class="bot-avatar">🤖</span><div class="dot"></div><div class="dot"></div><div class="dot"></div>';
  messages.appendChild(thinking); autoScroll();

  try{
    const reply=await generateBotReply(text);
    thinking.remove();
    appendMessage("bot",reply);
    await saveMsg("bot",reply);
  }catch(e){
    thinking.remove();
    appendMessage("bot","⚠️ Something went wrong.");
    await saveMsg("bot","⚠️ Something went wrong.");
    console.error(e);
  }
  autoScroll();
}

function appendMessage(type,text){
  const clean=text.replace(/\[PROFILE UPDATE\][\s\S]*?\[\/PROFILE UPDATE\]/g,"").trim();
  if(!clean) return;
  const msg=document.createElement("div");
  msg.className=`message ${type}`;
  msg.innerHTML=type==="bot"?`<span class="bot-avatar">🤖</span>${clean}`:clean;
  messages.appendChild(msg);
}

function autoScroll(){
  messages.scrollTop=messages.scrollHeight;
}

// Onboarding questions
function askNextProfileQuestion(){
  for(const q of profileQuestions){
    if(!userProfileState[q.key]){
      appendMessage("bot",q.question);
      saveMsg("bot",q.question);
      return q.key;
    }
  }
  userProfileState.profileComplete=true;
  return null;
}

// Save to Firestore
async function saveMsg(sender,text){
  const ref=doc(db,"users",currentUser.uid,"messages",Date.now().toString());
  await setDoc(ref,{sender,text,timestamp:serverTimestamp()});
}

// GPT-call + profile update
async function generateBotReply(userText){
  const res=await fetch('/.netlify/functions/ask-gpt',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      message:userText,
      userProfile:{...userProfileState,name:userProfileState.name||currentUser.displayName}
    })
  });
  if(!res.ok){
    console.error('GPT error',res.status,await res.text());
    return '⚠️ AI did not respond.';
  }
  const data=await res.json();
  if(data.profileUpdate&&Object.keys(data.profileUpdate).length){
    Object.assign(userProfileState,data.profileUpdate);
    await setDoc(doc(db,"users",currentUser.uid),{
      profile:userProfileState,updatedAt:serverTimestamp()
    },{merge:true});
  }
  return data.reply;
}
