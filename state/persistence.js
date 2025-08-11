import { db, doc, getDoc, setDoc, serverTimestamp } from '../services/firebase.js';
import * as Profile from './profileState.js';

export async function hydrate(uid){
  const snap = await getDoc(doc(db, 'users', uid));
  const p = snap.exists() ? (snap.data().profile || {}) : {};
  Profile.patch(p);
  Profile.patch({ profileComplete: Profile.isComplete() });
  await setDoc(doc(db,'users',uid), { lastLogin: serverTimestamp(), profile: Profile.get() }, { merge:true });
}

export async function saveProfile(uid){
  await setDoc(doc(db,'users',uid), { profile: Profile.get(), updatedAt: serverTimestamp() }, { merge:true });
}
