/**
 * features/notifications.js — FULL REWRITE
 * ─────────────────────────────────────────────────────────────
 * BUGS FIXED:
 *  • Was injecting bell into .nav__controls (doesn't exist) — now
 *    wires directly to the existing #appNotifBell in index.html
 *  • notifDropdown HTML element was never connected to Firestore data
 *  • _latestSnap never stored, so panel always showed empty
 *  • sendNotification used wrong timestamp field
 *
 * NEW FEATURES:
 *  • Full-screen slide-in notification center (right drawer)
 *  • All notification types: follow, like, comment, comment_reply,
 *    reaction, msg_react, story_reply, story_like, mention, profile_like
 *  • Filter tabs: All · Unread · Social · Activity
 *  • Staggered entrance animations, smooth spring transitions
 *  • Bell pulse ring + wiggle on new notifications
 *  • Swipe-left to dismiss individual notifications
 *  • Rich grouped timeline (Today / Yesterday / This Week / Earlier)
 *  • Click each notification navigates to the right place
 * ─────────────────────────────────────────────────────────────
 */

import {
  collection, query, orderBy, limit,
  onSnapshot, updateDoc, deleteDoc,
  doc, writeBatch, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

import { db }                        from "../firebase-config.js";
import { onAuthChange, currentUser } from "../auth.js";

/* ══════════════════════════════════════════════════════════════
   PUBLIC API — used by reactions.js, follow.js, comment-notify.js
   etc. to fire notifications to other users
══════════════════════════════════════════════════════════════ */
export async function sendNotification(targetUid, payload) {
  if (!targetUid || !payload) return;
  if (payload.fromUid === targetUid) return; // never self-notify
  try {
    await addDoc(collection(db, "notifications", targetUid, "items"), {
      ...payload,
      read:      false,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn("sendNotification failed:", err);
  }
}

/* ══════════════════════════════════════════════════════════════
   INJECT STYLES
══════════════════════════════════════════════════════════════ */
(function _injectStyles() {
  if (document.getElementById("ncs-styles")) return;
  const s = document.createElement("style");
  s.id = "ncs-styles";
  s.textContent = `

  /* ── Bell enhancements ────────────────────────────────── */
  #appNotifBell {
    position: relative;
    transition: transform 0.25s var(--ease-out-expo, cubic-bezier(.16,1,.3,1)),
                background 0.2s, box-shadow 0.2s !important;
  }
  #appNotifBell.ncs-has-unread {
    background: linear-gradient(135deg,
      rgba(167,139,202,0.18), rgba(240,168,176,0.12)) !important;
    border-color: rgba(167,139,202,0.55) !important;
    box-shadow: 0 0 0 0 rgba(167,139,202,0.5);
  }
  #appNotifBell.ncs-has-unread::after {
    content: "";
    position: absolute; inset: -5px;
    border-radius: 50%;
    border: 2px solid var(--clr-accent, #a78bca);
    animation: ncs-bellPulse 2.4s ease-out infinite;
    pointer-events: none;
  }
  @keyframes ncs-bellPulse {
    0%   { opacity: .7; transform: scale(1); }
    70%  { opacity: 0;  transform: scale(1.6); }
    100% { opacity: 0;  transform: scale(1.6); }
  }
  #appNotifBell.ncs-ring {
    animation: ncs-bellWiggle 0.55s cubic-bezier(.36,.07,.19,.97);
  }
  @keyframes ncs-bellWiggle {
    0%,100% { transform: rotate(0) scale(1); }
    15%  { transform: rotate(14deg) scale(1.1); }
    30%  { transform: rotate(-11deg) scale(1.08); }
    45%  { transform: rotate(8deg) scale(1.05); }
    60%  { transform: rotate(-5deg) scale(1.02); }
    75%  { transform: rotate(3deg); }
  }

  /* Badge pop */
  #appNotifBadge.ncs-pop {
    animation: ncs-badgePop 0.4s cubic-bezier(.34,1.56,.64,1);
  }
  @keyframes ncs-badgePop {
    0%   { transform: scale(0) rotate(-10deg); }
    60%  { transform: scale(1.35) rotate(3deg); }
    100% { transform: scale(1) rotate(0); }
  }

  /* ── Backdrop ─────────────────────────────────────────── */
  .ncs-backdrop {
    position: fixed; inset: 0;
    z-index: 799;
    background: rgba(0,0,0,0);
    transition: background 0.35s ease;
    cursor: pointer;
  }
  .ncs-backdrop.ncs-visible {
    background: rgba(10,8,20,0.38);
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
  }

  /* ── Drawer ───────────────────────────────────────────── */
  .ncs-drawer {
    position: fixed;
    top: 0; right: 0; bottom: 0;
    width: min(420px, 100vw);
    z-index: 800;
    display: flex;
    flex-direction: column;
    background: var(--clr-modal-bg, rgba(252,250,255,0.98));
    border-left: 1px solid var(--clr-modal-border, rgba(167,139,202,0.2));
    box-shadow:
      -8px 0 40px rgba(100,80,140,0.12),
      -2px 0 80px rgba(0,0,0,0.12);
    backdrop-filter: blur(32px) saturate(1.8);
    -webkit-backdrop-filter: blur(32px) saturate(1.8);
    transform: translateX(100%);
    transition: transform 0.42s cubic-bezier(.16,1,.3,1);
    overflow: hidden;
  }
  .ncs-drawer.ncs-open {
    transform: translateX(0);
  }

  /* Fog shimmer strip at top */
  .ncs-drawer::before {
    content: "";
    position: absolute;
    top: 0; left: 0; right: 0; height: 3px;
    background: linear-gradient(90deg,
      var(--clr-accent, #a78bca),
      var(--clr-accent2, #f0a8b0),
      var(--clr-accent3, #7ecfcf),
      var(--clr-accent, #a78bca));
    background-size: 200% 100%;
    animation: ncs-shimmer 3s linear infinite;
    z-index: 1;
  }
  @keyframes ncs-shimmer {
    0%   { background-position: 0% 0; }
    100% { background-position: 200% 0; }
  }

  /* ── Header ───────────────────────────────────────────── */
  .ncs-header {
    padding: 1.2rem 1.4rem 0.9rem;
    border-bottom: 1px solid var(--clr-border, rgba(200,190,210,0.3));
    flex-shrink: 0;
    background: linear-gradient(160deg,
      rgba(167,139,202,0.06) 0%,
      rgba(240,168,176,0.04) 60%,
      transparent 100%);
  }
  .ncs-header-top {
    display: flex; align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }
  .ncs-header-left {
    display: flex; align-items: center; gap: 0.65rem;
  }
  .ncs-header-orb {
    width: 36px; height: 36px; border-radius: 50%;
    background: linear-gradient(135deg,
      var(--clr-accent, #a78bca),
      var(--clr-accent2, #f0a8b0));
    display: flex; align-items: center; justify-content: center;
    font-size: 1rem;
    box-shadow: 0 4px 14px rgba(167,139,202,0.35);
    animation: ncs-orbFloat 4s ease-in-out infinite;
  }
  @keyframes ncs-orbFloat {
    0%,100% { transform: translateY(0) rotate(0deg); }
    50%     { transform: translateY(-2px) rotate(4deg); }
  }
  .ncs-title {
    font-family: var(--font-display, 'Cormorant Garamond', serif);
    font-size: 1.3rem; font-weight: 600; letter-spacing: 0.02em;
    color: var(--clr-text, #2e2c3a);
    line-height: 1;
  }
  .ncs-subtitle {
    font-size: 0.68rem; color: var(--clr-muted, #7a7590);
    letter-spacing: 0.04em; margin-top: 0.15rem;
    font-family: var(--font-body, 'Jost', sans-serif);
  }
  .ncs-header-actions { display: flex; gap: 0.4rem; align-items: center; }
  .ncs-mark-btn {
    font-family: var(--font-body, 'Jost', sans-serif);
    font-size: 0.68rem; font-weight: 500;
    color: var(--clr-accent, #a78bca);
    background: rgba(167,139,202,0.1);
    border: 1px solid rgba(167,139,202,0.22);
    border-radius: 50px; padding: 0.25rem 0.7rem;
    cursor: pointer; letter-spacing: 0.04em;
    transition: all 0.2s;
  }
  .ncs-mark-btn:hover {
    background: var(--clr-accent, #a78bca);
    color: #fff; border-color: var(--clr-accent, #a78bca);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(167,139,202,0.3);
  }
  .ncs-close-btn {
    width: 30px; height: 30px; border-radius: 50%;
    border: 1px solid var(--clr-border, rgba(200,190,210,0.38));
    background: transparent;
    color: var(--clr-muted, #7a7590);
    font-size: 0.8rem; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.2s;
  }
  .ncs-close-btn:hover {
    background: var(--clr-danger, #e05c6a);
    color: #fff; border-color: var(--clr-danger, #e05c6a);
    transform: rotate(90deg) scale(1.1);
  }

  /* ── Tabs ─────────────────────────────────────────────── */
  .ncs-tabs {
    display: flex; gap: 0;
    padding: 0 1.4rem;
    border-bottom: 1px solid var(--clr-border, rgba(200,190,210,0.25));
    flex-shrink: 0; overflow-x: auto;
    scrollbar-width: none;
  }
  .ncs-tabs::-webkit-scrollbar { display: none; }
  .ncs-tab {
    padding: 0.7rem 0.9rem;
    background: transparent; border: none;
    border-bottom: 2px solid transparent;
    font-family: var(--font-body, 'Jost', sans-serif);
    font-size: 0.7rem; font-weight: 500;
    letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--clr-muted, #7a7590);
    cursor: pointer; transition: all 0.22s;
    margin-bottom: -1px; white-space: nowrap;
    position: relative;
  }
  .ncs-tab.active {
    color: var(--clr-accent, #a78bca);
    border-bottom-color: var(--clr-accent, #a78bca);
  }
  .ncs-tab-count {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 16px; height: 16px; border-radius: 50px;
    background: rgba(167,139,202,0.18);
    color: var(--clr-accent, #a78bca);
    font-size: 0.6rem; font-weight: 700;
    padding: 0 4px; margin-left: 4px;
    transition: all 0.2s;
  }
  .ncs-tab.active .ncs-tab-count {
    background: var(--clr-accent, #a78bca);
    color: #fff;
  }

  /* ── List ─────────────────────────────────────────────── */
  .ncs-list {
    flex: 1; overflow-y: auto;
    overscroll-behavior: contain;
    scroll-behavior: smooth;
    padding-bottom: 1rem;
  }
  .ncs-list::-webkit-scrollbar { width: 3px; }
  .ncs-list::-webkit-scrollbar-track { background: transparent; }
  .ncs-list::-webkit-scrollbar-thumb {
    background: var(--clr-border2, rgba(167,139,202,0.3));
    border-radius: 2px;
  }

  /* Group label */
  .ncs-group-label {
    padding: 0.65rem 1.4rem 0.3rem;
    font-family: var(--font-body, 'Jost', sans-serif);
    font-size: 0.62rem; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.12em;
    color: var(--clr-muted, #7a7590);
    position: sticky; top: 0; z-index: 2;
    background: var(--clr-modal-bg, rgba(252,250,255,0.98));
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    display: flex; align-items: center; gap: 0.5rem;
  }
  .ncs-group-label::after {
    content: "";
    flex: 1; height: 1px;
    background: var(--clr-border, rgba(200,190,210,0.3));
  }

  /* ── Notification item ────────────────────────────────── */
  .ncs-item {
    display: flex; align-items: flex-start; gap: 0.85rem;
    padding: 0.9rem 1.4rem;
    position: relative; cursor: pointer;
    transition: background 0.18s ease, transform 0.18s ease,
                opacity 0.25s ease;
    will-change: transform;
    animation: ncs-itemIn 0.4s cubic-bezier(.16,1,.3,1) both;
  }
  @keyframes ncs-itemIn {
    from { opacity: 0; transform: translateX(20px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  .ncs-item:hover {
    background: rgba(167,139,202,0.05);
    transform: translateX(-2px);
  }
  .ncs-item:active { transform: scale(0.98); }
  .ncs-item + .ncs-item {
    border-top: 1px solid var(--clr-border, rgba(200,190,210,0.15));
  }

  /* Unread state */
  .ncs-item.ncs-unread {
    background: linear-gradient(105deg,
      rgba(167,139,202,0.07) 0%,
      rgba(240,168,176,0.04) 100%);
  }
  .ncs-item.ncs-unread::before {
    content: "";
    position: absolute; left: 0; top: 14px; bottom: 14px;
    width: 3px; border-radius: 0 3px 3px 0;
    background: linear-gradient(180deg,
      var(--clr-accent, #a78bca),
      var(--clr-accent2, #f0a8b0));
  }

  /* Unread dot */
  .ncs-dot {
    position: absolute; top: 1rem; right: 1.2rem;
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--clr-accent, #a78bca);
    box-shadow: 0 0 0 3px rgba(167,139,202,0.2);
    flex-shrink: 0;
  }

  /* Avatar */
  .ncs-av {
    width: 44px; height: 44px;
    border-radius: 50%; flex-shrink: 0;
    position: relative;
  }
  .ncs-av-img {
    width: 44px; height: 44px; border-radius: 50%;
    object-fit: cover; display: block;
    border: 2px solid var(--clr-bg, #f7f5f2);
    box-shadow: 0 2px 8px rgba(100,80,140,0.12);
  }
  .ncs-av-init {
    width: 44px; height: 44px; border-radius: 50%;
    background: linear-gradient(135deg,
      var(--clr-accent, #a78bca),
      var(--clr-accent2, #f0a8b0));
    display: flex; align-items: center; justify-content: center;
    font-family: var(--font-display, 'Cormorant Garamond', serif);
    font-size: 1.15rem; font-weight: 600; color: #fff;
    border: 2px solid var(--clr-bg, #f7f5f2);
    box-shadow: 0 2px 8px rgba(100,80,140,0.15);
  }
  .ncs-type-badge {
    position: absolute; bottom: -3px; right: -3px;
    width: 20px; height: 20px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.7rem;
    border: 2px solid var(--clr-bg, #f7f5f2);
    z-index: 1;
  }
  .ncs-badge-follow    { background: rgba(91,159,240,0.9); }
  .ncs-badge-like      { background: rgba(224,92,106,0.9); }
  .ncs-badge-comment   { background: rgba(100,180,237,0.9); }
  .ncs-badge-reply     { background: rgba(168,216,140,0.9); }
  .ncs-badge-reaction  { background: rgba(245,200,66,0.9); }
  .ncs-badge-msg       { background: rgba(126,207,207,0.9); }
  .ncs-badge-mention   { background: rgba(240,168,176,0.9); }
  .ncs-badge-story     { background: rgba(255,163,102,0.9); }
  .ncs-badge-profile   { background: rgba(167,139,202,0.9); }
  .ncs-badge-default   { background: var(--clr-accent, #a78bca); }

  /* Body */
  .ncs-body { flex: 1; min-width: 0; }
  .ncs-text {
    font-family: var(--font-body, 'Jost', sans-serif);
    font-size: 0.83rem; line-height: 1.5;
    color: var(--clr-text2, #4a4760);
    word-break: break-word;
  }
  .ncs-text strong {
    font-weight: 600;
    color: var(--clr-text, #2e2c3a);
  }
  .ncs-preview {
    font-size: 0.75rem;
    color: var(--clr-muted, #7a7590);
    margin-top: 0.22rem;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    max-width: 220px;
    font-style: italic;
  }
  .ncs-time {
    font-size: 0.65rem; color: var(--clr-muted, #7a7590);
    margin-top: 0.25rem; display: block;
    letter-spacing: 0.03em;
  }

  /* Swipe-to-dismiss progress bar */
  .ncs-item.ncs-swiping .ncs-swipe-bar {
    display: block;
  }
  .ncs-swipe-bar {
    display: none;
    position: absolute; bottom: 0; left: 0;
    height: 2px;
    background: linear-gradient(90deg,
      var(--clr-accent, #a78bca),
      var(--clr-accent2, #f0a8b0));
    border-radius: 2px;
    transition: width 0.1s linear;
    pointer-events: none;
  }

  /* Dismiss animation */
  .ncs-item.ncs-dismiss {
    animation: ncs-itemOut 0.3s cubic-bezier(.4,0,.2,1) forwards;
  }
  @keyframes ncs-itemOut {
    to { opacity: 0; transform: translateX(60px); max-height: 0; padding: 0; }
  }

  /* ── Empty state ──────────────────────────────────────── */
  .ncs-empty {
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 3.5rem 1.5rem; gap: 1rem;
    color: var(--clr-muted, #7a7590);
  }
  .ncs-empty-orb {
    width: 72px; height: 72px; border-radius: 50%;
    background: linear-gradient(135deg,
      rgba(167,139,202,0.1),
      rgba(240,168,176,0.1));
    border: 1.5px dashed rgba(167,139,202,0.3);
    display: flex; align-items: center; justify-content: center;
    font-size: 2rem;
    animation: ncs-emptyFloat 3.5s ease-in-out infinite;
  }
  @keyframes ncs-emptyFloat {
    0%,100% { transform: translateY(0) rotate(0); }
    50%     { transform: translateY(-7px) rotate(5deg); }
  }
  .ncs-empty h4 {
    font-family: var(--font-display, 'Cormorant Garamond', serif);
    font-size: 1.15rem; font-weight: 600;
    color: var(--clr-text2, #4a4760); margin: 0;
  }
  .ncs-empty p {
    font-size: 0.78rem; color: var(--clr-muted, #7a7590);
    text-align: center; max-width: 210px; margin: 0;
  }

  /* ── Spinner ──────────────────────────────────────────── */
  .ncs-loading {
    display: flex; align-items: center; justify-content: center;
    padding: 3rem; gap: 0.65rem;
    color: var(--clr-muted, #7a7590);
    font-family: var(--font-body, 'Jost', sans-serif);
    font-size: 0.82rem;
  }
  .ncs-spinner {
    width: 20px; height: 20px;
    border: 2px solid var(--clr-border, rgba(200,190,210,0.4));
    border-top-color: var(--clr-accent, #a78bca);
    border-radius: 50%;
    animation: ncs-spin 0.75s linear infinite;
  }
  @keyframes ncs-spin { to { transform: rotate(360deg); } }

  /* ── Footer ───────────────────────────────────────────── */
  .ncs-footer {
    padding: 0.65rem 1.4rem;
    border-top: 1px solid var(--clr-border, rgba(200,190,210,0.2));
    text-align: center; flex-shrink: 0;
    background: linear-gradient(135deg,
      rgba(167,139,202,0.03), rgba(240,168,176,0.02));
  }
  .ncs-footer span {
    font-family: var(--font-body, 'Jost', sans-serif);
    font-size: 0.66rem;
    color: var(--clr-muted, #7a7590);
    letter-spacing: 0.05em;
  }

  /* ── Dark theme ───────────────────────────────────────── */
  [data-theme="dark"] .ncs-drawer {
    background: rgba(15,12,28,0.98);
    border-color: rgba(196,168,232,0.14);
    box-shadow:
      -8px 0 40px rgba(0,0,0,0.5),
      -2px 0 80px rgba(0,0,0,0.4);
  }
  [data-theme="dark"] .ncs-group-label {
    background: rgba(15,12,28,0.98);
  }
  [data-theme="dark"] .ncs-item.ncs-unread {
    background: linear-gradient(105deg,
      rgba(196,168,232,0.08), rgba(244,184,196,0.05));
  }
  [data-theme="dark"] .ncs-item:hover {
    background: rgba(196,168,232,0.07);
  }
  [data-theme="dark"] .ncs-av-img,
  [data-theme="dark"] .ncs-av-init {
    border-color: var(--clr-bg, #0f0d1a);
  }
  [data-theme="dark"] .ncs-type-badge {
    border-color: var(--clr-bg, #0f0d1a);
  }
  [data-theme="dark"] .ncs-footer {
    background: rgba(196,168,232,0.02);
  }
  `;
  document.head.appendChild(s);
})();

/* ══════════════════════════════════════════════════════════════
   NOTIFICATION TYPE CONFIG
══════════════════════════════════════════════════════════════ */
const TYPE_CONFIG = {
  follow: {
    icon: "👤", badgeClass: "ncs-badge-follow", tab: "social",
    label: (d) => `<strong>${_esc(d.fromName)}</strong> started following you.`,
  },
  like: {
    icon: "❤️", badgeClass: "ncs-badge-like", tab: "activity",
    label: (d) => `<strong>${_esc(d.fromName)}</strong> liked your post.`,
  },
  comment: {
    icon: "💬", badgeClass: "ncs-badge-comment", tab: "activity",
    label: (d) => `<strong>${_esc(d.fromName)}</strong> commented on your post.`,
  },
  comment_reply: {
    icon: "↩️", badgeClass: "ncs-badge-reply", tab: "activity",
    label: (d) => `<strong>${_esc(d.fromName)}</strong> replied to your comment.`,
  },
  reaction: {
    icon: (d) => d.emoji || "😊", badgeClass: "ncs-badge-reaction", tab: "activity",
    label: (d) => `<strong>${_esc(d.fromName)}</strong> reacted ${_esc(d.emoji || "")} to your post.`,
  },
  msg_react: {
    icon: (d) => d.emoji || "❤️", badgeClass: "ncs-badge-msg", tab: "activity",
    label: (d) => `<strong>${_esc(d.fromName)}</strong> reacted ${_esc(d.emoji || "")} to your message.`,
  },
  story_reply: {
    icon: "📖", badgeClass: "ncs-badge-story", tab: "activity",
    label: (d) => `<strong>${_esc(d.fromName)}</strong> replied to your story.`,
  },
  story_like: {
    icon: "✨", badgeClass: "ncs-badge-story", tab: "activity",
    label: (d) => `<strong>${_esc(d.fromName)}</strong> liked your story.`,
  },
  mention: {
    icon: "@", badgeClass: "ncs-badge-mention", tab: "social",
    label: (d) => `<strong>${_esc(d.fromName)}</strong> mentioned you in a ${_esc(d.context || "post")}.`,
  },
  profile_like: {
    icon: "💜", badgeClass: "ncs-badge-profile", tab: "social",
    label: (d) => `<strong>${_esc(d.fromName)}</strong> liked your profile.`,
  },
};

const DEFAULT_CONFIG = {
  icon: "✦", badgeClass: "ncs-badge-default", tab: "activity",
  label: (d) => `<strong>${_esc(d.fromName || "Someone")}</strong> interacted with you.`,
};

/* ══════════════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════════════ */
let _unsub      = null;
let _drawerOpen = false;
let _activeTab  = "all";
let _latestSnap = null;
let _prevCount  = 0;

/* DOM refs wired to existing HTML */
const _bell    = document.getElementById("appNotifBell");
const _badge   = document.getElementById("appNotifBadge");

// Remove the old dropdown from the DOM so it doesn't interfere
document.getElementById("notifDropdown")?.remove();

/* ══════════════════════════════════════════════════════════════
   BELL CLICK
══════════════════════════════════════════════════════════════ */
_bell?.addEventListener("click", e => {
  e.stopPropagation();
  _drawerOpen ? _closeDrawer() : _openDrawer();
});

/* ══════════════════════════════════════════════════════════════
   BADGE UPDATE
══════════════════════════════════════════════════════════════ */
function _updateBadge(count) {
  if (!_badge) return;
  if (count > 0) {
    const txt = count > 99 ? "99+" : String(count);
    _badge.textContent = txt;
    _badge.hidden = false;
    if (count > _prevCount) {
      _badge.classList.remove("ncs-pop");
      void _badge.offsetWidth;
      _badge.classList.add("ncs-pop");
      _bell?.classList.add("ncs-has-unread", "ncs-ring");
      setTimeout(() => _bell?.classList.remove("ncs-ring"), 650);
    }
  } else {
    _badge.hidden = true;
    _bell?.classList.remove("ncs-has-unread");
  }
  _prevCount = count;
}

/* ══════════════════════════════════════════════════════════════
   OPEN DRAWER
══════════════════════════════════════════════════════════════ */
function _openDrawer() {
  _drawerOpen = true;
  _activeTab = "all";

  // Backdrop
  const backdrop = document.createElement("div");
  backdrop.className = "ncs-backdrop";
  backdrop.id = "ncsBackdrop";
  backdrop.addEventListener("click", _closeDrawer);
  document.body.appendChild(backdrop);

  // Drawer
  const drawer = document.createElement("div");
  drawer.className = "ncs-drawer";
  drawer.id = "ncsDrawer";
  drawer.innerHTML = `
    <div class="ncs-header">
      <div class="ncs-header-top">
        <div class="ncs-header-left">
          <div class="ncs-header-orb">🔔</div>
          <div>
            <div class="ncs-title">Notifications</div>
            <div class="ncs-subtitle">What's happening in your class</div>
          </div>
        </div>
        <div class="ncs-header-actions">
          <button class="ncs-mark-btn" id="ncsMarkAll">Mark all read</button>
          <button class="ncs-close-btn" id="ncsClose">✕</button>
        </div>
      </div>
      <div class="ncs-tabs" id="ncsTabs">
        <button class="ncs-tab active" data-tab="all">All<span class="ncs-tab-count" id="ncsCountAll">0</span></button>
        <button class="ncs-tab" data-tab="unread">Unread<span class="ncs-tab-count" id="ncsCountUnread">0</span></button>
        <button class="ncs-tab" data-tab="social">Social<span class="ncs-tab-count" id="ncsCountSocial">0</span></button>
        <button class="ncs-tab" data-tab="activity">Activity<span class="ncs-tab-count" id="ncsCountActivity">0</span></button>
      </div>
    </div>
    <div class="ncs-list" id="ncsList">
      <div class="ncs-loading"><div class="ncs-spinner"></div> Loading…</div>
    </div>
    <div class="ncs-footer">
      <span>Showing last 50 notifications</span>
    </div>
  `;
  document.body.appendChild(drawer);

  // Animate in
  requestAnimationFrame(() => {
    backdrop.classList.add("ncs-visible");
    drawer.classList.add("ncs-open");
  });

  // Wire buttons
  document.getElementById("ncsClose").addEventListener("click", _closeDrawer);
  document.getElementById("ncsMarkAll").addEventListener("click", _markAllRead);
  document.getElementById("ncsTabs").querySelectorAll(".ncs-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".ncs-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      _activeTab = tab.dataset.tab;
      _renderList();
    });
  });

  // Keyboard close
  const _keyClose = e => { if (e.key === "Escape") _closeDrawer(); };
  document.addEventListener("keydown", _keyClose);
  drawer._keyClose = _keyClose;

  // Render
  if (_latestSnap) {
    _renderList();
  } else {
    setTimeout(() => {
      if (!document.getElementById("ncsList")) return;
      if (_latestSnap) _renderList();
      else _showEmpty("🔕", "No notifications yet", "We'll let you know when something happens.");
    }, 2500);
  }

  // Auto-mark read after 2s
  setTimeout(_markAllRead, 2000);
}

