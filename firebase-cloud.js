import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAFgCTZXZLmyfade5mT1mUtSBT3HZ0kAio",
  authDomain: "classroom-hub-bb1dc.firebaseapp.com",
  projectId: "classroom-hub-bb1dc",
  storageBucket: "classroom-hub-bb1dc.firebasestorage.app",
  messagingSenderId: "59009016440",
  appId: "1:59009016440:web:f6f63413207c5920f5438d"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const compactUser = (user) => user ? {
  uid: user.uid,
  displayName: user.displayName || "",
  email: user.email || "",
  photoURL: user.photoURL || ""
} : null;

const cloudDoc = (uid) => doc(db, "users", uid, "classManager", "main");

const ensureUser = async () => {
  if (auth.currentUser) return auth.currentUser;
  const result = await signInWithPopup(auth, provider);
  return result.user;
};

const saveDraft = async (draft, usage) => {
  const user = await ensureUser();
  const payload = draft && draft.payload;
  if (!payload || !payload.data) throw new Error("沒有可上傳的壓縮資料。");
  await setDoc(cloudDoc(user.uid), {
    schema: "classManagerCloudBackup_v1",
    ownerUid: user.uid,
    savedAt: draft.savedAt,
    updatedAt: serverTimestamp(),
    payload: payload,
    usage: usage || null
  }, { merge: true });
  return compactUser(user);
};

const loadDraft = async () => {
  const user = await ensureUser();
  const snapshot = await getDoc(cloudDoc(user.uid));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (!data || !data.payload) return null;
  return {
    schema: "classManagerFirebaseDraftEnvelope_v1",
    savedAt: data.savedAt || data.payload.createdAt || null,
    target: "firebase",
    payload: data.payload
  };
};

const api = {
  signIn: async () => compactUser(await ensureUser()),
  signOut: async () => signOut(auth),
  getUser: () => compactUser(auth.currentUser),
  onUserChanged: (callback) => onAuthStateChanged(auth, (user) => callback(compactUser(user))),
  saveDraft,
  loadDraft
};

window.ClassroomHubFirebase = api;
window.dispatchEvent(new CustomEvent("classroomHubFirebaseReady"));
