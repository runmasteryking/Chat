// app/bootstrap.js
import { initChatController } from "../controllers/chat.js";
import { auth, onAuthStateChanged } from "../firebase-config.js";
import * as Layout from "../ui/layout.js";
import * as Input from "../ui/input.js";
import * as Router from "./router.js";
import * as Chips from "../ui/chips.js";
import * as Messages from "../ui/messages.js";
import * as Persistence from "../state/persistence.js";

// När DOM laddats
document.addEventListener("DOMContentLoaded", () => {
  // 1️⃣ Cachea DOM
  Layout.cacheDom();

  // 2️⃣ Bind input-knappar och Enter
  Input.bindHandlers();

  // 3️⃣ Bind chip-knappar (snabbval)
  Chips.bindHandlers?.();

  // 4️⃣ Initiera routing (styr onboarding eller chat)
  Router.init();

  // 5️⃣ Initiera chat-kontrollern
  initChatController();

  // 6️⃣ Kolla auth och ladda data
  onAuthStateChanged(auth, async (user) => {
    window.__currentUser = user || null;
    if (user) {
      await Persistence.hydrate(user.uid);
      Layout.showAfterLogin();
      Router.route();
    }
  });
});