/* ══════════════════════════════════════════════════════════════
   CLOSE DRAWER
══════════════════════════════════════════════════════════════ */
function _closeDrawer() {
  const drawer   = document.getElementById("ncsDrawer");
  const backdrop = document.getElementById("ncsBackdrop");
  if (!drawer) return;

  // Remove keyboard listener
  if (drawer._keyClose) document.removeEventListener("keydown", drawer._keyClose);

  drawer.classList.remove("ncs-open");
  backdrop?.classList.remove("ncs-visible");

  setTimeout(() => {
    drawer.remove();
    backdrop?.remove();
  }, 420);

  _drawerOpen = false;
}

/* ══════════════════════════════════════════════════════════════
   RENDER LIST
══════════════════════════════════════════════════════════════ */
function _renderList() {
  const list = document.getElementById("ncsList");
  if (!list || !_latestSnap) return;

  const allDocs = _latestSnap.docs;

  // Count per tab
  const counts = { all: allDocs.length, unread: 0, social: 0, activity: 0 };
  allDocs.forEach(d => {
    const data = d.data();
    if (!data.read) counts.unread++;
    const cfg = TYPE_CONFIG[data.type];
    if (cfg?.tab === "social")   counts.social++;
    if (cfg?.tab === "activity") counts.activity++;
    if (!cfg) counts.activity++;
  });

  // Update tab counts
  Object.entries(counts).forEach(([tab, n]) => {
    const el = document.getElementById("ncsCount" + tab.charAt(0).toUpperCase() + tab.slice(1));
    if (el) el.textContent = n > 99 ? "99+" : n;
  });

  // Filter docs
  let docs = allDocs;
  if (_activeTab === "unread") {
    docs = docs.filter(d => !d.data().read);
  } else if (_activeTab === "social") {
    docs = docs.filter(d => {
      const cfg = TYPE_CONFIG[d.data().type];
      return cfg?.tab === "social";
    });
  } else if (_activeTab === "activity") {
    docs = docs.filter(d => {
      const cfg = TYPE_CONFIG[d.data().type];
      return !cfg || cfg.tab === "activity";
    });
  }

  if (!docs.length) {
    const emptyMap = {
      unread:   ["✓",  "All caught up!",         "No unread notifications right now."],
      social:   ["👥", "No social activity yet",  "Follow activity and mentions will appear here."],
      activity: ["💫", "No activity yet",         "Likes, comments, and reactions will appear here."],
      all:      ["🔕", "No notifications yet",    "We'll let you know when something happens."],
    };
    const [icon, title, msg] = emptyMap[_activeTab] || emptyMap.all;
    _showEmpty(icon, title, msg);
    return;
  }

  // Group by time
  const now   = Date.now();
  const DAY   = 86400000;
  const groups = [
    { label: "Today",      items: [], cutoff: now - DAY },
    { label: "Yesterday",  items: [], cutoff: now - 2*DAY },
    { label: "This Week",  items: [], cutoff: now - 7*DAY },
    { label: "Earlier",    items: [], cutoff: 0 },
  ];

  docs.forEach(d => {
    const data = d.data();
    const ts = data.createdAt?.seconds
      ? data.createdAt.seconds * 1000
      : (data.timestamp?.seconds ? data.timestamp.seconds * 1000 : 0);
    if      (ts > now - DAY)     groups[0].items.push({ d, ts });
    else if (ts > now - 2*DAY)   groups[1].items.push({ d, ts });
    else if (ts > now - 7*DAY)   groups[2].items.push({ d, ts });
    else                         groups[3].items.push({ d, ts });
  });

  list.innerHTML = "";
  let delay = 0;

  groups.forEach(group => {
    if (!group.items.length) return;

    const lbl = document.createElement("div");
    lbl.className = "ncs-group-label";
    lbl.textContent = group.label;
    list.appendChild(lbl);

    group.items.forEach(({ d, ts }) => {
      const item = _buildItem(d.id, d.data(), ts, delay);
      if (item) list.appendChild(item);
      delay += 28;
    });
  });
}

