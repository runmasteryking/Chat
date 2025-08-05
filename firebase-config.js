// firebase-config.js

// IMPORTERA Firebase SDK via CDN (v10.12.0)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// FIREBASE-KONFIGURATION
const firebaseConfig = {
  apiKey: "AIzaSyBx8seK9f-ZTV3JemDQ9sdTZkoiwSTvtqI",
  authDomain: "run-mastery-ai.firebaseapp.com",
  projectId: "run-mastery-ai",
  storageBucket: "run-mastery-ai.appspot.com",
  messagingSenderId: "599923677042",
  appId: "1:599923677042:web:bc968a22483c7b3f916feb"
};

// INITIERA Firebase App
const app = initializeApp(firebaseConfig);

// EXPORTERA nödvändiga Firebase-tjänster
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);

// EXPORTERA Firestore-verktyg för enkel åtkomst
export { doc, setDoc, serverTimestamp };
