// script.js

import {
  auth,
  provider,
  db,
  signInWithPopup,
  onAuthStateChanged,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  collection,
  query,
  orderBy,
  limit,
  getDocs
} from "./firebase-config.js";

// DOM
const loginBtn    = document.getElementById("loginBtn");
const chatWrapper = document.getElementById("chat-wrapper");
const intro       = document.getElementById("intro");
const messages    = document.getElementById("messages");
const inputArea   = document.getElementById("input-area");
const input       = document.getElementById("userInput");
const sendBtn     = document.getElementById("sendBtn");
const userInfo    = document.getElementById("userInfo");
const userName    = document.getElementById("userName");
const typeEl      = document.getElementById("typewriter");

// Typewriter
const phrases = [
  "reach your goals",
  "beat 10K under 50 mins",
  "build a training plan that fits you",
  "get faster and stronger",
  "train smarter – not harder"
];
let currentPhrase = 0;
function typeText(txt, i=0){
  typeEl.textContent = txt.slice(0,i);
  if(i<txt.length) setTimeout(()=>typeText(txt,i+1),60);
  else setTimeout(()=>eraseText(txt.length),1800);
}
function eraseText(i){
  typeEl.textContent = phrases[currentPhrase].slice(0,i);
  if(i>0) setTimeout(()=>eraseText(i-1),30);
  else {
    currentPhrase=(currentPhrase+1)%phrases.length;
    typeText(phrases[currentPhrase]);
  }
}
typeText(phrases[currentPhrase]);

// State
const userProfileState = {
  name: null, language: null, gender: null, birthYear: null,
  level: null, weeklySessions: null, current5kTime: null,
  injuryNotes: null, raceComingUp: null, raceDate: null,
  raceDistance: null, agent: null, profileComplete: false,
  conversationSummary: ""
};
const profileQuestions = [
  { key:"name", question:"What should I call you?" },
  { key:"gender", question:"What's your gender?" },
  { key:"birthYear", question:"What year were you born?" },
  { key:"level", question:"How experienced are you? (beginner, intermediate, advanced)" },
  { key:"weeklySessions", question:"How many times do you run per week?" },
  { key:"current5kTime", question:"What's your current 5K time?" },
  { key:"injuryNotes", question:"Any injuries or limitations?" },
  { key:"raceComingUp", question:"Do you have a race coming up?" },
  { key:"raceDate", question:"When is the race?" },
  { key:"raceDistance", question:"What distance is the race?" }
];

let currentUser=null, currentQuestionKey=null;
let firstMessageSent=false, firstLangHandled=false;

// AUTH
loginBtn.addEventListener("click", async()=>{
  try {
    const { user } = await signInWithPopup(auth, provider);
    currentUser=user;
    await loadProfile(user.uid);
    showUserInfo(user);
    showChatUI();
  } catch(e){ console.error(e) }
});
onAuthStateChanged(auth, async user=>{
  if(!user) return;
  currentUser=user;
  await loadProfile(user.uid);
  showUserInfo(user);
  showChatUI();
});

async function loadProfile(uid){
  const ref=doc(db,"users",uid);
  const snap=await getDoc(ref);
  if(snap.exists() && snap.data().profile){
    Object.assign(userProfileState, snap.data().profile);
  }
  await setDoc(ref,{
    lastLogin: serverTimestamp(),
    profile: userProfileState
  },{ merge:true });
}

// UI
function showUserInfo(u){
  loginBtn.style.display="none";
  userInfo.style.display="block";
  userName.textContent=u.displayName||"Runner";
}
function showChatUI(){
  chatWrapper.style.display="flex";
  messages .style.display="flex";
  inputArea.style.display="flex";
}

// CHAT
sendBtn.addEventListener("click", sendMessage);
input.addEventListener("keydown", e=>{
  if(e.key==="Enter"&&!e.shiftKey){
    e.preventDefault(); sendMessage();
  }
});