function _showEmpty(icon, title, msg) {
  const list = document.getElementById("ncsList");
  if (!list) return;
  list.innerHTML = `
    <div class="ncs-empty">
      <div class="ncs-empty-orb">${icon}</div>
      <h4>${title}</h4>
      <p>${msg}</p>
    </div>`;
}

/* ══════════════════════════════════════════════════════════════
   BUILD NOTIFICATION ITEM
══════════════════════════════════════════════════════════════ */
function _buildItem(id, data, ts, delayMs) {
  const cfg    = TYPE_CONFIG[data.type] || DEFAULT_CONFIG;
  const icon   = typeof cfg.icon === "function" ? cfg.icon(data) : cfg.icon;
  const text   = cfg.label(data);
  const time   = ts ? _timeAgo(new Date(ts)) : "";
  const init   = (data.fromName || "?")[0].toUpperCase();
  const isRead = !!data.read;

  const avHTML = data.fromPhotoURL
    ? `<img class="ncs-av-img" src="${_esc(data.fromPhotoURL)}"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
       <div class="ncs-av-init" style="display:none">${init}</div>`
    : `<div class="ncs-av-init">${init}</div>`;

  const previewHTML = data.preview
    ? `<div class="ncs-preview">${_esc(data.preview)}</div>`
    : "";

  const el = document.createElement("div");
  el.className = `ncs-item${isRead ? "" : " ncs-unread"}`;
  el.dataset.id = id;
  el.style.animationDelay = delayMs + "ms";

  el.innerHTML = `
    <div class="ncs-av">
      ${avHTML}
      <span class="ncs-type-badge ${cfg.badgeClass}">${icon}</span>
    </div>
    <div class="ncs-body">
      <div class="ncs-text">${text}</div>
      ${previewHTML}
      <span class="ncs-time">${time}</span>
    </div>
    ${!isRead ? '<div class="ncs-dot"></div>' : ""}
    <div class="ncs-swipe-bar"></div>
  `;

  // Click — navigate
  el.addEventListener("click", () => {
    _markOneRead(id);
    el.classList.remove("ncs-unread");
    el.querySelector(".ncs-dot")?.remove();
    _navigateTo(data);
    _closeDrawer();
  });

  // Swipe left to dismiss
  let startX = 0, startT = 0;
  el.addEventListener("touchstart", e => {
    startX = e.touches[0].clientX;
    startT = Date.now();
  }, { passive: true });

  el.addEventListener("touchmove", e => {
    const dx = startX - e.touches[0].clientX;
    if (dx > 10) {
      el.classList.add("ncs-swiping");
      const pct = Math.min(dx / 120, 1);
      const swipeBar = el.querySelector(".ncs-swipe-bar");
      if (swipeBar) swipeBar.style.width = (pct * 100) + "%";
    }
  }, { passive: true });

  el.addEventListener("touchend", e => {
    const dx = startX - e.changedTouches[0].clientX;
    const dt = Date.now() - startT;
    el.classList.remove("ncs-swiping");
    if (dx > 80 && dt < 400) {
      el.classList.add("ncs-dismiss");
      _markOneRead(id);
      setTimeout(() => el.remove(), 300);
    } else {
      const swipeBar = el.querySelector(".ncs-swipe-bar");
      if (swipeBar) swipeBar.style.width = "0";
    }
  }, { passive: true });

  return el;
}

