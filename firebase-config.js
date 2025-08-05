// firebase-config.js
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "DIN_API_NYCKEL",
  authDomain: "ditt-projekt.firebaseapp.com",
  projectId: "ditt-projekt-id",
  storageBucket: "ditt-projekt.appspot.com",
  messagingSenderId: "xxxxxx",
  appId: "xxxxx"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);
