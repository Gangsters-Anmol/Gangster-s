/**
 * features/presence.js
 * ─────────────────────────────────────────────────────────────────
 * PURELY ADDITIVE — does not modify any existing file.
 *
 * What this file does:
 *  1. BROADCAST — writes online:true + lastSeen to users/{uid}
 *     on login, sends a heartbeat every 60 s, and sets
 *     online:false on tab close / hide / logout.
 *
 *  2. SIDEBAR INDICATORS — watches the private chat users list
 *     (#usersList) via MutationObserver. For every user list item
 *     that appears it:
 *       • Injects a green/grey presence dot
 *       • Subscribes to that user's Firestore doc (onSnapshot)
 *       • Updates the dot + adds "Active now" / "Last seen Xm ago"
 *         below the user's name in real-time
 *
 *  3. GROUP CHAT HEADER — shows a live "X online" count in the
 *     group chat tab label.
 *
 *  4. EXPORTS  getPresence(uid)  so profile.html can call it
 *     to show "Active now" / "Last seen" on profile pages.
 * ─────────────────────────────────────────────────────────────────
 */

import {
  doc, updateDoc, onSnapshot, getDocs,
  collection, serverTimestamp, getDoc
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

import { db }                         from "../firebase-config.js";
import { onAuthChange, currentUser }  from "../auth.js";

/* ═══════════════════════════════════════════════════════════════
   CONSTANTS
════════════════════════════════════════════════════════════════ */
const HEARTBEAT_INTERVAL = 55_000;   // 55 s  (Firestore TTL safe)
const OFFLINE_THRESHOLD  = 120_000;  // 2 min — if lastSeen > 2m ago → offline

/* ═══════════════════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════════════════════ */
let _heartbeatTimer  = null;
let _presenceUnsubs  = new Map();  // uid → unsubscribe fn
let _onlineCount     = 0;
let _onlineCountUnsub = null;

/* ═══════════════════════════════════════════════════════════════
   INJECT STYLES
════════════════════════════════════════════════════════════════ */
(function _injectStyles() {
  if (document.getElementById("presence-js-styles")) return;
  const s = document.createElement("style");
  s.id = "presence-js-styles";
  s.textContent = `
    /* ── Presence dot base ─────────────────────────────────── */
    .presence-dot {
      width: 10px; height: 10px;
      border-radius: 50%;
      border: 2px solid var(--bg, #f9f6f1);
      flex-shrink: 0;
      transition: background 0.4s ease, transform 0.3s ease;
      position: relative;
    }
    .presence-dot--online {
      background: #2ecc71;
      box-shadow: 0 0 0 0 rgba(46,204,113,0.6);
      animation: presence-pulse 2.2s ease-in-out infinite;
    }
    .presence-dot--offline { background: #bbb; }
    .presence-dot--away    { background: #f39c12; }

    @keyframes presence-pulse {
      0%   { box-shadow: 0 0 0 0   rgba(46,204,113,0.55); }
      60%  { box-shadow: 0 0 0 6px rgba(46,204,113,0); }
      100% { box-shadow: 0 0 0 0   rgba(46,204,113,0); }
    }

    /* ── User list item layout upgrade ─────────────────────── */
    .user-list-item {
      position: relative;
    }
    /* Dot positioned bottom-right of avatar */
    .user-list-item .presence-dot {
      position: absolute;
      bottom: 8px;
      left: 28px;   /* right edge of the 36px avatar */
      z-index: 2;
    }

    /* ── Presence text under user name ─────────────────────── */
    .presence-text {
      font-size: 0.68rem;
      line-height: 1.2;
      margin-top: 0.1rem;
      transition: color 0.3s ease;
      font-style: italic;
    }
    .presence-text--online { color: #2ecc71; font-style: normal; font-weight: 500; }
    .presence-text--away   { color: #f39c12; }
    .presence-text--offline{ color: var(--text-muted, #7a736b); }

    /* ── Group chat "X online" badge in tab ────────────────── */
    .online-count-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.68rem;
      font-family: 'Jost', sans-serif;
      color: #2ecc71;
      margin-left: 0.4rem;
      font-weight: 500;
      vertical-align: middle;
      white-space: nowrap;
      opacity: 0;
      transition: opacity 0.3s ease;
    }
    .online-count-badge.visible { opacity: 1; }
    .online-count-badge::before {
      content: "";
      width: 6px; height: 6px;
      border-radius: 50%;
      background: #2ecc71;
      display: inline-block;
      animation: presence-pulse 2.2s ease-in-out infinite;
      box-shadow: 0 0 0 0 rgba(46,204,113,0.6);
    }

    /* ── Presence badge on profile page ─────────────────────── */
    .profile-presence-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.2rem 0.7rem;
      border-radius: 50px;
      font-size: 0.72rem;
      font-family: 'Jost', sans-serif;
      font-weight: 500;
      border: 1px solid transparent;
    }
    .profile-presence-badge--online {
      background: rgba(46,204,113,0.1);
      color: #27ae60;
      border-color: rgba(46,204,113,0.25);
    }
    .profile-presence-badge--offline {
      background: var(--bg-alt, #f0ebe3);
      color: var(--text-muted, #7a736b);
      border-color: var(--border, rgba(0,0,0,0.08));
    }
    .profile-presence-badge::before {
      content: "";
      width: 7px; height: 7px;
      border-radius: 50%;
      display: inline-block;
    }
    .profile-presence-badge--online::before {
      background: #2ecc71;
      animation: presence-pulse 2.2s ease-in-out infinite;
      box-shadow: 0 0 0 0 rgba(46,204,113,0.6);
    }
    .profile-presence-badge--offline::before { background: #bbb; }
  `;
  document.head.appendChild(s);
})();

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: get presence info for any uid
   Returns { online: bool, lastSeen: Date|null }
════════════════════════════════════════════════════════════════ */
export async function getPresence(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return { online: false, lastSeen: null };
    const data = snap.data();
    return {
      online:   _isOnline(data),
      lastSeen: data.lastSeen?.toDate?.() || null,
    };
  } catch { return { online: false, lastSeen: null }; }
}

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: format a presence label string
════════════════════════════════════════════════════════════════ */
export function formatPresence(online, lastSeen) {
  if (online) return "Active now";
  if (!lastSeen) return "Offline";
  return "Last seen " + _timeAgo(lastSeen);
}

