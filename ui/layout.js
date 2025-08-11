let chatWrapper, intro, messages, inputArea;

export function cacheDom(){
  chatWrapper = document.getElementById('chat-wrapper');
  intro       = document.getElementById('intro');
  messages    = document.getElementById('messages');
  inputArea   = document.getElementById('input-area');
}

export function showAfterLogin(){
  document.getElementById('loginBtn')?.style?.setProperty('display','none');
  document.getElementById('userInfo')?.style?.setProperty('display','flex');
  chatWrapper.style.display = 'flex';
  messages.style.display    = 'flex';
  inputArea.style.display   = 'block';
}

export function expandToFullscreen(){
  // Lägg gärna till CSS-klassen .chat--fullscreen med transition i din CSS
  chatWrapper.classList.add('chat--expanding');
  // microtask → låt layouten hämta andan
  requestAnimationFrame(() => {
    chatWrapper.classList.add('chat--fullscreen');
    chatWrapper.classList.remove('chat--expanding');
  });
}
