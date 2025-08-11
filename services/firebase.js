// services/firebase.js
// Små, stabila wrappers runt Firestore. Bygger på dina exports i firebase-config.js

import {
  db,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
} from "../firebase-config.js";

/** Hämta profil (eller tomt objekt) */
export async function loadProfile(uid) {
  const uref = doc(db, "users", uid);
  const snap = await getDoc(uref);
  if (!snap.exists()) return {};
  return snap.data()?.profile || {};
}

/** Spara patch i profile-fältet */
export async function saveProfile(uid, patch) {
  const uref = doc(db, "users", uid);
  await setDoc(
    uref,
    {
      lastLogin: serverTimestamp(),
      profile: { ...patch },
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/** Spara en chattloggrad */
export async function persistMessage(uid, { sender, text, clientAt }) {
  const id = String(clientAt || Date.now());
  const mref = doc(db, "users", uid, "messages", id);
  await setDoc(
    mref,
    {
      sender,
      text,
      clientAt: clientAt || Date.now(),
      timestamp: serverTimestamp(),
    },
    { merge: false }
  );
}

/** Hämta senaste N meddelanden (osorterat – vi sorterar i controller) */
export async function getRecentMessages(uid, n = 20) {
  const col = collection(db, "users", uid, "messages");
  // sortera server-side på timestamp desc, hämta n
  const qy = query(col, orderBy("timestamp", "desc"), limit(n));
  const ds = await getDocs(qy);
  return ds.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Meta från modellen (tags, urgency) */
export async function markConversationMeta(uid, { tags = [], urgency = null }) {
  const uref = doc(db, "users", uid);
  await setDoc(
    uref,
    {
      lastConversationMeta: {
        tags,
        urgency,
        updatedAt: serverTimestamp(),
      },
    },
    { merge: true }
  );
}
