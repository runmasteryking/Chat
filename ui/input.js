// ui/input.js
import * as Router from '../app/router.js';

let inputEl, sendBtn, newThreadBtn;

export function bindHandlers() {
  inputEl = document.getElementById('userInput');
  sendBtn = document.getElementById('sendBtn');
  newThreadBtn = document.getElementById('newThreadBtn');

  if (!inputEl || !sendBtn) {
    console.error('❗️ Input eller skicka-knapp hittades inte i DOM.');
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

  // Ny tråd-knapp (använd nuvarande routerflöde)
  if (newThreadBtn) {
    newThreadBtn.addEventListener('click', () => {
      // Skicka ett syntetiskt meddelande till routern om du vill trigga ny tråd,
      // eller lämna det för nu om "ny tråd"-beteendet hanteras någon annanstans.
      // Ex: Router.handleUserMessage('/newthread');
    });
  }
}

function handleSend() {
  const text = inputEl.value.trim();
  if (!text) return;
  try {
    Router.handleUserMessage(text);
  } finally {
    inputEl.value = '';
    inputEl.focus();
  }
}
