/**
 * features/notifications.js  —  REWRITTEN
 * ─────────────────────────────────────────────────────────────────
 * BUG FIX: _latestSnap was never stored when the panel was closed,
 *           so opening the panel always showed "No notifications".
 *           Fixed by storing snap on EVERY onSnapshot callback call.
 *
 * REDESIGN: Luxe glass panel, grouped by time, avatar images,
 *           staggered entrance, swipe-to-dismiss, pulse ring on bell.
 * ─────────────────────────────────────────────────────────────────
 */

import {
  collection, query, orderBy, limit,
  onSnapshot, updateDoc, doc, writeBatch, addDoc
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

import { db }                        from "../firebase-config.js";
import { onAuthChange, currentUser } from "../auth.js";

/* ══════════════════════════════════════════════════════════════
   PUBLIC API
══════════════════════════════════════════════════════════════ */
export async function sendNotification(targetUid, payload) {
  if (!targetUid || !payload) return;
  if (payload.fromUid === targetUid) return;
  try {
    await addDoc(collection(db, "notifications", targetUid, "items"), {
      ...payload,
      timestamp: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
      read: false,
    });
  } catch (err) {
    console.warn("sendNotification failed:", err);
  }
}

/* ══════════════════════════════════════════════════════════════
   STYLES
══════════════════════════════════════════════════════════════ */
(function _injectStyles() {
  if (document.getElementById("notif-js-styles")) return;
  const s = document.createElement("style");
  s.id = "notif-js-styles";
  s.textContent = `
  /* ── Bell ─────────────────────────────────────────────── */
  .notif-bell-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  .notif-bell-btn {
    width: 34px; height: 34px;
    border: 1px solid var(--border, rgba(200,190,210,0.38));
    border-radius: 50%;
    background: transparent;
    color: var(--text, #2e2c3a);
    font-size: 1rem;
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.16,1,0.3,1);
    display: flex; align-items: center; justify-content: center;
    position: relative;
    overflow: visible;
  }
  .notif-bell-btn:hover {
    background: var(--accent, #a78bca);
    color: #fff;
    border-color: var(--accent, #a78bca);
    transform: scale(1.08);
  }

  /* Pulse ring when there are unread notifs */
  .notif-bell-btn.has-unread::after {
    content: "";
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    border: 2px solid var(--accent, #a78bca);
    animation: bellRingPulse 2s ease-out infinite;
    pointer-events: none;
  }
  @keyframes bellRingPulse {
    0%   { opacity: .8; transform: scale(1); }
    70%  { opacity: 0;  transform: scale(1.55); }
    100% { opacity: 0;  transform: scale(1.55); }
  }
  .notif-bell-btn.ring {
    animation: bellWiggle 0.5s cubic-bezier(0.36,0.07,0.19,0.97);
  }
  @keyframes bellWiggle {
    0%,100% { transform: rotate(0); }
    20%  { transform: rotate(14deg); }
    40%  { transform: rotate(-12deg); }
    60%  { transform: rotate(9deg); }
    80%  { transform: rotate(-5deg); }
  }

  /* ── Badge ─────────────────────────────────────────────── */
  .notif-badge {
    position: absolute;
    top: -5px; right: -5px;
    min-width: 18px; height: 18px;
    border-radius: 50px;
    background: linear-gradient(135deg, #e05c6a, #c0394a);
    color: #fff;
    font-size: 0.58rem;
    font-weight: 700;
    font-family: 'Jost', sans-serif;
    display: flex; align-items: center; justify-content: center;
    padding: 0 4px;
    border: 2px solid var(--bg, #f7f5f2);
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(224,92,106,0.45);
  }
  .notif-badge[hidden] { display: none !important; }
  .notif-badge.pop {
    animation: badgePop 0.35s cubic-bezier(0.34,1.56,0.64,1);
  }
  @keyframes badgePop {
    0%   { transform: scale(0); }
    60%  { transform: scale(1.3); }
    100% { transform: scale(1); }
  }

  /* ── Overlay ───────────────────────────────────────────── */
  .notif-overlay {
    position: fixed; inset: 0; z-index: 800;
    background: rgba(0,0,0,0);
  }

  /* ── Panel ─────────────────────────────────────────────── */
  .notif-panel {
    position: fixed;
    top: 66px;
    right: clamp(0.5rem, 3vw, 1.5rem);
    width: min(400px, calc(100vw - 1rem));
    max-height: min(580px, 82vh);
    background: var(--surface2, rgba(255,255,255,0.96));
    backdrop-filter: blur(28px) saturate(1.6);
    -webkit-backdrop-filter: blur(28px) saturate(1.6);
    border: 1px solid var(--border2, rgba(167,139,202,0.25));
    border-radius: 20px;
    box-shadow:
      0 4px 24px rgba(100,80,140,0.12),
      0 24px 72px rgba(100,80,140,0.16),
      inset 0 1px 0 rgba(255,255,255,0.7);
    z-index: 801;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transform-origin: top right;
    animation: panelOpen 0.3s cubic-bezier(0.16,1,0.3,1) both;
  }
  @keyframes panelOpen {
    from { transform: scale(0.88) translateY(-12px); opacity: 0; }
    to   { transform: scale(1)    translateY(0);     opacity: 1; }
  }

  /* ── Header ────────────────────────────────────────────── */
  .notif-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 1rem 1.25rem 0.8rem;
    border-bottom: 1px solid var(--border, rgba(200,190,210,0.25));
    flex-shrink: 0;
    background: linear-gradient(135deg,
      rgba(167,139,202,0.06) 0%,
      rgba(240,168,176,0.04) 100%);
  }
  .notif-header-left {
    display: flex; align-items: center; gap: 0.55rem;
  }
  .notif-header-icon {
    width: 30px; height: 30px; border-radius: 50%;
    background: linear-gradient(135deg, var(--accent,#a78bca), var(--accent2,#f0a8b0));
    display: flex; align-items: center; justify-content: center;
    font-size: 0.88rem;
    box-shadow: 0 2px 10px rgba(167,139,202,0.3);
  }
  .notif-title {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.12rem; font-weight: 600;
    color: var(--text, #2e2c3a);
    letter-spacing: 0.02em;
  }
  .notif-header-actions { display: flex; align-items: center; gap: 0.4rem; }
  .notif-mark-btn {
    font-family: 'Jost', sans-serif;
    font-size: 0.7rem; font-weight: 500;
    color: var(--accent, #a78bca);
    background: rgba(167,139,202,0.1);
    border: 1px solid rgba(167,139,202,0.2);
    border-radius: 50px;
    padding: 0.22rem 0.65rem;
    cursor: pointer;
    transition: all 0.2s;
    letter-spacing: 0.03em;
  }
  .notif-mark-btn:hover {
    background: var(--accent, #a78bca);
    color: #fff; border-color: var(--accent, #a78bca);
  }
  .notif-close-btn {
    width: 26px; height: 26px; border-radius: 50%;
    border: 1px solid var(--border, rgba(200,190,210,0.4));
    background: transparent; color: var(--muted, #7a7590);
    font-size: 0.78rem; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.2s;
  }
  .notif-close-btn:hover { background: #e05c6a; color: #fff; border-color: #e05c6a; }

  /* ── Tabs ──────────────────────────────────────────────── */
  .notif-tabs {
    display: flex; gap: 0;
    border-bottom: 1px solid var(--border, rgba(200,190,210,0.25));
    flex-shrink: 0; padding: 0 1rem;
  }
  .notif-tab {
    padding: 0.55rem 0.85rem;
    background: transparent; border: none;
    border-bottom: 2px solid transparent;
    font-family: 'Jost', sans-serif; font-size: 0.72rem;
    font-weight: 500; letter-spacing: 0.07em;
    text-transform: uppercase; color: var(--muted, #7a7590);
    cursor: pointer; transition: all 0.2s; margin-bottom: -1px;
    white-space: nowrap;
  }
  .notif-tab.active {
    color: var(--accent, #a78bca);
    border-bottom-color: var(--accent, #a78bca);
  }

  /* ── List ──────────────────────────────────────────────── */
  .notif-list {
    flex: 1; overflow-y: auto; overscroll-behavior: contain;
  }
  .notif-list::-webkit-scrollbar { width: 3px; }
  .notif-list::-webkit-scrollbar-track { background: transparent; }
  .notif-list::-webkit-scrollbar-thumb {
    background: var(--border, rgba(200,190,210,0.4));
    border-radius: 2px;
  }

  /* ── Date Group ────────────────────────────────────────── */
  .notif-group-label {
    padding: 0.55rem 1.25rem 0.3rem;
    font-family: 'Jost', sans-serif;
    font-size: 0.65rem; font-weight: 500;
    text-transform: uppercase; letter-spacing: 0.1em;
    color: var(--muted, #7a7590);
    position: sticky; top: 0; z-index: 1;
    background: var(--surface2, rgba(255,255,255,0.96));
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border, rgba(200,190,210,0.15));
  }

  /* ── Notification Item ─────────────────────────────────── */
  .notif-item {
    display: flex; align-items: flex-start; gap: 0.75rem;
    padding: 0.8rem 1.25rem;
    border-bottom: 1px solid var(--border, rgba(200,190,210,0.12));
    transition: background 0.18s ease, transform 0.18s ease;
    cursor: pointer; position: relative;
    animation: notifSlideIn 0.3s cubic-bezier(0.16,1,0.3,1) both;
  }
  @keyframes notifSlideIn {
    from { opacity: 0; transform: translateX(12px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  .notif-item:last-child { border-bottom: none; }
  .notif-item:hover {
    background: rgba(167,139,202,0.05);
    transform: translateX(2px);
  }
  .notif-item:active { transform: scale(0.98); }

  /* Unread accent */
  .notif-item.unread {
    background: linear-gradient(135deg,
      rgba(167,139,202,0.06) 0%,
      rgba(240,168,176,0.04) 100%);
  }
  .notif-item.unread::before {
    content: "";
    position: absolute; left: 0; top: 12px; bottom: 12px;
    width: 3px; border-radius: 0 3px 3px 0;
    background: linear-gradient(180deg, var(--accent,#a78bca), var(--accent2,#f0a8b0));
  }
  .notif-item.unread .notif-dot {
    display: block;
  }

  /* Unread dot */
  .notif-dot {
    display: none;
    position: absolute; top: 0.9rem; right: 1rem;
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--accent, #a78bca);
    box-shadow: 0 0 0 2px rgba(167,139,202,0.2);
  }

  /* Avatar */
  .notif-av {
    width: 40px; height: 40px; border-radius: 50%;
    flex-shrink: 0; position: relative; overflow: visible;
  }
  .notif-av-img {
    width: 40px; height: 40px; border-radius: 50%;
    object-fit: cover; display: block;
    border: 2px solid var(--bg, #f7f5f2);
  }
  .notif-av-init {
    width: 40px; height: 40px; border-radius: 50%;
    background: linear-gradient(135deg, var(--accent,#a78bca), var(--accent2,#f0a8b0));
    display: flex; align-items: center; justify-content: center;
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.1rem; font-weight: 600; color: #fff;
    border: 2px solid var(--bg, #f7f5f2);
  }
  .notif-type-badge {
    position: absolute; bottom: -2px; right: -2px;
    width: 18px; height: 18px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.68rem;
    border: 2px solid var(--bg, #f7f5f2);
    z-index: 1;
  }
  .badge-follow   { background: rgba(91,159,240,0.9); }
  .badge-like     { background: rgba(224,92,106,0.9); }
  .badge-reaction { background: rgba(245,200,66,0.9); }
  .badge-comment  { background: rgba(100,180,237,0.9); }
  .badge-msg_react{ background: rgba(126,207,207,0.9); }
  .badge-default  { background: var(--accent,#a78bca); }

  /* Body */
  .notif-body { flex: 1; min-width: 0; padding-right: 0.5rem; }
  .notif-text {
    font-size: 0.82rem; line-height: 1.45;
    color: var(--text, #2e2c3a);
    word-break: break-word;
  }
  .notif-text strong { font-weight: 600; color: var(--text, #2e2c3a); }
  .notif-time {
    font-size: 0.68rem; color: var(--muted, #7a7590);
    margin-top: 0.18rem; display: block; letter-spacing: 0.02em;
  }

  /* Swipe-to-dismiss visual hint */
  .notif-item.swiping { transition: none; }

  /* ── Empty ─────────────────────────────────────────────── */
  .notif-empty {
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 3rem 1.5rem; gap: 0.75rem;
    color: var(--muted, #7a7590);
  }
  .notif-empty-ring {
    width: 64px; height: 64px; border-radius: 50%;
    background: linear-gradient(135deg,
      rgba(167,139,202,0.1), rgba(240,168,176,0.1));
    border: 1.5px dashed var(--border2, rgba(167,139,202,0.3));
    display: flex; align-items: center; justify-content: center;
    font-size: 1.8rem;
    animation: emptyFloat 3s ease-in-out infinite;
  }
  @keyframes emptyFloat {
    0%,100% { transform: translateY(0); }
    50%     { transform: translateY(-5px); }
  }
  .notif-empty h4 {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.1rem; font-weight: 600;
    color: var(--text2, #4a4760); margin: 0;
  }
  .notif-empty p {
    font-size: 0.78rem; color: var(--muted, #7a7590);
    text-align: center; max-width: 200px; margin: 0;
  }

  /* ── Loading ───────────────────────────────────────────── */
  .notif-loading {
    display: flex; align-items: center; justify-content: center;
    padding: 2.5rem; gap: 0.6rem;
    color: var(--muted, #7a7590); font-size: 0.82rem;
  }
  .notif-spinner {
    width: 18px; height: 18px;
    border: 2px solid var(--border, rgba(200,190,210,0.4));
    border-top-color: var(--accent, #a78bca);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Footer ────────────────────────────────────────────── */
  .notif-footer {
    padding: 0.55rem 1.25rem;
    border-top: 1px solid var(--border, rgba(200,190,210,0.2));
    text-align: center; flex-shrink: 0;
    background: linear-gradient(135deg,
      rgba(167,139,202,0.03), rgba(240,168,176,0.03));
  }
  .notif-footer span {
    font-size: 0.68rem;
    color: var(--muted, #7a7590);
    letter-spacing: 0.04em;
  }

  /* Dark theme overrides */
  [data-theme="dark"] .notif-panel {
    background: rgba(18,14,36,0.97);
    border-color: rgba(196,168,232,0.18);
    box-shadow:
      0 4px 24px rgba(0,0,0,0.4),
      0 24px 72px rgba(0,0,0,0.5),
      inset 0 1px 0 rgba(255,255,255,0.06);
  }
  [data-theme="dark"] .notif-group-label {
    background: rgba(18,14,36,0.97);
  }
  [data-theme="dark"] .notif-item.unread {
    background: linear-gradient(135deg,
      rgba(196,168,232,0.07), rgba(244,184,196,0.04));
  }
  [data-theme="dark"] .notif-item:hover {
    background: rgba(196,168,232,0.07);
  }
  `;
  document.head.appendChild(s);
})();

/* ══════════════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════════════ */
let _unsub      = null;
let _panelOpen  = false;
let _bellBtn    = null;
let _badge      = null;
let _prevCount  = 0;
let _latestSnap = null;   // ← THE FIX: always stored on every snapshot
let _activeTab  = "all";  // "all" | "unread"

/* ══════════════════════════════════════════════════════════════
   INJECT BELL
══════════════════════════════════════════════════════════════ */
function _injectBell() {
  if (document.getElementById("notifBellWrap")) return;

  const controls = document.querySelector(".nav__controls");
  if (!controls) return;

  const wrap = document.createElement("div");
  wrap.className = "notif-bell-wrap";
  wrap.id = "notifBellWrap";
  wrap.innerHTML = `
    <button class="notif-bell-btn" id="notifBellBtn" title="Notifications" aria-label="Notifications">
      🔔
    </button>
    <span class="notif-badge" id="notifBadge" hidden>0</span>
  `;

  const themeBtn = controls.querySelector("#themeToggle");
  if (themeBtn) controls.insertBefore(wrap, themeBtn);
  else controls.prepend(wrap);

  _bellBtn = document.getElementById("notifBellBtn");
  _badge   = document.getElementById("notifBadge");

  _bellBtn.addEventListener("click", e => {
    e.stopPropagation();
    _panelOpen ? _closePanel() : _openPanel();
  });
}

/* ══════════════════════════════════════════════════════════════
   REAL-TIME LISTENER
══════════════════════════════════════════════════════════════ */
function _startListener(uid) {
  _unsub?.();

  const q = query(
    collection(db, "notifications", uid, "items"),
    orderBy("timestamp", "desc"),
    limit(40)
  );

  _unsub = onSnapshot(q, snap => {
    // ✅ THE FIX: store snapshot ALWAYS, not just when panel is open
    _latestSnap = snap;

    const unread = snap.docs.filter(d => !d.data().read).length;
    _updateBadge(unread);

    // Re-render if panel is open
    if (_panelOpen) _renderList();

  }, err => {
    console.warn("notif listener:", err);
    if (_panelOpen) {
      const list = document.getElementById("notifList");
      if (list) list.innerHTML = `
        <div class="notif-empty">
          <div class="notif-empty-ring">⚠️</div>
          <h4>Could not load</h4>
          <p>Please refresh the page.</p>
        </div>`;
    }
  });
}

/* ══════════════════════════════════════════════════════════════
   UPDATE BADGE
══════════════════════════════════════════════════════════════ */
function _updateBadge(count) {
  if (!_badge) return;
  if (count > 0) {
    _badge.textContent = count > 99 ? "99+" : count;
    _badge.hidden = false;
    if (count > _prevCount) {
      _badge.classList.remove("pop");
      void _badge.offsetWidth;
      _badge.classList.add("pop");
      _bellBtn?.classList.add("has-unread", "ring");
      setTimeout(() => _bellBtn?.classList.remove("ring"), 600);
    }
  } else {
    _badge.hidden = true;
    _bellBtn?.classList.remove("has-unread");
  }
  _prevCount = count;
}

/* ══════════════════════════════════════════════════════════════
   OPEN / CLOSE PANEL
══════════════════════════════════════════════════════════════ */
function _openPanel() {
  _closePanel();
  _panelOpen = true;
  _activeTab = "all";

  const overlay = document.createElement("div");
  overlay.className = "notif-overlay";
  overlay.id = "notifOverlay";
  overlay.addEventListener("click", _closePanel);
  document.body.appendChild(overlay);

  const panel = document.createElement("div");
  panel.className = "notif-panel";
  panel.id = "notifPanel";
  panel.innerHTML = `
    <div class="notif-header">
      <div class="notif-header-left">
        <div class="notif-header-icon">🔔</div>
        <span class="notif-title">Notifications</span>
      </div>
      <div class="notif-header-actions">
        <button class="notif-mark-btn" id="notifMarkAll">Mark all read</button>
        <button class="notif-close-btn" id="notifClose">✕</button>
      </div>
    </div>
    <div class="notif-tabs">
      <button class="notif-tab active" data-tab="all">All</button>
      <button class="notif-tab" data-tab="unread">Unread</button>
    </div>
    <div class="notif-list" id="notifList">
      <div class="notif-loading"><div class="notif-spinner"></div> Loading…</div>
    </div>
    <div class="notif-footer"><span>Showing last 40 notifications</span></div>
  `;
  document.body.appendChild(panel);

  document.getElementById("notifClose").addEventListener("click", _closePanel);
  document.getElementById("notifMarkAll").addEventListener("click", _markAllRead);

  // Tabs
  panel.querySelectorAll(".notif-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      panel.querySelectorAll(".notif-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      _activeTab = tab.dataset.tab;
      _renderList();
    });
  });

  // Render immediately — _latestSnap is now always populated
  if (_latestSnap) {
    _renderList();
  } else {
    // Listener hasn't fired yet (very first open) — wait briefly
    setTimeout(() => {
      if (_latestSnap) _renderList();
      else {
        const list = document.getElementById("notifList");
        if (list?.querySelector(".notif-loading")) {
          list.innerHTML = `
            <div class="notif-empty">
              <div class="notif-empty-ring">🔕</div>
              <h4>No notifications yet</h4>
              <p>We'll let you know when something happens.</p>
            </div>`;
        }
      }
    }, 3000);
  }

  // Auto-mark as read after 1.5s
  setTimeout(_markAllRead, 1500);
}

