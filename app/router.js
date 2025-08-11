import * as Profile from '../state/profileState.js';
import * as Onboarding from '../domains/onboarding.js';
import * as Coach from '../domains/coach.js';
import * as Layout from '../ui/layout.js';

export function init(){ /* ev. lyssna på mode-ändringar */ }

export function route(){
  if (Profile.isComplete()) {
    Layout.expandToFullscreen();        // <— din effektfulla övergång
    Coach.mount();
  } else {
    Onboarding.mount();
  }
}

export async function handleUserMessage(text){
  if (!Profile.isComplete()) return Onboarding.onUserInput(text);
  return Coach.onUserInput(text);
}
