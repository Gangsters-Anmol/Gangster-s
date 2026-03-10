/**
 * admin.js — FULL REWRITE
 * ─────────────────────────────────────────────────────────────
 * Super Admin:  live stats, user management (search / filter /
 *               promote / mod / ban), private chat monitor.
 * Moderator:    info panel + deletion log.
 *
 * BUGS FIXED:
 *  • _populateAdminChatSelects() was called but never defined
 *  • admin:viewPrivateChat event was dispatched but never caught
 *  • Orphaned container.innerHTML code outside any function
 *  • _convId() missing from this file
 *  • _loadModDeleteLog() broken due to the above issues
 *  • All async flows now have proper await / error handling
 * ─────────────────────────────────────────────────────────────
 */

import {
  collection, getDocs, getDoc, doc, updateDoc,
  query, orderBy, limit, where, addDoc, onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

import { db, SUPER_ADMIN_UID }         from "./firebase-config.js";
import { onAuthChange, showToast,
         currentUser, currentProfile } from "./auth.js";

/* ══════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════ */
function _esc(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

/** Private-chat conversation ID — matches chat.js exactly */
function _convId(a, b) { return [a, b].sort().join("_"); }

/** Animate a stat number */
function _pop(el, val) {
  if (!el) return;
  el.textContent = val;
  el.classList.remove("stat-pop");
  void el.offsetWidth;
  el.classList.add("stat-pop");
}

/* ══════════════════════════════════════════════════════════════
   DOM REFS
══════════════════════════════════════════════════════════════ */
const adminModal        = document.getElementById("adminModal");
const adminModalClose   = document.getElementById("adminModalClose");
const openAdminBtn      = document.getElementById("openAdminBtn");
const superAdminPanel   = document.getElementById("superAdminPanel");
const modInfoPanel      = document.getElementById("modInfoPanel");
const adminRoleLabel    = document.getElementById("adminRoleLabel");
const adminUsersList    = document.getElementById("adminUsersList");
const adminUserSearch   = document.getElementById("adminUserSearch");
const adminRoleFilter   = document.getElementById("adminRoleFilter");
const adminRefreshStats = document.getElementById("adminRefreshStats");
const statTotalUsers    = document.getElementById("statTotalUsers");
const statTotalPosts    = document.getElementById("statTotalPosts");
const statTotalMsgs     = document.getElementById("statTotalMsgs");
const statSpecialUsers  = document.getElementById("statSpecialUsers");
const statBannedUsers   = document.getElementById("statBannedUsers");
const adminChatUser1    = document.getElementById("adminChatUser1");
const adminChatUser2    = document.getElementById("adminChatUser2");
const adminPrivateMsgs  = document.getElementById("adminPrivateMsgs");

let _allUsers        = [];
let _privateChatUnsub = null;

/* ══════════════════════════════════════════════════════════════
   OPEN / CLOSE
══════════════════════════════════════════════════════════════ */
openAdminBtn?.addEventListener("click", _open);
adminModalClose?.addEventListener("click", _close);
adminModal?.addEventListener("click", e => { if (e.target === adminModal) _close(); });

function _open() {
  if (!currentProfile?.admin && !currentProfile?.moderator) return;
  const isSA = currentUser?.uid === SUPER_ADMIN_UID;

  adminRoleLabel.textContent = isSA ? "Super Admin" : "Moderator";
  superAdminPanel.hidden     = !isSA;
  modInfoPanel.hidden        =  isSA;
  adminModal.hidden          = false;
  document.body.style.overflow = "hidden";

  if (isSA) {
    _loadStats();
    _loadUsers();
    _populateAdminChatSelects();
  } else {
    _loadModDeleteLog();
  }
}

function _close() {
  if (_privateChatUnsub) { _privateChatUnsub(); _privateChatUnsub = null; }
  adminModal.hidden = true;
  document.body.style.overflow = "";
}

/* ══════════════════════════════════════════════════════════════
   STATS
══════════════════════════════════════════════════════════════ */
adminRefreshStats?.addEventListener("click", _loadStats);

async function _loadStats() {
  [statTotalUsers, statTotalPosts, statTotalMsgs,
   statSpecialUsers, statBannedUsers].forEach(el => { if (el) el.textContent = "…"; });
  try {
    const [uSnap, pSnap, mSnap] = await Promise.all([
      getDocs(collection(db, "users")),
      getDocs(collection(db, "posts")),
      getDocs(collection(db, "groupMessages")),
    ]);
    let special = 0, banned = 0;
    uSnap.forEach(d => {
      if (d.data().specialUser) special++;
      if (d.data().banned)      banned++;
    });
    _pop(statTotalUsers,   uSnap.size);
    _pop(statTotalPosts,   pSnap.size);
    _pop(statTotalMsgs,    mSnap.size);
    _pop(statSpecialUsers, special);
    _pop(statBannedUsers,  banned);
  } catch (e) {
    console.error("admin stats:", e);
    showToast("Could not load stats.");
  }
}

/* ══════════════════════════════════════════════════════════════
   USER LIST
══════════════════════════════════════════════════════════════ */
async function _loadUsers() {
  if (!adminUsersList) return;
  adminUsersList.innerHTML = `<p class="admin-hint">Loading users…</p>`;
  try {
    const snap = await getDocs(collection(db, "users"));
    _allUsers = [];
    snap.forEach(d => _allUsers.push({ id: d.id, ...d.data() }));
    _allUsers.sort((a, b) => {
      if (a.admin && !b.admin) return -1;
      if (!a.admin && b.admin) return 1;
      return (a.name || "").localeCompare(b.name || "");
    });
    _renderUsers();
  } catch (e) {
    adminUsersList.innerHTML = `<p class="admin-error">Failed to load users: ${_esc(e.message)}</p>`;
  }
}

adminUserSearch?.addEventListener("input",  _renderUsers);
adminRoleFilter?.addEventListener("change", _renderUsers);

function _renderUsers() {
  if (!adminUsersList) return;
  const q    = (adminUserSearch?.value || "").toLowerCase().trim();
  const role = adminRoleFilter?.value || "all";
  const list = _allUsers.filter(u => {
    const rOk = role === "all" || u.role === role;
    const qOk = !q
      || (u.name  || "").toLowerCase().includes(q)
      || (u.email || "").toLowerCase().includes(q);
    return rOk && qOk;
  });
  if (!list.length) {
    adminUsersList.innerHTML = `<p class="admin-hint">No users match your filters.</p>`;
    return;
  }
  adminUsersList.innerHTML = "";
  list.forEach(u => adminUsersList.appendChild(_buildUserRow(u)));
}

function _buildUserRow(u) {
  const isSelf  = u.id === currentUser?.uid;
  const initial = (u.name || "?")[0].toUpperCase();
  const row     = document.createElement("div");
  row.className = `admin-user-row${u.banned ? " admin-user-row--banned" : ""}`;

  const avatarHtml = u.photoURL
    ? `<div class="admin-user-avatar" data-role="${_esc(u.role)}" style="padding:0;overflow:hidden;">
         <img src="${_esc(u.photoURL)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"
              onerror="this.parentElement.textContent='${initial}'" />
       </div>`
    : `<div class="admin-user-avatar" data-role="${_esc(u.role)}">${initial}</div>`;

  const badges = [
    u.specialUser ? `<span class="badge badge--special">⭐ Special</span>` : "",
    u.admin       ? `<span class="badge badge--super">Admin</span>`        : "",
    u.moderator   ? `<span class="badge badge--mod">Mod</span>`            : "",
    u.banned      ? `<span class="badge badge--banned">Banned</span>`      : "",
  ].join("");

  const actions = (!isSelf && !u.admin)
    ? `<button class="admin-btn admin-btn--special" data-action="special" data-uid="${u.id}">
         ${u.specialUser ? "Remove ⭐" : "Make Special ⭐"}
       </button>
       <button class="admin-btn admin-btn--mod" data-action="mod" data-uid="${u.id}">
         ${u.moderator ? "Remove Mod" : "Make Mod 🛡"}
       </button>
       <button class="admin-btn ${u.banned ? "admin-btn--unban" : "admin-btn--ban"}" data-action="ban" data-uid="${u.id}">
         ${u.banned ? "Unban ✓" : "Ban ⊘"}
       </button>`
    : `<span class="admin-self-label">${isSelf ? "(you)" : "(admin)"}</span>`;

  row.innerHTML = `
    <div class="admin-user-main">
      ${avatarHtml}
      <div class="admin-user-details">
        <div class="admin-user-name-row">
          <span class="admin-user-name">${_esc(u.name || "—")}</span>
          ${badges}
        </div>
        <div class="admin-user-meta-row">
          <span class="admin-badge-role">${_esc(u.role || "")}</span>
          <span class="admin-user-email">${_esc(u.email || "")}</span>
        </div>
      </div>
    </div>
    <div class="admin-user-actions">${actions}</div>`;

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
    await Promise.all([_loadUsers(), _loadStats()]);
    _populateAdminChatSelects();
  } catch (e) {
    showToast("Action failed: " + e.message);
  }
}

/* ══════════════════════════════════════════════════════════════
   PRIVATE CHAT MONITOR — populate selects
══════════════════════════════════════════════════════════════ */

// Track whether we've already attached change listeners to avoid duplicates
let _selectListenersAttached = false;

async function _populateAdminChatSelects() {
  if (!adminChatUser1 || !adminChatUser2) return;

  // Fetch fresh if cache is empty
  let users = _allUsers;
  if (!users.length) {
    try {
      const snap = await getDocs(collection(db, "users"));
      users = [];
      snap.forEach(d => users.push({ id: d.id, ...d.data() }));
      users.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      _allUsers = users;
    } catch (e) {
      console.error("Failed to load users for chat selects:", e);
      return;
    }
  }

  function buildOptions(excludeId = "") {
    let html = `<option value="">— Select a user —</option>`;
    users.forEach(u => {
      if (u.id === excludeId) return;
      html += `<option value="${_esc(u.id)}">${_esc(u.name || "Unknown")} (${_esc(u.role || "?")})</option>`;
    });
    return html;
  }

  // Set initial options
  adminChatUser1.innerHTML = buildOptions();
  adminChatUser2.innerHTML = buildOptions();

  // Attach mutual-exclusion listeners only once
  if (!_selectListenersAttached) {
    _selectListenersAttached = true;
    adminChatUser1.addEventListener("change", () => {
      const cur2 = adminChatUser2.value;
      adminChatUser2.innerHTML = buildOptions(adminChatUser1.value);
      // Restore previously selected value if still valid
      if (cur2 && cur2 !== adminChatUser1.value) adminChatUser2.value = cur2;
    });
    adminChatUser2.addEventListener("change", () => {
      const cur1 = adminChatUser1.value;
      adminChatUser1.innerHTML = buildOptions(adminChatUser2.value);
      if (cur1 && cur1 !== adminChatUser2.value) adminChatUser1.value = cur1;
    });
  }
}

/* ══════════════════════════════════════════════════════════════
   PRIVATE CHAT VIEWER — load & stream messages
══════════════════════════════════════════════════════════════ */

// Handle the CustomEvent dispatched from the "View Chat" button in index.html
window.addEventListener("admin:viewPrivateChat", e => {
  const { uid1, uid2 } = e.detail || {};
  if (uid1 && uid2) _streamPrivateChat(uid1, uid2);
});

// Also wire the button directly as a fallback
document.getElementById("adminViewChatBtn")?.addEventListener("click", () => {
  const uid1 = adminChatUser1?.value?.trim();
  const uid2 = adminChatUser2?.value?.trim();
  if (!uid1 || !uid2) {
    showToast("Please select two different users first.");
    return;
  }
  if (uid1 === uid2) {
    showToast("Please select two different users.");
    return;
  }
  _streamPrivateChat(uid1, uid2);
});

async function _streamPrivateChat(uid1, uid2) {
  if (!adminPrivateMsgs) return;

  // Kill previous stream
  if (_privateChatUnsub) { _privateChatUnsub(); _privateChatUnsub = null; }

  adminPrivateMsgs.style.display = "block";
  adminPrivateMsgs.innerHTML =
    `<p style="color:var(--clr-muted);font-size:.8rem;padding:.75rem;text-align:center;">Loading conversation…</p>`;

  // Resolve names
  const [name1, name2] = await Promise.all([_getUserName(uid1), _getUserName(uid2)]);
  const convId  = _convId(uid1, uid2);
  const msgsRef = collection(db, "privateChats", convId, "messages");
  const q       = query(msgsRef, orderBy("createdAt", "asc"), limit(100));

  try {
    _privateChatUnsub = onSnapshot(q, snap => {
      if (snap.empty) {
        adminPrivateMsgs.innerHTML =
          `<p style="color:var(--clr-muted);font-size:.82rem;padding:1rem;text-align:center;">
             No messages between <strong>${_esc(name1)}</strong> and <strong>${_esc(name2)}</strong> yet.
           </p>`;
        return;
      }

      let html = `
        <div style="
          padding:.5rem .8rem;margin-bottom:.6rem;
          background:var(--clr-surface2);border-radius:8px;
          display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;
          font-size:.73rem;font-weight:600;color:var(--clr-text);
          border:1px solid var(--clr-border);
        ">
          🔒 <em style="color:var(--clr-accent)">${_esc(name1)}</em>
          <span style="color:var(--clr-muted)">↔</span>
          <em style="color:var(--clr-accent2)">${_esc(name2)}</em>
          <span style="color:var(--clr-muted);font-weight:400;margin-left:auto;">
            ${snap.size} message${snap.size !== 1 ? "s" : ""}
          </span>
        </div>`;

      snap.forEach(d => {
        const m       = d.data();
        const mid     = d.id;
        const isLeft  = m.senderUid === uid1;
        const sender  = _esc(isLeft ? name1 : name2);
        const clr     = isLeft ? "var(--clr-accent)" : "var(--clr-accent2)";
        const radius  = isLeft ? "4px 12px 12px 12px" : "12px 4px 12px 12px";
        const align   = isLeft ? "flex-start" : "flex-end";
        const bg      = isLeft ? "var(--clr-surface2)" : "var(--clr-surface)";
        const time    = m.createdAt
          ? new Date(m.createdAt.seconds * 1000).toLocaleString("en-IN", {
              day:"2-digit", month:"short",
              hour:"2-digit", minute:"2-digit"
            })
          : "";
        const mediaHtml = m.mediaUrl
          ? (m.mediaUrl.match(/\.(mp4|webm|mov)/i)
              ? `<video src="${_esc(m.mediaUrl)}" style="max-width:180px;border-radius:6px;display:block;margin-top:.35rem;" controls></video>`
              : `<img src="${_esc(m.mediaUrl)}" style="max-width:180px;border-radius:6px;display:block;margin-top:.35rem;" />`)
          : "";

        html += `
          <div style="display:flex;flex-direction:column;align-items:${align};margin-bottom:.65rem;">
            <div style="font-size:.63rem;font-weight:600;color:${clr};margin-bottom:.15rem;padding:0 .25rem;">
              ${sender}
            </div>
            <div style="
              background:${m.deleted ? "transparent" : bg};
              border:1px solid ${m.deleted ? "var(--clr-border)" : "var(--clr-border)"};
              border-radius:${radius};
              padding:.45rem .75rem;max-width:78%;word-break:break-word;
              font-size:.78rem;
              color:${m.deleted ? "var(--clr-muted)" : "var(--clr-text)"};
              font-style:${m.deleted ? "italic" : "normal"};
            ">
              ${m.deleted ? "🗑 Message removed" : _esc(m.text || "")}
              ${mediaHtml}
            </div>
            <div style="display:flex;align-items:center;gap:.4rem;margin-top:.18rem;padding:0 .25rem;">
              <span style="font-size:.6rem;color:var(--clr-muted);">${time}</span>
              ${!m.deleted
                ? `<button
                    onclick="window._adminDeletePrivateMsg('${_esc(convId)}','${_esc(mid)}',this)"
                    style="
                      font-size:.6rem;padding:.1rem .4rem;border-radius:4px;cursor:pointer;
                      background:none;border:1px solid rgba(220,53,69,.35);
                      color:var(--clr-danger);transition:background .15s;
                    "
                    onmouseover="this.style.background='rgba(220,53,69,.1)'"
                    onmouseout="this.style.background='none'"
                  >Delete</button>`
                : ""}
            </div>
          </div>`;
      });

      adminPrivateMsgs.innerHTML = html;
      adminPrivateMsgs.scrollTop = adminPrivateMsgs.scrollHeight;

    }, err => {
      adminPrivateMsgs.innerHTML =
        `<p style="color:var(--clr-danger);font-size:.8rem;padding:.75rem;">
           Error streaming messages: ${_esc(err.message)}
         </p>`;
    });
  } catch (e) {
    adminPrivateMsgs.innerHTML =
      `<p style="color:var(--clr-danger);font-size:.8rem;padding:.75rem;">
         Error: ${_esc(e.message)}
       </p>`;
  }
}

/** Resolve UID → name using cache then Firestore */
async function _getUserName(uid) {
  const cached = _allUsers.find(u => u.id === uid);
  if (cached?.name) return cached.name;
  try {
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() ? (snap.data().name || uid) : uid;
  } catch { return uid; }
}

/* ══════════════════════════════════════════════════════════════
   ADMIN DELETE PRIVATE MESSAGE (global — called from inline onclick)
══════════════════════════════════════════════════════════════ */
window._adminDeletePrivateMsg = async (convId, msgId, btn) => {
  if (!confirm("Delete this message? It will be replaced with a removal notice.")) return;
  btn.disabled = true;
  try {
    await updateDoc(doc(db, "privateChats", convId, "messages", msgId), {
      text:      "Message removed due to irrelevant content",
      deleted:   true,
      deletedBy: "admin",
      mediaUrl:  null,
    });
    await addDoc(collection(db, "modActions"), {
      modUid:    currentUser?.uid,
      modName:   currentProfile?.name || "Admin",
      action:    "Deleted private message",
      convId,
      msgId,
      createdAt: serverTimestamp(),
    });
    showToast("Message removed.");
  } catch (e) {
    showToast("Error: " + e.message);
    btn.disabled = false;
  }
};

/* ══════════════════════════════════════════════════════════════
   MODERATOR — deletion log
══════════════════════════════════════════════════════════════ */
async function _loadModDeleteLog() {
  const logList = document.getElementById("modDeleteLogList");
  if (!logList || !currentUser) return;
  logList.textContent = "Loading…";
  try {
    const q = query(
      collection(db, "modActions"),
      where("modUid", "==", currentUser.uid),
      orderBy("createdAt", "desc"),
      limit(20)
    );
    const snap = await getDocs(q);
    if (snap.empty) { logList.textContent = "No moderation actions yet."; return; }
    logList.innerHTML = snap.docs.map(d => {
      const a    = d.data();
      const time = a.createdAt
        ? new Date((a.createdAt.seconds || 0) * 1000).toLocaleString("en-IN", {
            day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit"
          })
        : "—";
      return `<div style="padding:.3rem 0;border-bottom:1px solid var(--clr-border);">
                <span style="color:var(--clr-text2);font-size:.76rem;">${_esc(a.action || "Action")}</span>
                <span style="color:var(--clr-muted);margin-left:.5rem;font-size:.65rem;">${time}</span>
              </div>`;
    }).join("");
  } catch (e) {
    logList.textContent = "Could not load log.";
  }
}

/* ══════════════════════════════════════════════════════════════
   AUTH GATE — refresh open dashboard on auth change
══════════════════════════════════════════════════════════════ */
onAuthChange((user, profile) => {
  if (!adminModal?.hidden && profile?.admin) {
    _loadStats();
    _loadUsers();
    _populateAdminChatSelects();
  }
});
