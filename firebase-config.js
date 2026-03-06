/**
 * firebase-config.js
 * Firebase initialization and shared exports.
 * All other JS modules import from this file.
 * ─────────────────────────────────────────────────────────────
 */

import { initializeApp }  from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getAnalytics }   from "https://www.gstatic.com/firebasejs/12.10.0/firebase-analytics.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

/* ── Firebase project config ─────────────────────────────────── */
const firebaseConfig = {
  apiKey:            "AIzaSyBfM7Wn6HbkgfUf0eePFbsxN7bJv_fersM",
  authDomain:        "gangster-s-2025-26.firebaseapp.com",
  projectId:         "gangster-s-2025-26",
  storageBucket:     "gangster-s-2025-26.firebasestorage.app",
  messagingSenderId: "725698254504",
  appId:             "1:725698254504:web:fa7e271aab3dd40c6ed49d",
  measurementId:     "G-K6F1S63RGS"
};

/* ── Initialize ──────────────────────────────────────────────── */
const app       = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth      = getAuth(app);
const db        = getFirestore(app);

/* ── Super Admin UID ─────────────────────────────────────────── */
// Sign in once, copy your UID from Firebase Console → Authentication,
// paste it here and re-deploy.
export const SUPER_ADMIN_UID = "YZxt1r4CZUZWHpLuWfVSmDFhid92";

/* ── Special access codes that grant specialUser = true ─────── */
export const SPECIAL_CODES = new Set([
  "CLASS2025",
  "MEMORIES2026",
  "SPECIAL2025",
  "ADMIN2025"
]);

export { app, analytics, auth, db };
