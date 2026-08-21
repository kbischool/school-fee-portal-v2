// ---------------------------------------------------------------------
// Shared Firebase init + auth / code-claiming helpers.
// Imported by index.html, parent-dashboard.html, admin-dashboard.html
// ---------------------------------------------------------------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// -----------------------------------------------------------------
// Role lookup — checks admins/{uid} first, then parents/{uid}.
// Returns { role: 'admin' | 'parent' | null, data }
// -----------------------------------------------------------------
export async function getUserRole(uid) {
  const adminSnap = await getDoc(doc(db, "admins", uid));
  if (adminSnap.exists()) return { role: "admin", data: adminSnap.data() };

  const parentSnap = await getDoc(doc(db, "parents", uid));
  if (parentSnap.exists()) return { role: "parent", data: parentSnap.data() };

  return { role: null, data: null };
}

// -----------------------------------------------------------------
// First-time claim: PARENT
// code -> looked up in schoolCodes/{code}. Must exist and be unclaimed.
// Creates the Firebase Auth account, then the parents/{uid} doc,
// then flips schoolCodes/{code}.claimed to true.
// -----------------------------------------------------------------
export async function claimParentCode(code, email, password, displayName) {
  const normalizedCode = code.trim().toUpperCase();
  const codeRef = doc(db, "schoolCodes", normalizedCode);
  const codeSnap = await getDoc(codeRef);

  if (!codeSnap.exists()) throw new Error("That code wasn't recognized. Double-check it and try again.");
  const codeData = codeSnap.data();
  if (codeData.claimed) throw new Error("This code has already been used to set up an account. Try logging in instead, or use 'Forgot access'.");

  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;

  await setDoc(doc(db, "parents", uid), {
    email,
    displayName: displayName || email,
    role: "parent",
    linkedStudents: [codeData.studentId],
    claimedFrom: normalizedCode,
    createdAt: new Date().toISOString()
  });

  await updateDoc(codeRef, { claimed: true, claimedByUid: uid, claimedAt: new Date().toISOString() });

  return uid;
}

// -----------------------------------------------------------------
// First-time claim: ADMIN
// Same pattern against adminCodes/{code} and the admins collection.
// -----------------------------------------------------------------
export async function claimAdminCode(code, email, password, displayName) {
  const normalizedCode = code.trim().toUpperCase();
  const codeRef = doc(db, "adminCodes", normalizedCode);
  const codeSnap = await getDoc(codeRef);

  if (!codeSnap.exists()) throw new Error("That admin code wasn't recognized.");
  const codeData = codeSnap.data();
  if (codeData.claimed) throw new Error("This admin code has already been used. Try logging in instead.");

  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;

  await setDoc(doc(db, "admins", uid), {
    email,
    displayName: displayName || email,
    role: "admin",
    claimedFrom: normalizedCode,
    createdAt: new Date().toISOString()
  });

  await updateDoc(codeRef, { claimed: true, claimedByUid: uid, claimedAt: new Date().toISOString() });

  return uid;
}

// -----------------------------------------------------------------
// Returning-user login (email/password)
// -----------------------------------------------------------------
export async function loginEmail(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user.uid;
}

// -----------------------------------------------------------------
// Google sign-in. If this Google account has never been linked to a
// parent or admin record, the caller should prompt for a code and then
// call linkGoogleUserWithCode() below.
// -----------------------------------------------------------------
export async function loginGoogle() {
  const cred = await signInWithPopup(auth, googleProvider);
  return cred.user;
}

export async function linkGoogleUserWithCode(uid, email, displayName, code, asAdmin) {
  const normalizedCode = code.trim().toUpperCase();
  const collectionName = asAdmin ? "adminCodes" : "schoolCodes";
  const codeRef = doc(db, collectionName, normalizedCode);
  const codeSnap = await getDoc(codeRef);

  if (!codeSnap.exists()) throw new Error("That code wasn't recognized.");
  const codeData = codeSnap.data();
  if (codeData.claimed) throw new Error("This code has already been used.");

  if (asAdmin) {
    await setDoc(doc(db, "admins", uid), {
      email, displayName, role: "admin", claimedFrom: normalizedCode, createdAt: new Date().toISOString()
    });
  } else {
    await setDoc(doc(db, "parents", uid), {
      email, displayName, role: "parent",
      linkedStudents: [codeData.studentId],
      claimedFrom: normalizedCode, createdAt: new Date().toISOString()
    });
  }

  await updateDoc(codeRef, { claimed: true, claimedByUid: uid, claimedAt: new Date().toISOString() });
}

// If a parent has more than one child, an admin can link an additional
// code to the same existing account instead of creating a second login.
export async function linkAdditionalStudentCode(uid, code) {
  const normalizedCode = code.trim().toUpperCase();
  const codeRef = doc(db, "schoolCodes", normalizedCode);
  const codeSnap = await getDoc(codeRef);
  if (!codeSnap.exists()) throw new Error("That code wasn't recognized.");
  const codeData = codeSnap.data();
  if (codeData.claimed) throw new Error("This code has already been used.");

  await updateDoc(doc(db, "parents", uid), { linkedStudents: arrayUnion(codeData.studentId) });
  await updateDoc(codeRef, { claimed: true, claimedByUid: uid, claimedAt: new Date().toISOString() });
}

export function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function logout() {
  await signOut(auth);
}