async function sendMessage(){
  const text=input.value.trim();
  if(!text) return;

  // Första meddelandet
  if(!firstMessageSent){
    intro.style.display="none";
    firstMessageSent=true;
    currentQuestionKey=profileQuestions[0].key;
    appendMessage("bot", profileQuestions[0].question);
    await saveMsg("bot", profileQuestions[0].question);
    await updateConversationSummary("bot", profileQuestions[0].question);
    input.value=""; return;
  }

  // Visa användaren
  appendMessage("user", text);
  await saveMsg("user", text);
  await updateConversationSummary("user", text);
  input.value=""; autoScroll();

  // … här kan du lägga in språk- och onboarding-flow om du vill …

  // AI
  const thinking=document.createElement("div");
  thinking.className="message bot thinking";
  thinking.textContent="…";
  messages.appendChild(thinking);
  autoScroll();
  try {
    const reply=await generateBotReply(text);
    thinking.remove();
    appendMessage("bot",reply);
    await saveMsg("bot",reply);
    await updateConversationSummary("bot",reply);
  } catch(e){
    thinking.remove();
    appendMessage("bot","⚠️ Something went wrong.");
    await saveMsg("bot","⚠️ Something went wrong.");
    console.error(e);
  }
  autoScroll();
}

// Sparar & summerar
async function saveMsg(sender,text){
  const ref=doc(db,"users",currentUser.uid,"messages",Date.now().toString());
  await setDoc(ref,{ sender,text,timestamp:serverTimestamp() });
}
async function updateConversationSummary(sender,text){
  const uref=doc(db,"users",currentUser.uid);
  const snap=await getDoc(uref);
  const existing=snap.data().profile.conversationSummary||"";
  const resp=await fetch("/.netlify/functions/summarize-gpt",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      prompt: `Existing summary:\n${existing}\n\n${sender}: ${text}\n\nUpdate summary (<=200 words):`
    })
  });
  const { summary }=await resp.json();
  userProfileState.conversationSummary=summary;
  await setDoc(uref,{
    profile:{ conversationSummary: summary }
  },{ merge:true });
}

// Helpers
function appendMessage(type,text){
  const clean=text.replace(/\[PROFILE UPDATE\][\s\S]*?\[\/PROFILE UPDATE\]/g,"").trim();
  if(!clean) return;
  const div=document.createElement("div");
  div.className=`message ${type}`;
  div.textContent=clean;
  messages.appendChild(div);
}
function autoScroll(){
  messages.scrollTop=messages.scrollHeight;
}

// AI-call
async function generateBotReply(userText){
  const uref=doc(db,"users",currentUser.uid);
  const snap=await getDoc(uref);
  const summary=snap.data().profile.conversationSummary||"";
  const msgsCol=collection(db,"users",currentUser.uid,"messages");
  const q=query(msgsCol,orderBy("timestamp","desc"),limit(5));
  const dsnap=await getDocs(q);
  const recent=dsnap.docs
    .map(d=>`${d.data().sender}: ${d.data().text}`)
    .reverse().join("\n");
  const res=await fetch("/.netlify/functions/ask-gpt",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      systemSummary:  summary,
      recentMessages: recent,
      message:        userText,
      userProfile:    { ...userProfileState, name: userProfileState.name||currentUser.displayName }
    })
  });
  if(!res.ok){
    console.error("GPT error",res.status,await res.text());
    return "⚠️ AI didn’t respond.";
  }
  const data=await res.json();
  if(data.profileUpdate && Object.keys(data.profileUpdate).length){
    Object.assign(userProfileState,data.profileUpdate);
    await setDoc(uref,{
      profile:userProfileState,updatedAt:serverTimestamp()
    },{ merge:true });
  }
  return data.reply||"";
}

// expose handleKey
window.handleKey = e=>{
  if(e.key==="Enter"&&!e.shiftKey){
    e.preventDefault(); sendMessage();
  }
};
