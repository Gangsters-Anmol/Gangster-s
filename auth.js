/**
 * auth.js
 * Handles: Google login, Email/Password login, role selection,
 * profile completion, ban checks, nav state, toast helper.
 * ─────────────────────────────────────────────────────────────
 */

import {
  GoogleAuthProvider, signInWithPopup,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

import { auth, db, SUPER_ADMIN_UID, SPECIAL_CODES } from "./firebase-config.js";

/* ═══════════════════════════════════════════════════════════════
   EXPORTED REACTIVE STATE
   Other modules can subscribe via onAuthChange().
════════════════════════════════════════════════════════════════ */
export let currentUser    = null;  // Firebase Auth user object
export let currentProfile = null;  // Firestore /users/{uid} data

const _listeners = [];
/** Register a callback(user, profile) invoked on every auth change */
export function onAuthChange(cb) { _listeners.push(cb); }
function _notify() { _listeners.forEach(cb => cb(currentUser, currentProfile)); }

/* ═══════════════════════════════════════════════════════════════
   DOM REFS
════════════════════════════════════════════════════════════════ */
const authModal         = document.getElementById("authModal");
const authModalClose    = document.getElementById("authModalClose");
const authStep1         = document.getElementById("authStep1");
const authStep2         = document.getElementById("authStep2");
const authStep3         = document.getElementById("authStep3");
const authError         = document.getElementById("authError");
const profileError      = document.getElementById("profileError");
const googleLoginBtn    = document.getElementById("googleLoginBtn");
const emailLoginBtn     = document.getElementById("emailLoginBtn");
const emailRegisterBtn  = document.getElementById("emailRegisterBtn");
const completeProfileBtn= document.getElementById("completeProfileBtn");
const authBackBtn       = document.getElementById("authBackBtn");
const loginEmail        = document.getElementById("loginEmail");
const loginPassword     = document.getElementById("loginPassword");
const regEmail          = document.getElementById("regEmail");
const regPassword       = document.getElementById("regPassword");
const profileFullName   = document.getElementById("profileFullName");
const specialCodeInput  = document.getElementById("specialCodeInput");
const navUserLabel      = document.getElementById("navUserLabel");
const authBtn           = document.getElementById("authBtn");
const logoutBtn         = document.getElementById("logoutBtn");
const openAdminBtn      = document.getElementById("openAdminBtn");

/* ═══════════════════════════════════════════════════════════════
   MODAL OPEN / CLOSE
════════════════════════════════════════════════════════════════ */
export function openAuthModal() {
  _resetModal();
  authModal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeAuthModal() {
  authModal.hidden = true;
  document.body.style.overflow = "";
}

function _resetModal() {
  _showStep(1);
  _clearErr(authError);
  _clearErr(profileError);
  [loginEmail, loginPassword, regEmail, regPassword,
   profileFullName, specialCodeInput].forEach(el => { if (el) el.value = ""; });
}

authBtn?.addEventListener("click", openAuthModal);
authModalClose?.addEventListener("click", closeAuthModal);
authModal?.addEventListener("click", e => { if (e.target === authModal) closeAuthModal(); });

/* Trigger auth modal from Posts / Chat "login" links */
document.getElementById("postsLoginBtn")?.addEventListener("click", openAuthModal);
document.getElementById("chatLoginBtn")?.addEventListener("click", openAuthModal);

/* ═══════════════════════════════════════════════════════════════
   STEP HELPERS
════════════════════════════════════════════════════════════════ */
function _showStep(n) {
  authStep1.hidden = (n !== 1);
  authStep2.hidden = (n !== 2);
  authStep3.hidden = (n !== 3);
}

/* ═══════════════════════════════════════════════════════════════
   EMAIL TABS
════════════════════════════════════════════════════════════════ */
document.querySelectorAll(".auth-email-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-email-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const isLogin = tab.dataset.tab === "login";
    document.getElementById("loginForm").hidden    = !isLogin;
    document.getElementById("registerForm").hidden =  isLogin;
    _clearErr(authError);
  });
});

/* ═══════════════════════════════════════════════════════════════
   ROLE SELECTION (step 2 → step 3)
════════════════════════════════════════════════════════════════ */
let _pendingRole = null;

document.querySelectorAll(".role-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    _pendingRole = btn.dataset.role;
    document.querySelectorAll(".role-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    setTimeout(() => _showStep(3), 200);
  });
});

authBackBtn?.addEventListener("click", () => _showStep(2));

/* ═══════════════════════════════════════════════════════════════
   GOOGLE LOGIN
════════════════════════════════════════════════════════════════ */
googleLoginBtn?.addEventListener("click", async () => {
  _clearErr(authError);
  try {
    const cred = await signInWithPopup(auth, new GoogleAuthProvider());
    await _afterLogin(cred.user);
  } catch (e) { _setErr(authError, e.message); }
});

/* ═══════════════════════════════════════════════════════════════
   EMAIL / PASSWORD — SIGN IN
════════════════════════════════════════════════════════════════ */
emailLoginBtn?.addEventListener("click", async () => {
  _clearErr(authError);
  const em = loginEmail?.value.trim(), pw = loginPassword?.value;
  if (!em || !pw) return _setErr(authError, "Please enter email and password.");
  try {
    const cred = await signInWithEmailAndPassword(auth, em, pw);
    await _afterLogin(cred.user);
  } catch (e) { _setErr(authError, _friendlyError(e.code)); }
});

