// ui/layout.js
import { els, cacheDom as cacheDomRefs } from './dom.js';

// Hämtar och sparar referenserna
export function cacheDom() {
  cacheDomRefs();
}

export function showAfterLogin() {
  els.loginBtn?.style?.setProperty('display', 'none');
  els.userInfo?.style?.setProperty('display', 'flex');
  els.chatWrapper.style.display = 'flex';
  els.messages.style.display = 'flex';
  els.inputArea.style.display = 'block';
}

export function expandToFullscreen() {
  // Lägg gärna till CSS-klassen .chat--fullscreen med transition i din CSS
  els.chatWrapper.classList.add('chat--expanding');
  requestAnimationFrame(() => {
    els.chatWrapper.classList.add('chat--fullscreen');
    els.chatWrapper.classList.remove('chat--expanding');
  });
}
