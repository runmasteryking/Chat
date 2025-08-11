// ui/input.js
import * as Events from '../controllers/events.js';

let inputEl, sendBtn, newThreadBtn;

export function bindHandlers() {
  inputEl = document.getElementById('userInput');
  sendBtn = document.getElementById('sendBtn');
  newThreadBtn = document.getElementById('newThreadBtn');

  if (!inputEl || !sendBtn) {
    console.error('❌ Input or send button not found in DOM');
    return;
  }

  // Klick på skicka-knapp
  sendBtn.addEventListener('click', handleSend);

  // Enter för att skicka (Shift+Enter = ny rad)
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Ny tråd-knapp
  if (newThreadBtn) {
    newThreadBtn.addEventListener('click', () => {
      Events.emit('THREAD:NEW');
    });
  }
}

function handleSend() {
  const text = inputEl.value.trim();
  if (!text) return;

  // Skicka event till resten av systemet
  Events.emit('USER:SEND', text);

  // Töm fältet och fokusera igen
  inputEl.value = '';
  inputEl.focus();
}