function _closePanel() {
  document.getElementById("notifOverlay")?.remove();
  document.getElementById("notifPanel")?.remove();
  _panelOpen = false;
}

/* ══════════════════════════════════════════════════════════════
   RENDER LIST
══════════════════════════════════════════════════════════════ */
function _renderList() {
  const list = document.getElementById("notifList");
  if (!list || !_latestSnap) return;

  let docs = _latestSnap.docs;

  // Filter for unread tab
  if (_activeTab === "unread") {
    docs = docs.filter(d => !d.data().read);
  }

  if (!docs.length) {
    list.innerHTML = `
      <div class="notif-empty">
        <div class="notif-empty-ring">${_activeTab === "unread" ? "✓" : "🔕"}</div>
        <h4>${_activeTab === "unread" ? "All caught up!" : "No notifications yet"}</h4>
        <p>${_activeTab === "unread" ? "No unread notifications." : "We'll let you know when something happens."}</p>
      </div>`;
    return;
  }

  // Group by time
  const groups = { Today: [], Yesterday: [], "This Week": [], Earlier: [] };
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yest  = new Date(today - 86400000);
  const week  = new Date(today - 6 * 86400000);

  docs.forEach(d => {
    const ts = d.data().timestamp?.toDate?.() || new Date(0);
    const day = new Date(ts.getFullYear(), ts.getMonth(), ts.getDate());
    if (day >= today)        groups["Today"].push(d);
    else if (day >= yest)    groups["Yesterday"].push(d);
    else if (day >= week)    groups["This Week"].push(d);
    else                     groups["Earlier"].push(d);
  });

  list.innerHTML = "";
  let globalDelay = 0;

  Object.entries(groups).forEach(([label, items]) => {
    if (!items.length) return;

    const groupEl = document.createElement("div");
    groupEl.className = "notif-group-label";
    groupEl.textContent = label;
    list.appendChild(groupEl);

    items.forEach(d => {
      const item = _buildItem(d.id, d.data(), globalDelay);
      if (item) list.appendChild(item);
      globalDelay += 30;
    });
  });
}

