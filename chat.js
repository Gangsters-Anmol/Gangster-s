/**
 * chat.js
 * Group chat + private 1-on-1 messaging.
 * Real-time via Firestore onSnapshot, 280-char limit,
 * admin/mod delete button, auto-scroll.
 * ─────────────────────────────────────────────────────────────
 */

import {
  collection, addDoc, query, orderBy, limit,
  onSnapshot, deleteDoc, doc, serverTimestamp, getDocs
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

import { db }                             from "./firebase-config.js";
import { onAuthChange, showToast,
         currentUser, currentProfile }    from "./auth.js";

/* ═══════════════════════════════════════════════════════════════
   DOM REFS
════════════════════════════════════════════════════════════════ */
const chatAuthNotice  = document.getElementById("chatAuthNotice");
const chatUI          = document.getElementById("chatUI");
const groupMessages   = document.getElementById("groupMessages");
const privateMessages = document.getElementById("privateMessages");
const groupChatInput  = document.getElementById("groupChatInput");
const privateChatInput= document.getElementById("privateChatInput");
const groupSendBtn    = document.getElementById("groupSendBtn");
const privateSendBtn  = document.getElementById("privateSendBtn");
const chatTabs        = document.querySelectorAll(".chat-tab");
const groupPanel      = document.getElementById("groupChatPanel");
const privatePanel    = document.getElementById("privateChatPanel");
const usersList       = document.getElementById("usersList");
const privateInputWrap= document.getElementById("privateInputWrap");
const privateChatHdr  = document.getElementById("privateChatHeader");
const selectUserHint  = document.getElementById("selectUserHint");

let _groupUnsub    = null;
let _privateUnsub  = null;
let _activePrivate = null;   // { uid, name, role }

/* ═══════════════════════════════════════════════════════════════
   AUTH GATE
════════════════════════════════════════════════════════════════ */
onAuthChange((user, profile) => {
  if (user && profile?.profileComplete && !profile.banned) {
    chatAuthNotice.hidden = true;
    chatUI.hidden         = false;
    _startGroupChat();
    _loadUsersList();
  } else {
    chatAuthNotice.hidden = false;
    chatUI.hidden         = true;
    _groupUnsub?.();   _groupUnsub   = null;
    _privateUnsub?.(); _privateUnsub = null;
  }
});

/* ═══════════════════════════════════════════════════════════════
   TAB SWITCHING
════════════════════════════════════════════════════════════════ */
chatTabs.forEach(tab => {
  tab.addEventListener("click", () => {
    chatTabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const isGroup = tab.dataset.tab === "group";
    groupPanel.hidden   = !isGroup;
    privatePanel.hidden =  isGroup;
    if (!isGroup) _loadUsersList();
  });
});

/* ═══════════════════════════════════════════════════════════════
   GROUP CHAT
════════════════════════════════════════════════════════════════ */
function _startGroupChat() {
  _groupUnsub?.();
  const q = query(
    collection(db, "groupMessages"),
    orderBy("timestamp", "asc"),
    limit(150)
  );
  _groupUnsub = onSnapshot(q, snap => {
    groupMessages.innerHTML = "";
    snap.forEach(d => _appendBubble(groupMessages, d.id, d.data(), "group"));
    _scrollBottom(groupMessages);
  }, err => console.error("group chat:", err));
}

groupSendBtn?.addEventListener("click", _sendGroup);
groupChatInput?.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); _sendGroup(); }
});

async function _sendGroup() {
  const text = groupChatInput?.value.trim();
  if (!text || !currentUser || !currentProfile) return;
  if (text.length > 280) return showToast("Max 280 characters.");
  groupChatInput.value = "";
  await addDoc(collection(db, "groupMessages"), {
    text, uid: currentUser.uid,
    name: currentProfile.name, role: currentProfile.role,
    timestamp: serverTimestamp()
  }).catch(() => showToast("Failed to send."));
}

