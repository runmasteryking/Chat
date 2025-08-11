// app/bootstrap.js
import { initChatController } from "../controllers/chat.js";
import { auth, onAuthStateChanged } from "../firebase-config.js";

// Exponera aktuell användare globalt så chat-kontrollern kan läsa uid
onAuthStateChanged(auth, (user) => {
  window.__currentUser = user || null;
});

initChatController();