/* ══════════════════════════════════════════════════════════════
   BUILD ITEM
══════════════════════════════════════════════════════════════ */
function _buildItem(id, data, delayMs = 0) {
  const { type, fromName, fromPhotoURL, emoji, read, timestamp, postId, fromUid } = data;

  const time = timestamp?.toDate ? _timeAgo(timestamp.toDate()) : "";

  const configs = {
    follow:    { badge: "badge-follow",    icon: "👤", text: `<strong>${_esc(fromName)}</strong> started following you.` },
    like:      { badge: "badge-like",      icon: "❤️", text: `<strong>${_esc(fromName)}</strong> liked your post.` },
    reaction:  { badge: "badge-reaction",  icon: emoji || "😊", text: `<strong>${_esc(fromName)}</strong> reacted ${_esc(emoji||"")} to your post.` },
    comment:   { badge: "badge-comment",   icon: "💬", text: `<strong>${_esc(fromName)}</strong> commented on your post.` },
    msg_react: { badge: "badge-msg_react", icon: emoji || "❤️", text: `<strong>${_esc(fromName)}</strong> reacted ${_esc(emoji||"")} to your message.` },
  };
  const cfg = configs[type] || { badge: "badge-default", icon: "✦", text: `<strong>${_esc(fromName)}</strong> interacted with you.` };

  const init = (fromName || "?")[0].toUpperCase();
  const avHTML = fromPhotoURL
    ? `<img class="notif-av-img" src="${_esc(fromPhotoURL)}" onerror="this.style.display='none'" />`
    : `<div class="notif-av-init">${init}</div>`;

  const el = document.createElement("div");
  el.className = `notif-item${read ? "" : " unread"}`;
  el.dataset.id = id;
  el.style.animationDelay = delayMs + "ms";
  el.innerHTML = `
    <div class="notif-av">
      ${avHTML}
      <span class="notif-type-badge ${cfg.badge}">${cfg.icon}</span>
    </div>
    <div class="notif-body">
      <div class="notif-text">${cfg.text}</div>
      <span class="notif-time">${time}</span>
    </div>
    <div class="notif-dot"></div>
  `;

  el.addEventListener("click", () => {
    _markOneRead(id);
    el.classList.remove("unread");
    el.querySelector(".notif-dot").style.display = "none";
    _closePanel();
    if (type === "follow" && fromUid) {
      location.href = `profile.html?user=${fromUid}`;
    } else if (postId) {
      document.getElementById("posts")?.scrollIntoView({ behavior: "smooth" });
    } else if (type === "msg_react") {
      document.getElementById("chat")?.scrollIntoView({ behavior: "smooth" });
    }
  });

  // Touch swipe-right to dismiss
  let startX = 0;
  el.addEventListener("touchstart", e => { startX = e.touches[0].clientX; }, { passive: true });
  el.addEventListener("touchend", e => {
    const dx = e.changedTouches[0].clientX - startX;
    if (dx > 80) { _markOneRead(id); el.classList.remove("unread"); el.querySelector(".notif-dot").style.display = "none"; }
  }, { passive: true });

  return el;
}

