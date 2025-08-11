import { onAuthStateChanged, signInWithPopup, auth, provider } from '../services/firebase.js';
import * as Router from './router.js';
import * as Layout from '../ui/layout.js';
import * as Input from '../ui/input.js';
import * as Messages from '../ui/messages.js';
import * as Profile from '../state/profileState.js';
import * as Persistence from '../state/persistence.js';
import * as Events from './events.js';

document.addEventListener('DOMContentLoaded', async () => {
  Layout.cacheDom();       // tar refs till #chat-wrapper, #messages, etc.
  Input.bindHandlers();    // enter, klick, send-btn
  Router.init();           // registrera routes/modes

  document.getElementById('loginBtn')?.addEventListener('click', async () => {
    const { user } = await signInWithPopup(auth, provider);
    // onAuthStateChanged tar vid
  });

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    await Persistence.hydrate(user.uid); // laddar profil + ev. history summary
    Layout.showAfterLogin();
    Router.route(); // väljer onboarding eller coach (beror på Profile.isComplete())
  });

  Events.on('USER:SEND', Router.handleUserMessage);
});
