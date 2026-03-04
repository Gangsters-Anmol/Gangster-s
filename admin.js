/**
 * admin.js
 * Super-admin dashboard: live stats, user management (search, filter,
 * promote to special, toggle mod, ban/unban).
 * Moderator view: brief info panel only.
 * ─────────────────────────────────────────────────────────────
 */

import {
  collection, getDocs, doc, updateDoc
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

import { db, SUPER_ADMIN_UID }          from "./firebase-config.js";
import { onAuthChange, showToast,
         currentUser, currentProfile }  from "./auth.js";

/* ═══════════════════════════════════════════════════════════════
   DOM REFS
════════════════════════════════════════════════════════════════ */
const adminModal       = document.getElementById("adminModal");
const adminModalClose  = document.getElementById("adminModalClose");
const openAdminBtn     = document.getElementById("openAdminBtn");
const superAdminPanel  = document.getElementById("superAdminPanel");
const modInfoPanel     = document.getElementById("modInfoPanel");
const adminRoleLabel   = document.getElementById("adminRoleLabel");
const adminUsersList   = document.getElementById("adminUsersList");
const adminUserSearch  = document.getElementById("adminUserSearch");
const adminRoleFilter  = document.getElementById("adminRoleFilter");
const adminRefreshStats= document.getElementById("adminRefreshStats");
const statTotalUsers   = document.getElementById("statTotalUsers");
const statTotalPosts   = document.getElementById("statTotalPosts");
const statTotalMsgs    = document.getElementById("statTotalMsgs");
const statSpecialUsers = document.getElementById("statSpecialUsers");
const statBannedUsers  = document.getElementById("statBannedUsers");

let _allUsers = [];

/* ═══════════════════════════════════════════════════════════════
   OPEN / CLOSE
════════════════════════════════════════════════════════════════ */
openAdminBtn?.addEventListener("click", _open);
adminModalClose?.addEventListener("click", _close);
adminModal?.addEventListener("click", e => { if (e.target === adminModal) _close(); });

function _open() {
  if (!currentProfile?.admin && !currentProfile?.moderator) return;
  const isSA = currentUser?.uid === SUPER_ADMIN_UID;

  adminRoleLabel.textContent = isSA ? "Super Admin" : "Moderator";
  superAdminPanel.hidden     = !isSA;
  modInfoPanel.hidden        =  isSA;

  adminModal.hidden = false;
  document.body.style.overflow = "hidden";

  if (isSA) { _loadStats(); _loadUsers(); }
}

function _close() {
  adminModal.hidden = true;
  document.body.style.overflow = "";
}

/* ═══════════════════════════════════════════════════════════════
   LIVE STATS
════════════════════════════════════════════════════════════════ */
adminRefreshStats?.addEventListener("click", _loadStats);

async function _loadStats() {
  try {
    const [uSnap, pSnap, mSnap] = await Promise.all([
      getDocs(collection(db, "users")),
      getDocs(collection(db, "posts")),
      getDocs(collection(db, "groupMessages")),
    ]);
    let special = 0, banned = 0;
    uSnap.forEach(d => { if (d.data().specialUser) special++; if (d.data().banned) banned++; });
    _pop(statTotalUsers,  uSnap.size);
    _pop(statTotalPosts,  pSnap.size);
    _pop(statTotalMsgs,   mSnap.size);
    _pop(statSpecialUsers, special);
    _pop(statBannedUsers,  banned);
  } catch (e) { console.error("admin stats:", e); }
}

function _pop(el, val) {
  if (!el) return;
  el.textContent = val;
  el.classList.remove("stat-pop");
  void el.offsetWidth;
  el.classList.add("stat-pop");
}

/* ═══════════════════════════════════════════════════════════════
   LOAD & RENDER USERS
════════════════════════════════════════════════════════════════ */
async function _loadUsers() {
  adminUsersList.innerHTML = `<p class="admin-hint">Loading users…</p>`;
  try {
    const snap = await getDocs(collection(db, "users"));
    _allUsers = [];
    snap.forEach(d => _allUsers.push({ id: d.id, ...d.data() }));
    _renderUsers();
  } catch { adminUsersList.innerHTML = `<p class="admin-error">Failed to load users.</p>`; }
}

adminUserSearch?.addEventListener("input",  _renderUsers);
adminRoleFilter?.addEventListener("change", _renderUsers);

function _renderUsers() {
  const q    = (adminUserSearch?.value || "").toLowerCase();
  const role = adminRoleFilter?.value || "all";
  const list = _allUsers.filter(u => {
    const rOk = role === "all" || u.role === role;
    const qOk = !q || u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
    return rOk && qOk;
  });
  if (!list.length) { adminUsersList.innerHTML = `<p class="admin-hint">No users found.</p>`; return; }
  adminUsersList.innerHTML = "";
  list.forEach(u => adminUsersList.appendChild(_buildUserRow(u)));
}

function _buildUserRow(u) {
  const isSelf = u.id === currentUser?.uid;
  const row = document.createElement("div");
  row.className = `admin-user-row${u.banned ? " admin-user-row--banned" : ""}`;
  row.innerHTML = `
    <div class="admin-user-main">
      <div class="admin-user-avatar" data-role="${_esc(u.role)}">${(u.name||"?")[0].toUpperCase()}</div>
      <div class="admin-user-details">
        <div class="admin-user-name-row">
          <span class="admin-user-name">${_esc(u.name || "—")}</span>
          ${u.specialUser ? `<span class="badge badge--special">⭐ Special</span>` : ""}
          ${u.admin       ? `<span class="badge badge--super">Admin</span>`        : ""}
          ${u.moderator   ? `<span class="badge badge--mod">Mod</span>`            : ""}
          ${u.banned      ? `<span class="badge badge--banned">Banned</span>`      : ""}
        </div>
        <div class="admin-user-meta-row">
          <span class="admin-badge-role">${_esc(u.role||"")}</span>
          <span class="admin-user-email">${_esc(u.email||"")}</span>
        </div>
      </div>
    </div>
    <div class="admin-user-actions">
      ${!isSelf && !u.admin ? `
        <button class="admin-btn admin-btn--special" data-action="special" data-uid="${u.id}">
          ${u.specialUser ? "Remove Special" : "Make Special ⭐"}
        </button>
        <button class="admin-btn admin-btn--mod" data-action="mod" data-uid="${u.id}">
          ${u.moderator ? "Remove Mod" : "Make Mod 🛡"}
        </button>
        <button class="admin-btn ${u.banned ? "admin-btn--unban" : "admin-btn--ban"}" data-action="ban" data-uid="${u.id}">
          ${u.banned ? "Unban ✓" : "Ban ⊘"}
        </button>` : `<span class="admin-self-label">${isSelf ? "(you)" : "(admin)"}</span>`}
    </div>`;

  row.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", () => _doAction(btn.dataset.action, btn.dataset.uid, u));
  });
  return row;
}

async function _doAction(action, uid, u) {
  const ref = doc(db, "users", uid);
  try {
    if (action === "special") {
      await updateDoc(ref, { specialUser: !u.specialUser });
      showToast(`${u.name} — special ${u.specialUser ? "removed" : "granted"}.`);
    } else if (action === "mod") {
      await updateDoc(ref, { moderator: !u.moderator });
      showToast(`${u.name} — moderator ${u.moderator ? "removed" : "granted"}.`);
    } else if (action === "ban") {
      await updateDoc(ref, { banned: !u.banned });
      showToast(`${u.name} — ${u.banned ? "unbanned" : "banned"}.`);
    }
    await _loadUsers();
    await _loadStats();
  } catch (e) { showToast("Action failed: " + e.message); }
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════════════════════ */
function _esc(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