/* ══════════════════════════════════════════════════════════════
   NAVIGATE ON CLICK
══════════════════════════════════════════════════════════════ */
function _navigateTo(data) {
  const { type, fromUid, postId } = data;
  if ((type === "follow" || type === "profile_like") && fromUid) {
    location.href = `profile.html?user=${fromUid}`;
  } else if (type === "mention" && fromUid) {
    location.href = `profile.html?user=${fromUid}`;
  } else if ((type === "msg_react") && typeof window.switchToTab === "function") {
    window.switchToTab("messages");
  } else if (postId) {
    // Switch to Community tab and try to scroll to the post
    if (typeof window.switchToTab === "function") window.switchToTab("community");
    setTimeout(() => {
      const el = document.querySelector(`[data-post-id="${postId}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 400);
  }
}

/* ══════════════════════════════════════════════════════════════
   REAL-TIME LISTENER
══════════════════════════════════════════════════════════════ */
function _startListener(uid) {
  _unsub?.();
  _latestSnap = null;

  const q = query(
    collection(db, "notifications", uid, "items"),
    orderBy("createdAt", "desc"),
    limit(50)
  );

  _unsub = onSnapshot(q, snap => {
    _latestSnap = snap;
    const unread = snap.docs.filter(d => !d.data().read).length;
    _updateBadge(unread);
    if (_drawerOpen) _renderList();
  }, err => {
    console.warn("ncs listener:", err);
  });
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
    unread.forEach(d =>
      batch.update(
        doc(db, "notifications", currentUser.uid, "items", d.id),
        { read: true }
      )
    );
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

/* ══════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════ */
function _esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function _timeAgo(date) {
  const d = Math.floor((Date.now() - date.getTime()) / 1000);
  if (d < 30)     return "just now";
  if (d < 60)     return `${d}s ago`;
  if (d < 3600)   return `${Math.floor(d / 60)}m ago`;
  if (d < 86400)  return `${Math.floor(d / 3600)}h ago`;
  if (d < 604800) return `${Math.floor(d / 86400)}d ago`;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/* ══════════════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════════════ */
onAuthChange((user, profile) => {
  if (user && profile?.profileComplete && !profile.banned) {
    _startListener(user.uid);
  } else {
    _unsub?.();
    _unsub = null;
    _latestSnap = null;
    _prevCount = 0;
    _closeDrawer();
    _updateBadge(0);
  }
});