/* ═══════════════════════════════════════════════════════════════
   PRIVATE CHAT — Users list
════════════════════════════════════════════════════════════════ */
async function _loadUsersList() {
  if (!currentUser) return;
  usersList.innerHTML = `<p class="chat-hint">Loading…</p>`;
  try {
    const snap = await getDocs(collection(db, "users"));
    usersList.innerHTML = "";
    snap.forEach(d => {
      const u = d.data();
      if (d.id === currentUser.uid || !u.profileComplete || u.banned) return;
      const btn = document.createElement("button");
      btn.className = "user-list-item";
      btn.setAttribute("role", "listitem");
      btn.innerHTML = `
        <span class="user-list-avatar">${u.name[0].toUpperCase()}</span>
        <span class="user-list-info">
          <span class="user-list-name">${_esc(u.name)}</span>
          <span class="user-list-role">${u.role}</span>
        </span>`;
      btn.addEventListener("click", () => _openDM({ uid: d.id, name: u.name, role: u.role }, btn));
      usersList.appendChild(btn);
    });
    if (!usersList.children.length)
      usersList.innerHTML = `<p class="chat-hint">No other users yet.</p>`;
  } catch { usersList.innerHTML = `<p class="chat-hint">Error loading users.</p>`; }
}

function _openDM(peer, btn) {
  _activePrivate = peer;
  privateChatHdr.textContent = `Chat with ${peer.name}`;
  if (selectUserHint) selectUserHint.hidden = true;
  privateInputWrap.hidden = false;
  document.querySelectorAll(".user-list-item").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");

  _privateUnsub?.(); _privateUnsub = null;
  const convId = _convId(currentUser.uid, peer.uid);
  const q = query(
    collection(db, "privateMessages", convId, "msgs"),
    orderBy("timestamp", "asc"),
    limit(100)
  );
  privateMessages.innerHTML = "";
  _privateUnsub = onSnapshot(q, snap => {
    privateMessages.innerHTML = "";
    snap.forEach(d => _appendBubble(privateMessages, d.id, d.data(), "private", convId));
    _scrollBottom(privateMessages);
  }, err => console.error("private chat:", err));
}

privateSendBtn?.addEventListener("click", _sendPrivate);
privateChatInput?.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); _sendPrivate(); }
});

async function _sendPrivate() {
  const text = privateChatInput?.value.trim();
  if (!text || !currentUser || !currentProfile || !_activePrivate) return;
  if (text.length > 280) return showToast("Max 280 characters.");
  privateChatInput.value = "";
  const convId = _convId(currentUser.uid, _activePrivate.uid);
  await addDoc(collection(db, "privateMessages", convId, "msgs"), {
    text, uid: currentUser.uid,
    name: currentProfile.name, role: currentProfile.role,
    timestamp: serverTimestamp()
  }).catch(() => showToast("Failed to send."));
}

/* ═══════════════════════════════════════════════════════════════
   RENDER A CHAT BUBBLE
════════════════════════════════════════════════════════════════ */
function _appendBubble(container, msgId, data, type, convId) {
  const mine  = data.uid === currentUser?.uid;
  const canDel= currentProfile?.admin || currentProfile?.moderator;

  const time = data.timestamp?.toDate
    ? data.timestamp.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  const wrap = document.createElement("div");
  wrap.className = `chat-bubble-wrap ${mine ? "mine" : "theirs"}`;

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  bubble.innerHTML = `
    ${!mine ? `<span class="chat-bubble__author">${_esc(data.name)} <em class="chat-bubble__role-tag">${data.role}</em></span>` : ""}
    <span class="chat-bubble__text">${_esc(data.text)}</span>
    <span class="chat-bubble__time">${time}</span>`;

  wrap.appendChild(bubble);

  if (canDel) {
    const delBtn = document.createElement("button");
    delBtn.className = "chat-del-btn";
    delBtn.title = "Delete message";
    delBtn.textContent = "🗑";
    delBtn.addEventListener("click", async () => {
      if (!confirm("Delete this message?")) return;
      const ref = type === "group"
        ? doc(db, "groupMessages", msgId)
        : doc(db, "privateMessages", convId, "msgs", msgId);
      await deleteDoc(ref).catch(() => showToast("Delete failed."));
    });
    wrap.appendChild(delBtn);
  }

  container.appendChild(wrap);
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════════════════════ */
/** Deterministic conversation ID (sorted UIDs joined by _) */
function _convId(a, b) { return [a, b].sort().join("_"); }
function _scrollBottom(el) { el.scrollTop = el.scrollHeight; }
function _esc(s) {
  return String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