/* ══════════════════════════════════════════════════════════════
   MARK READ
══════════════════════════════════════════════════════════════ */
async function _markAllRead() {
  if (!currentUser || !_latestSnap) return;
  const unread = _latestSnap.docs.filter(d => !d.data().read);
  if (!unread.length) return;
  try {
    const batch = writeBatch(db);
    unread.forEach(d => batch.update(
      doc(db, "notifications", currentUser.uid, "items", d.id),
      { read: true }
    ));
    await batch.commit();
    _updateBadge(0);
  } catch (err) { console.warn("markAllRead:", err); }
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

/* ══════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════ */
function _esc(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function _timeAgo(date) {
  const d = Math.floor((Date.now() - date.getTime()) / 1000);
  if (d < 60)     return "just now";
  if (d < 3600)   return `${Math.floor(d/60)}m ago`;
  if (d < 86400)  return `${Math.floor(d/3600)}h ago`;
  if (d < 604800) return `${Math.floor(d/86400)}d ago`;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/* ══════════════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════════════ */
onAuthChange((user, profile) => {
  if (user && profile?.profileComplete && !profile.banned) {
    _injectBell();
    _startListener(user.uid);
  } else {
    _unsub?.();
    _unsub = null;
    _latestSnap = null;
    _closePanel();
    document.getElementById("notifBellWrap")?.remove();
    _bellBtn = null;
    _badge = null;
    _prevCount = 0;
  }
});
