import * as UI from '../ui/messages.js';
import * as Chips from '../ui/chips.js';
import * as Validate from './validation.js';
import * as Profile from '../state/profileState.js';
import * as Persist from '../state/persistence.js';
import * as Layout from '../ui/layout.js';
import { auth } from '../services/firebase.js';

const STEPS = [
  { key:'name', question:'What should I call you?' },
  { key:'gender', chips:['Male','Female','Other'], question:`What's your gender?` },
  { key:'birthYear', question:'What year were you born?' },
  { key:'level', chips:['Beginner','Intermediate','Advanced'], question:'How experienced are you?' },
  { key:'weeklySessions', chips:['2','3','4','5'], question:'How many times do you run per week?' },
  { key:'current5kTime', chips:['19:30','22:00','25:00'], question:`What's your current 5K time?` },
];

let pendingKey = null;

export function mount(){
  askNext();
}

export async function onUserInput(text){
  if (!pendingKey) return;
  const norm = Validate.normalize(pendingKey, text);
  if (norm == null) {
    UI.bot(`Hmm, that didn’t look valid. Try again.`);
    return;
  }
  const u = auth.currentUser;
  Profile.patch({ [pendingKey]: norm });
  await Persist.saveProfile(u.uid);
  pendingKey = null;
  askNext();
}

async function askNext(){
  const next = STEPS.find(s => !Profile.get()[s.key]);
  if (!next) {
    Profile.patch({ profileComplete:true });
    await Persist.saveProfile(auth.currentUser.uid);
    UI.bot(`Thanks! I’ve got everything I need. Want me to sketch your next week of training?`);
    // övergången till stor chatt
    Layout.expandToFullscreen();
    return;
  }
  pendingKey = next.key;
  const bubble = UI.bot(next.question);
  if (next.chips?.length) Chips.render(bubble, next.chips, pick => onUserInput(pick));
}
