import { scrollFollow } from './scroll.js';

const messagesEl = () => document.getElementById('messages');

export function bot(text){
  const el = document.createElement('div');
  el.className = 'message bot';
  el.textContent = text;
  messagesEl().appendChild(el);
  scrollFollow();
  return el;
}
export function user(text){
  const el = document.createElement('div');
  el.className = 'message user';
  el.textContent = text;
  messagesEl().appendChild(el);
  scrollFollow();
  return el;
}
export function thinking(){
  const el = document.createElement('div');
  el.className = 'message bot';
  el.innerHTML = `<div class="thinking-indicator"><span></span><span></span><span></span></div>`;
  messagesEl().appendChild(el);
  scrollFollow(true);
  return { remove: () => el.remove() };
}
export async function typewriter(text){
  const bubble = bot('');
  const minDelay=8, maxDelay=22;
  for (let i=1;i<=text.length;i++){
    bubble.textContent = text.slice(0,i);
    scrollFollow();
    await new Promise(r=>setTimeout(r, Math.floor(Math.random()*(maxDelay-minDelay+1))+minDelay));
  }
  return bubble;
}
