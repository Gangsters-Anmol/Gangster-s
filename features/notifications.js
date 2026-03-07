/**
 * features/notifications.js
 * ─────────────────────────────────────────────────────────────────
 * PURELY ADDITIVE — does not modify any existing file.
 *
 * What this file does:
 *  1. Injects a 🔔 bell icon into the existing nav (next to the
 *     theme toggle button) — zero changes to index.html required.
 *  2. Opens a slide-in notification panel on click.
 *  3. Listens in real-time to notifications/{uid}/items/ and shows
 *     an unread count badge on the bell.
 *  4. Marks notifications as read when the panel is opened.
 *  5. Exports  sendNotification()  so other feature files can
 *     create notifications without touching core files.
 *
 * Notification types handled:
 *   follow    → "X started following you"
 *   like      → "X liked your post"
 *   reaction  → "X reacted 😂 to your post"
 *   comment   → "X commented on your post"
 *   msg_react → "X reacted ❤️ to your message"
 * ─────────────────────────────────────────────────────────────────
 */

import {
  collection, query, orderBy, limit,
  onSnapshot, updateDoc, doc, writeBatch,
  getDocs, where, serverTimestamp, addDoc
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

import { db }                         from "../firebase-config.js";
import { onAuthChange, currentUser }  from "../auth.js";

/* ═══════════════════════════════════════════════════════════════
   PUBLIC API — call this from any feature file to write a notif
════════════════════════════════════════════════════════════════ */
/**
 * sendNotification(targetUid, payload)
 * payload: { type, fromUid, fromName, postId?, emoji?, messageId? }
 */
export async function sendNotification(targetUid, payload) {
  if (!targetUid || !payload) return;
  /* Never notify yourself */
  if (payload.fromUid === targetUid) return;
  try {
    await addDoc(collection(db, "notifications", targetUid, "items"), {
      ...payload,
      timestamp: serverTimestamp(),
      read: false,
    });
  } catch (err) {
    console.warn("sendNotification failed:", err);
  }
}

/* ═══════════════════════════════════════════════════════════════
   STYLES — injected into <head> once
════════════════════════════════════════════════════════════════ */
(function _injectStyles() {
  if (document.getElementById("notif-js-styles")) return;
  const s = document.createElement("style");
  s.id = "notif-js-styles";
  s.textContent = `
    /* ── Bell Button ───────────────────────────────────────── */
    .notif-bell-wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
    }
    .notif-bell-btn {
      width: 34px; height: 34px;
      border: 1px solid var(--border, rgba(0,0,0,0.08));
      border-radius: 50%;
      background: transparent;
      color: var(--text, #1a1613);
      font-size: 1rem;
      cursor: pointer;
      transition: all 0.25s ease;
      display: flex; align-items: center; justify-content: center;
      position: relative;
    }
    .notif-bell-btn:hover {
      background: var(--accent, #c8a96e);
      color: #fff;
      border-color: var(--accent, #c8a96e);
    }
    .notif-bell-btn.has-unread {
      animation: bell-shake 1.2s ease 0.3s;
    }
    @keyframes bell-shake {
      0%,100% { transform: rotate(0); }
      15%  { transform: rotate(12deg); }
      30%  { transform: rotate(-10deg); }
      45%  { transform: rotate(8deg); }
      60%  { transform: rotate(-6deg); }
      75%  { transform: rotate(4deg); }
    }

    /* ── Unread Badge ──────────────────────────────────────── */
    .notif-badge {
      position: absolute;
      top: -4px; right: -4px;
      min-width: 17px; height: 17px;
      border-radius: 50px;
      background: #e74c3c;
      color: #fff;
      font-size: 0.6rem;
      font-weight: 700;
      font-family: 'Jost', sans-serif;
      display: flex; align-items: center; justify-content: center;
      padding: 0 3px;
      border: 2px solid var(--bg, #f9f6f1);
      pointer-events: none;
      transition: transform 0.2s cubic-bezier(0.34,1.56,0.64,1);
    }
    .notif-badge[hidden] { display: none !important; }
    .notif-badge.pop {
      animation: badge-pop 0.3s cubic-bezier(0.34,1.56,0.64,1);
    }
    @keyframes badge-pop {
      0%   { transform: scale(0); }
      60%  { transform: scale(1.25); }
      100% { transform: scale(1); }
    }

    /* ── Panel Overlay ─────────────────────────────────────── */
    .notif-overlay {
      position: fixed;
      inset: 0;
      z-index: 800;
      background: transparent;
    }

    /* ── Panel ─────────────────────────────────────────────── */
    .notif-panel {
      position: fixed;
      top: 66px;
      right: clamp(0.5rem, 3vw, 1.5rem);
      width: min(380px, calc(100vw - 1rem));
      max-height: min(520px, 80vh);
      background: var(--surface, rgba(255,255,255,0.92));
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid var(--border, rgba(0,0,0,0.08));
      border-radius: 16px;
      box-shadow: 0 16px 60px rgba(0,0,0,0.18);
      z-index: 801;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transform-origin: top right;
      animation: panel-open 0.22s cubic-bezier(0.34,1.3,0.64,1);
    }
    @keyframes panel-open {
      from { transform: scale(0.88) translateY(-8px); opacity: 0; }
      to   { transform: scale(1)    translateY(0);    opacity: 1; }
    }

    .notif-panel__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.2rem 0.75rem;
      border-bottom: 1px solid var(--border, rgba(0,0,0,0.08));
      flex-shrink: 0;
    }
    .notif-panel__title {
      font-family: 'Cormorant Garamond', serif;
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--text, #1a1613);
    }
    .notif-panel__actions {
      display: flex; gap: 0.5rem; align-items: center;
    }
    .notif-mark-all-btn {
      font-family: 'Jost', sans-serif;
      font-size: 0.72rem;
      color: var(--accent, #c8a96e);
      background: transparent;
      border: none;
      cursor: pointer;
      padding: 0.2rem 0.5rem;
      border-radius: 50px;
      transition: background 0.2s ease;
    }
    .notif-mark-all-btn:hover { background: var(--bg-alt, #f0ebe3); }

    .notif-panel__close {
      width: 26px; height: 26px;
      border-radius: 50%;
      border: 1px solid var(--border, rgba(0,0,0,0.08));
      background: transparent;
      color: var(--text-muted, #7a736b);
      font-size: 0.85rem;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.2s ease;
    }
    .notif-panel__close:hover { background: #e74c3c; color: #fff; border-color: #e74c3c; }

    /* ── List ──────────────────────────────────────────────── */
    .notif-list {
      flex: 1;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .notif-list::-webkit-scrollbar { width: 4px; }
    .notif-list::-webkit-scrollbar-track { background: transparent; }
    .notif-list::-webkit-scrollbar-thumb { background: var(--border, rgba(0,0,0,0.1)); border-radius: 2px; }

    /* ── Empty state ───────────────────────────────────────── */
    .notif-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2.5rem 1rem;
      gap: 0.5rem;
      color: var(--text-muted, #7a736b);
    }
    .notif-empty__icon { font-size: 2.2rem; }
    .notif-empty__text { font-size: 0.85rem; font-style: italic; }

    /* ── Loading ───────────────────────────────────────────── */
    .notif-loading {
      display: flex; align-items: center; justify-content: center;
      padding: 2rem;
      color: var(--text-muted, #7a736b);
      font-size: 0.85rem;
      gap: 0.5rem;
    }
    .notif-spinner {
      width: 18px; height: 18px;
      border: 2px solid var(--border, rgba(0,0,0,0.1));
      border-top-color: var(--accent, #c8a96e);
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Notification Item ─────────────────────────────────── */
    .notif-item {
      display: flex;
      align-items: flex-start;
      gap: 0.85rem;
      padding: 0.85rem 1.2rem;
      border-bottom: 1px solid var(--border, rgba(0,0,0,0.05));
      transition: background 0.2s ease;
      cursor: pointer;
      position: relative;
    }
    .notif-item:last-child { border-bottom: none; }
    .notif-item:hover { background: var(--bg-alt, #f0ebe3); }
    .notif-item.unread { background: rgba(200,169,110,0.07); }
    .notif-item.unread::before {
      content: "";
      position: absolute;
      left: 0; top: 0; bottom: 0;
      width: 3px;
      background: var(--accent, #c8a96e);
      border-radius: 0 2px 2px 0;
    }

    .notif-item__avatar {
      width: 38px; height: 38px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--accent, #c8a96e), #8b5e3c);
      display: flex; align-items: center; justify-content: center;
      font-family: 'Cormorant Garamond', serif;
      font-size: 1rem;
      font-weight: 600;
      color: #fff;
      flex-shrink: 0;
      overflow: hidden;
      font-size: 0.9rem;
    }
    .notif-item__type-icon {
      width: 38px; height: 38px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 1.2rem;
      flex-shrink: 0;
    }
    .notif-item__type-icon--follow   { background: rgba(91,159,166,0.15); }
    .notif-item__type-icon--like     { background: rgba(231,76,60,0.12); }
    .notif-item__type-icon--reaction { background: rgba(200,169,110,0.15); }
    .notif-item__type-icon--comment  { background: rgba(100,149,237,0.15); }
    .notif-item__type-icon--msg_react{ background: rgba(150,200,100,0.15); }

    .notif-item__body { flex: 1; min-width: 0; }
    .notif-item__text {
      font-size: 0.83rem;
      line-height: 1.45;
      color: var(--text, #1a1613);
      word-break: break-word;
    }
    .notif-item__text strong { font-weight: 600; }
    .notif-item__time {
      font-size: 0.7rem;
      color: var(--text-muted, #7a736b);
      margin-top: 0.2rem;
      display: block;
    }

    /* ── Footer ────────────────────────────────────────────── */
    .notif-panel__footer {
      padding: 0.6rem 1.2rem;
      border-top: 1px solid var(--border, rgba(0,0,0,0.08));
      text-align: center;
      flex-shrink: 0;
    }
    .notif-panel__footer span {
      font-size: 0.72rem;
      color: var(--text-muted, #7a736b);
      font-style: italic;
    }
  `;
  document.head.appendChild(s);
})();

/* ═══════════════════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════════════════════ */
let _unsubNotifs = null;
let _panelOpen   = false;
let _bellBtn     = null;
let _badge       = null;
let _prevCount   = 0;

/* ═══════════════════════════════════════════════════════════════
   INJECT BELL INTO NAV
════════════════════════════════════════════════════════════════ */
function _injectBell() {
  if (document.getElementById("notifBellWrap")) return;

  const controls = document.querySelector(".nav__controls");
  if (!controls) return;

  const wrap = document.createElement("div");
  wrap.className = "notif-bell-wrap";
  wrap.id        = "notifBellWrap";
  wrap.innerHTML = `
    <button class="notif-bell-btn" id="notifBellBtn" title="Notifications" aria-label="Notifications">
      🔔
    </button>
    <span class="notif-badge" id="notifBadge" hidden>0</span>
  `;

  /* Insert before the theme toggle */
  const themeBtn = controls.querySelector("#themeToggle");
  if (themeBtn) {
    controls.insertBefore(wrap, themeBtn);
  } else {
    controls.prepend(wrap);
  }

  _bellBtn = document.getElementById("notifBellBtn");
  _badge   = document.getElementById("notifBadge");

  _bellBtn.addEventListener("click", e => {
    e.stopPropagation();
    _panelOpen ? _closePanel() : _openPanel();
  });
}

/* ═══════════════════════════════════════════════════════════════
   OPEN / CLOSE PANEL
════════════════════════════════════════════════════════════════ */
function _openPanel() {
  _closePanel(); // ensure only one
  _panelOpen = true;

  /* Overlay (click-away to close) */
  const overlay = document.createElement("div");
  overlay.className = "notif-overlay";
  overlay.id = "notifOverlay";
  overlay.addEventListener("click", _closePanel);
  document.body.appendChild(overlay);

  /* Panel */
  const panel = document.createElement("div");
  panel.className = "notif-panel";
  panel.id        = "notifPanel";
  panel.innerHTML = `
    <div class="notif-panel__header">
      <span class="notif-panel__title">🔔 Notifications</span>
      <div class="notif-panel__actions">
        <button class="notif-mark-all-btn" id="markAllReadBtn">Mark all read</button>
        <button class="notif-panel__close" id="notifPanelClose">✕</button>
      </div>
    </div>
    <div class="notif-list" id="notifList">
      <div class="notif-loading"><div class="notif-spinner"></div> Loading…</div>
    </div>
    <div class="notif-panel__footer">
      <span>Showing last 40 notifications</span>
    </div>
  `;
  document.body.appendChild(panel);

  document.getElementById("notifPanelClose").addEventListener("click", _closePanel);
  document.getElementById("markAllReadBtn").addEventListener("click", _markAllRead);

  /* Render current notifications */
  _renderNotifList();
}

function _closePanel() {
  document.getElementById("notifOverlay")?.remove();
  document.getElementById("notifPanel")?.remove();
  _panelOpen = false;
}

/* ═══════════════════════════════════════════════════════════════
   REAL-TIME LISTENER  (badge count)
════════════════════════════════════════════════════════════════ */
function _startListener(uid) {
  _unsubNotifs?.();

  const q = query(
    collection(db, "notifications", uid, "items"),
    orderBy("timestamp", "desc"),
    limit(40)
  );

  _unsubNotifs = onSnapshot(q, snap => {
    const unread = snap.docs.filter(d => !d.data().read).length;
    _updateBadge(unread);

    /* If panel is open, re-render */
    if (_panelOpen) _renderFromSnap(snap);
  }, err => console.warn("notif listener:", err));
}

/* ═══════════════════════════════════════════════════════════════
   UPDATE BADGE
════════════════════════════════════════════════════════════════ */
function _updateBadge(count) {
  if (!_badge) return;
  if (count > 0) {
    _badge.textContent = count > 99 ? "99+" : count;
    _badge.hidden = false;
    if (count > _prevCount) {
      _badge.classList.remove("pop");
      void _badge.offsetWidth;
      _badge.classList.add("pop");
      _bellBtn?.classList.add("has-unread");
      setTimeout(() => _bellBtn?.classList.remove("has-unread"), 1500);
    }
  } else {
    _badge.hidden = true;
  }
  _prevCount = count;
}

/* ═══════════════════════════════════════════════════════════════
   RENDER NOTIFICATIONS IN PANEL
════════════════════════════════════════════════════════════════ */
let _latestSnap = null;

async function _renderNotifList() {
  if (!currentUser) return;
  const list = document.getElementById("notifList");
  if (!list) return;

  if (_latestSnap) {
    _renderFromSnap(_latestSnap);
  }
  /* Mark all unread as read after a short delay */
  setTimeout(() => _markAllRead(), 1200);
}

function _renderFromSnap(snap) {
  _latestSnap = snap;
  const list = document.getElementById("notifList");
  if (!list) return;

  if (snap.empty) {
    list.innerHTML = `
      <div class="notif-empty">
        <span class="notif-empty__icon">🔕</span>
        <span class="notif-empty__text">No notifications yet</span>
      </div>`;
    return;
  }

  list.innerHTML = "";
  snap.forEach(d => {
    const item = _buildNotifItem(d.id, d.data());
    if (item) list.appendChild(item);
  });
}

/* ═══════════════════════════════════════════════════════════════
   BUILD A SINGLE NOTIFICATION ITEM
════════════════════════════════════════════════════════════════ */
function _buildNotifItem(id, data) {
  const { type, fromName, emoji, read, timestamp, postId, fromUid } = data;

  const time = timestamp?.toDate
    ? _timeAgo(timestamp.toDate())
    : "";

  const typeConfig = {
    follow:    { icon: "👤", bg: "follow",   text: `<strong>${_esc(fromName)}</strong> started following you.` },
    like:      { icon: "❤️", bg: "like",     text: `<strong>${_esc(fromName)}</strong> liked your post.` },
    reaction:  { icon: emoji || "😊", bg: "reaction", text: `<strong>${_esc(fromName)}</strong> reacted ${_esc(emoji || "")} to your post.` },
    comment:   { icon: "💬", bg: "comment",  text: `<strong>${_esc(fromName)}</strong> commented on your post.` },
    msg_react: { icon: emoji || "❤️", bg: "msg_react", text: `<strong>${_esc(fromName)}</strong> reacted ${_esc(emoji || "")} to your message.` },
  };

  const cfg = typeConfig[type] || { icon: "✦", bg: "follow", text: `<strong>${_esc(fromName)}</strong> interacted with you.` };

  const el = document.createElement("div");
  el.className = `notif-item${read ? "" : " unread"}`;
  el.dataset.id = id;

  el.innerHTML = `
    <div class="notif-item__type-icon notif-item__type-icon--${cfg.bg}">${cfg.icon}</div>
    <div class="notif-item__body">
      <div class="notif-item__text">${cfg.text}</div>
      <span class="notif-item__time">${time}</span>
    </div>
  `;

  /* Click: navigate to relevant content */
  el.addEventListener("click", () => {
    _markOneRead(id);
    _closePanel();
    if (type === "follow" && fromUid) {
      window.open(`profile.html?user=${fromUid}`, "_blank");
    } else if (postId) {
      /* Scroll to post section */
      document.getElementById("posts")?.scrollIntoView({ behavior: "smooth" });
    } else if (type === "msg_react") {
      document.getElementById("chat")?.scrollIntoView({ behavior: "smooth" });
    }
  });

  return el;
}

/* ═══════════════════════════════════════════════════════════════
   MARK ALL READ
════════════════════════════════════════════════════════════════ */
async function _markAllRead() {
  if (!currentUser || !_latestSnap) return;
  try {
    const batch = writeBatch(db);
    _latestSnap.docs.forEach(d => {
      if (!d.data().read) {
        batch.update(
          doc(db, "notifications", currentUser.uid, "items", d.id),
          { read: true }
        );
      }
    });
    await batch.commit();
    _updateBadge(0);
  } catch (err) {
    console.warn("markAllRead:", err);
  }
}

async function _markOneRead(notifId) {
  if (!currentUser) return;
  try {
    await updateDoc(
      doc(db, "notifications", currentUser.uid, "items", notifId),
      { read: true }
    );
  } catch { /* silent */ }
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════════════════════ */
function _esc(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function _timeAgo(date) {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60)   return "just now";
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff/86400)}d ago`;
  return date.toLocaleDateString("en-IN", { day:"numeric", month:"short" });
}

/* ═══════════════════════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════════════════════ */
onAuthChange((user, profile) => {
  if (user && profile?.profileComplete && !profile.banned) {
    _injectBell();
    _startListener(user.uid);
  } else {
    _unsubNotifs?.();
    _unsubNotifs = null;
    _closePanel();
    document.getElementById("notifBellWrap")?.remove();
    _bellBtn = null;
    _badge   = null;
    _prevCount = 0;
  }
});