/* ═══════════════════════════════════════════════════════════════
   EMAIL / PASSWORD — REGISTER
════════════════════════════════════════════════════════════════ */
emailRegisterBtn?.addEventListener("click", async () => {
  _clearErr(authError);
  const em = regEmail?.value.trim(), pw = regPassword?.value;
  if (!em || !pw) return _setErr(authError, "Please fill in all fields.");
  if (pw.length < 6) return _setErr(authError, "Password must be at least 6 characters.");
  try {
    const cred = await createUserWithEmailAndPassword(auth, em, pw);
    await _afterLogin(cred.user);
  } catch (e) { _setErr(authError, _friendlyError(e.code)); }
});

/* ═══════════════════════════════════════════════════════════════
   COMPLETE PROFILE (step 3 submit)
════════════════════════════════════════════════════════════════ */
completeProfileBtn?.addEventListener("click", async () => {
  _clearErr(profileError);
  const name = profileFullName?.value.trim();
  const code = (specialCodeInput?.value.trim() || "").toUpperCase();
  if (!name) return _setErr(profileError, "Please enter your full name.");
  if (!auth.currentUser) return;

  const uid        = auth.currentUser.uid;
  const isAdmin    = uid === SUPER_ADMIN_UID;
  const isSpecial  = isAdmin || SPECIAL_CODES.has(code);

  const data = {
    uid,
    name,
    role:            _pendingRole,
    email:           auth.currentUser.email || "",
    specialUser:     isSpecial,
    admin:           isAdmin,
    moderator:       false,
    banned:          false,
    profileComplete: true,
    createdAt:       serverTimestamp(),
    updatedAt:       serverTimestamp(),
  };

  try {
    await setDoc(doc(db, "users", uid), data, { merge: true });
    currentProfile = data;
    closeAuthModal();
    _updateNav();
    _notify();
    showToast(`Welcome, ${name}! 🎉`);
  } catch (e) {
    _setErr(profileError, e.message);
  }
});

/* ═══════════════════════════════════════════════════════════════
   LOGOUT
════════════════════════════════════════════════════════════════ */
logoutBtn?.addEventListener("click", async () => {
  await signOut(auth);
  showToast("Signed out. See you soon!");
});

/* ═══════════════════════════════════════════════════════════════
   POST-LOGIN FLOW — check Firestore, route to right step
════════════════════════════════════════════════════════════════ */
async function _afterLogin(user) {
  const snap = await getDoc(doc(db, "users", user.uid));

  if (snap.exists()) {
    const data = snap.data();
    if (data.banned) {
      await signOut(auth);
      return _setErr(authError, "This account has been suspended.");
    }
    if (data.profileComplete) {
      // Ensure super admin flag is always correct
      if (user.uid === SUPER_ADMIN_UID && !data.admin) {
        await updateDoc(doc(db, "users", user.uid), { admin: true, specialUser: true });
        data.admin = true; data.specialUser = true;
      }
      currentProfile = data;
      closeAuthModal();
      _updateNav();
      _notify();
      showToast(`Welcome back, ${data.name}!`);
      return;
    }
  }
  // New user or incomplete — go to role picker
  _showStep(2);
}

/* ═══════════════════════════════════════════════════════════════
   FIREBASE AUTH STATE OBSERVER (page reload / session restore)
════════════════════════════════════════════════════════════════ */
onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (!user) {
    currentProfile = null;
    _updateNav();
    _notify();
    return;
  }
  const snap = await getDoc(doc(db, "users", user.uid));
  if (snap.exists()) {
    const data = snap.data();
    if (data.banned) { await signOut(auth); showToast("Your account has been suspended."); return; }
    currentProfile = data;
  }
  _updateNav();
  _notify();
});

/* ═══════════════════════════════════════════════════════════════
   NAV UPDATE
════════════════════════════════════════════════════════════════ */
function _updateNav() {
  const loggedIn = !!(currentUser && currentProfile?.profileComplete);
  authBtn.hidden       = loggedIn;
  logoutBtn.hidden     = !loggedIn;
  navUserLabel.hidden  = !loggedIn;
  openAdminBtn.hidden  = !(currentProfile?.admin || currentProfile?.moderator);
  if (loggedIn) navUserLabel.textContent = `${currentProfile.name} · ${currentProfile.role}`;
}

/* ═══════════════════════════════════════════════════════════════
   TOAST — shared util used by all modules
════════════════════════════════════════════════════════════════ */
export function showToast(msg, duration = 3000) {
  const el = document.getElementById("toastNotif");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("show"), duration);
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════════════════════ */
function _setErr(el, msg) { if (el) el.textContent = msg; }
function _clearErr(el)    { if (el) el.textContent = ""; }

function _friendlyError(code) {
  const map = {
    "auth/user-not-found":         "No account found with that email.",
    "auth/wrong-password":         "Incorrect password. Try again.",
    "auth/email-already-in-use":   "An account with this email already exists.",
    "auth/invalid-email":          "Please enter a valid email address.",
    "auth/too-many-requests":      "Too many attempts — please try again later.",
    "auth/weak-password":          "Password must be at least 6 characters.",
    "auth/network-request-failed": "Network error. Check your connection.",
  };
  return map[code] || "Something went wrong. Please try again.";
}