/* ═══════════════════════════════════════════════════════════════
   BROADCAST OWN PRESENCE
════════════════════════════════════════════════════════════════ */
function _setOnline(uid) {
  updateDoc(doc(db, "users", uid), {
    online:   true,
    lastSeen: serverTimestamp(),
  }).catch(() => {});
}

function _setOffline(uid) {
  updateDoc(doc(db, "users", uid), {
    online:   false,
    lastSeen: serverTimestamp(),
  }).catch(() => {});
}

function _startHeartbeat(uid) {
  _stopHeartbeat();
  _setOnline(uid);
  _heartbeatTimer = setInterval(() => _setOnline(uid), HEARTBEAT_INTERVAL);
}

function _stopHeartbeat() {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
}

/* ── Page visibility / unload handlers ──────────────────────── */
function _bindPageEvents(uid) {
  /* Tab hidden → mark offline; visible → mark online */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      _stopHeartbeat();
      _setOffline(uid);
    } else {
      _startHeartbeat(uid);
    }
  });

  /* Tab / window close */
  window.addEventListener("beforeunload", () => {
    _stopHeartbeat();
    /* Synchronous — best-effort */
    navigator.sendBeacon?.(
      `https://firestore.googleapis.com/v1/projects/gangster-s-2025-26/databases/(default)/documents/users/${uid}`,
      ""
    );
    _setOffline(uid);
  });

  /* Also handle pagehide (mobile Safari) */
  window.addEventListener("pagehide", () => {
    _stopHeartbeat();
    _setOffline(uid);
  });
}

/* ═══════════════════════════════════════════════════════════════
   DETERMINE ONLINE STATUS FROM DATA
   Considers a user online if their lastSeen is within the
   threshold AND online flag is true.
════════════════════════════════════════════════════════════════ */
function _isOnline(data) {
  if (!data.online) return false;
  if (!data.lastSeen) return false;
  const lastSeenMs = data.lastSeen?.toDate?.()?.getTime?.() || 0;
  return (Date.now() - lastSeenMs) < OFFLINE_THRESHOLD;
}

/* ═══════════════════════════════════════════════════════════════
   SIDEBAR — inject presence for a single user list item
════════════════════════════════════════════════════════════════ */
async function _decorateUserItem(item) {
  if (item.dataset.presenceInjected) return;
  item.dataset.presenceInjected = "1";

  /* Resolve UID from the item */
  const nameEl = item.querySelector(".user-list-name");
  if (!nameEl) return;
  const name = nameEl.textContent.trim();

  /* Look up UID (cached by follow.js if loaded, else query) */
  let uid = null;
  try {
    const { getDocs: gd, collection: col, query: q, where: w } =
      await import("https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js");
    const snap = await gd(q(col(db, "users"), w("name", "==", name)));
    if (snap.empty) return;
    uid = snap.docs[0].id;
  } catch { return; }

  if (!uid) return;

  /* Inject presence dot (positioned over avatar bottom-right) */
  const dot = document.createElement("span");
  dot.className = "presence-dot presence-dot--offline";
  dot.id        = `pdot-${uid}`;
  item.appendChild(dot);

  /* Inject presence text below the user name */
  const infoEl = item.querySelector(".user-list-info");
  let presenceTextEl = null;
  if (infoEl) {
    presenceTextEl = document.createElement("span");
    presenceTextEl.className = "presence-text presence-text--offline";
    presenceTextEl.id        = `ptxt-${uid}`;
    infoEl.appendChild(presenceTextEl);
  }

  /* Subscribe to live updates for this user */
  if (_presenceUnsubs.has(uid)) {
    /* Already watching — just update the new elements */
    return;
  }

  const unsub = onSnapshot(doc(db, "users", uid), snap => {
    if (!snap.exists()) return;
    const data   = snap.data();
    const online = _isOnline(data);
    const lastSeen = data.lastSeen?.toDate?.() || null;

    /* Update all dots for this UID on the page */
    document.querySelectorAll(`#pdot-${uid}`).forEach(d => {
      d.className = `presence-dot ${online ? "presence-dot--online" : "presence-dot--offline"}`;
    });

    /* Update all presence text elements */
    document.querySelectorAll(`#ptxt-${uid}`).forEach(el => {
      el.textContent = online ? "Active now" : (lastSeen ? "Last seen " + _timeAgo(lastSeen) : "Offline");
      el.className   = `presence-text ${online ? "presence-text--online" : "presence-text--offline"}`;
    });

    /* Update unread dot visibility (from chat.js) — keep the
       existing unread dot working alongside our presence dot */
  }, () => {});

  _presenceUnsubs.set(uid, unsub);
}

/* ═══════════════════════════════════════════════════════════════
   GROUP CHAT ONLINE COUNT
════════════════════════════════════════════════════════════════ */
function _startOnlineCount() {
  _onlineCountUnsub?.();

  /* We snapshot the users collection and count online users.
     To avoid excessive reads we only re-run when the group
     chat tab is active. We use a lightweight approach:
     snapshot users collection and filter client-side.       */
  const _refresh = async () => {
    try {
      const snap = await getDocs(collection(db, "users"));
      let count = 0;
      snap.forEach(d => {
        if (_isOnline(d.data())) count++;
      });
      _onlineCount = count;
      _updateGroupTabBadge(count);
    } catch { /* silent */ }
  };

  _refresh();
  /* Refresh every 90s (not real-time to save reads) */
  const timer = setInterval(_refresh, 90_000);
  _onlineCountUnsub = () => clearInterval(timer);
}

function _updateGroupTabBadge(count) {
  let badge = document.getElementById("onlineCountBadge");
  const groupTab = document.querySelector('.chat-tab[data-tab="group"]');
  if (!groupTab) return;

  if (!badge) {
    badge = document.createElement("span");
    badge.id        = "onlineCountBadge";
    badge.className = "online-count-badge";
    groupTab.appendChild(badge);
  }

  if (count > 0) {
    badge.textContent = `${count} online`;
    badge.classList.add("visible");
  } else {
    badge.classList.remove("visible");
  }
}

/* ═══════════════════════════════════════════════════════════════
   MUTATION OBSERVER — watch for user list items
════════════════════════════════════════════════════════════════ */
function _startObserver() {
  const observer = new MutationObserver(muts => {
    for (const mut of muts) {
      for (const node of mut.addedNodes) {
        if (!(node instanceof Element)) continue;

        if (node.matches?.(".user-list-item"))
          _decorateUserItem(node);
        node.querySelectorAll?.(".user-list-item")
          .forEach(_decorateUserItem);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/* ═══════════════════════════════════════════════════════════════
   PROCESS ALREADY-RENDERED ITEMS
════════════════════════════════════════════════════════════════ */
function _processExisting() {
  document.querySelectorAll(".user-list-item")
    .forEach(_decorateUserItem);
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════════════════════ */
function _timeAgo(date) {
  if (!date) return "a while ago";
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60)    return "just now";
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/* ═══════════════════════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════════════════════ */
onAuthChange((user, profile) => {
  if (user && profile?.profileComplete && !profile.banned) {
    /* 1. Broadcast own presence */
    _startHeartbeat(user.uid);
    _bindPageEvents(user.uid);

    /* 2. Observe sidebar for user list items */
    _startObserver();
    _processExisting();

    /* 3. Group chat online count */
    _startOnlineCount();

  } else {
    /* Cleanup on logout */
    if (currentUser) _setOffline(currentUser.uid);
    _stopHeartbeat();
    _presenceUnsubs.forEach(u => u());
    _presenceUnsubs.clear();
    _onlineCountUnsub?.();
    _onlineCountUnsub = null;
    document.getElementById("onlineCountBadge")?.remove();
  }
});
