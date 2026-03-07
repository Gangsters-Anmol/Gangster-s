/**
 * features/follow.js
 * ─────────────────────────────────────────────────────────────────
 * PURELY ADDITIVE — never modifies posts.js, chat.js, or auth.js.
 *
 * What this file does:
 *  1. Watches the posts feed via MutationObserver — makes every
 *     post author name a clickable link to their profile page.
 *  2. Watches the chat panels — makes every chat bubble author
 *     name a clickable profile link.
 *  3. On page load, checks localStorage for an "openDMWith" key
 *     (set by profile.html's Message button) and auto-opens the
 *     correct private chat conversation.
 *  4. Makes usersList items in the private chat sidebar also link
 *     to profiles (long-press / right-click → open profile).
 *  5. Adds a subtle "View Profile" tooltip on hover over author names.
 * ─────────────────────────────────────────────────────────────────
 */

import {
  collection, query, where, getDocs, doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

import { db }                          from "../firebase-config.js";
import { onAuthChange, currentUser }   from "../auth.js";

/* ═══════════════════════════════════════════════════════════════
   INJECT STYLES  (appended to <head> once)
════════════════════════════════════════════════════════════════ */
(function _injectStyles() {
  if (document.getElementById("follow-js-styles")) return;
  const style = document.createElement("style");
  style.id = "follow-js-styles";
  style.textContent = `
    /* Profile link on post author name */
    .profile-link {
      cursor: pointer;
      text-decoration: none;
      color: inherit;
      position: relative;
      transition: color 0.2s ease;
    }
    .profile-link:hover {
      color: var(--accent, #c8a96e);
    }
    .profile-link::after {
      content: "View Profile ↗";
      position: absolute;
      bottom: calc(100% + 6px);
      left: 50%;
      transform: translateX(-50%) scale(0.85);
      background: var(--text, #1a1613);
      color: var(--bg, #f9f6f1);
      font-size: 0.68rem;
      font-family: 'Jost', sans-serif;
      white-space: nowrap;
      padding: 0.25rem 0.6rem;
      border-radius: 50px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s ease, transform 0.15s ease;
      z-index: 50;
    }
    .profile-link:hover::after {
      opacity: 1;
      transform: translateX(-50%) scale(1);
    }

    /* User list item — profile icon button */
    .user-list-item .profile-icon-btn {
      margin-left: auto;
      width: 26px; height: 26px;
      border-radius: 50%;
      border: 1px solid var(--border, rgba(0,0,0,0.08));
      background: transparent;
      color: var(--text-muted, #7a736b);
      font-size: 0.75rem;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.2s ease;
      flex-shrink: 0;
      opacity: 0;
      pointer-events: none;
    }
    .user-list-item:hover .profile-icon-btn {
      opacity: 1;
      pointer-events: auto;
    }
    .user-list-item .profile-icon-btn:hover {
      background: var(--accent, #c8a96e);
      color: #fff;
      border-color: var(--accent, #c8a96e);
    }
  `;
  document.head.appendChild(style);
})();

/* ═══════════════════════════════════════════════════════════════
   UID CACHE — avoid repeated Firestore reads for same author name
════════════════════════════════════════════════════════════════ */
const _uidCache = new Map(); // authorName → uid

async function _getUidByName(name) {
  if (_uidCache.has(name)) return _uidCache.get(name);
  try {
    const q    = query(collection(db, "users"), where("name", "==", name));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const uid = snap.docs[0].id;
      _uidCache.set(name, uid);
      return uid;
    }
  } catch { /* silent */ }
  return null;
}

/* ═══════════════════════════════════════════════════════════════
   MAKE ELEMENT A PROFILE LINK
════════════════════════════════════════════════════════════════ */
function _makeProfileLink(el, uid) {
  if (el.dataset.profileLinked) return;
  el.dataset.profileLinked = "1";
  el.classList.add("profile-link");
  el.style.cursor = "pointer";
  el.title = "View profile";
  el.addEventListener("click", e => {
    e.stopPropagation();
    window.open(`profile.html?user=${uid}`, "_blank");
  });
}

/* ═══════════════════════════════════════════════════════════════
   PROCESS A SINGLE POST CARD
   post-card__author holds the display name; we need the authorId
   which is stored on the card's dataset or we look it up by name.
════════════════════════════════════════════════════════════════ */
async function _processPostCard(card) {
  if (card.dataset.followProcessed) return;
  card.dataset.followProcessed = "1";

  const authorEl = card.querySelector(".post-card__author");
  if (!authorEl) return;

  /* posts.js stores data-post-id on the article; we can read
     authorId from Firestore using the post id.               */
  const postId = card.dataset.postId;
  let uid = null;

  if (postId) {
    try {
      const snap = await getDoc(doc(db, "posts", postId));
      if (snap.exists()) uid = snap.data().authorId;
    } catch { /* fallback to name lookup */ }
  }

  /* Fallback: look up by display name */
  if (!uid) uid = await _getUidByName(authorEl.textContent.trim());
  if (!uid) return;

  /* Don't link to own profile (still works, just no need for tooltip) */
  _makeProfileLink(authorEl, uid);
}

/* ═══════════════════════════════════════════════════════════════
   PROCESS A SINGLE CHAT BUBBLE
   chat-bubble__author holds "Name <role>"
════════════════════════════════════════════════════════════════ */
async function _processChatBubble(wrap) {
  if (wrap.dataset.followProcessed) return;
  wrap.dataset.followProcessed = "1";

  /* Only "theirs" bubbles have an author label */
  if (!wrap.classList.contains("theirs")) return;

  const authorEl = wrap.querySelector(".chat-bubble__author");
  if (!authorEl) return;

  /* Extract name (text before the <em> tag) */
  const rawText = authorEl.childNodes[0]?.textContent?.trim();
  if (!rawText) return;

  const uid = await _getUidByName(rawText);
  if (!uid) return;

  /* Wrap just the text node in a span we can make clickable */
  const nameSpan = document.createElement("span");
  nameSpan.textContent = rawText;
  authorEl.childNodes[0].replaceWith(nameSpan);
  _makeProfileLink(nameSpan, uid);
}

/* ═══════════════════════════════════════════════════════════════
   PROCESS USERS LIST ITEM (private chat sidebar)
   Adds a small profile icon button next to each user
════════════════════════════════════════════════════════════════ */
function _processUserListItem(item) {
  if (item.dataset.followProcessed) return;
  item.dataset.followProcessed = "1";

  /* The click handler on these items opens DM — we add
     a secondary profile button without breaking that.   */
  const btn = document.createElement("button");
  btn.className = "profile-icon-btn";
  btn.title = "View Profile";
  btn.textContent = "👤";
  btn.addEventListener("click", async e => {
    e.stopPropagation(); // don't trigger DM open
    const nameEl = item.querySelector(".user-list-name");
    if (!nameEl) return;
    const uid = await _getUidByName(nameEl.textContent.trim());
    if (uid) window.open(`profile.html?user=${uid}`, "_blank");
    else     alert("Profile not found.");
  });
  item.appendChild(btn);
}

/* ═══════════════════════════════════════════════════════════════
   MUTATION OBSERVER — watches for new DOM nodes
════════════════════════════════════════════════════════════════ */
function _startObservers() {
  const observer = new MutationObserver(mutations => {
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (!(node instanceof Element)) continue;

        /* Post cards */
        if (node.matches?.("article.post-card")) {
          _processPostCard(node);
        }
        node.querySelectorAll?.("article.post-card").forEach(_processPostCard);

        /* Chat bubbles */
        if (node.matches?.(".chat-bubble-wrap")) {
          _processChatBubble(node);
        }
        node.querySelectorAll?.(".chat-bubble-wrap").forEach(_processChatBubble);

        /* User list items */
        if (node.matches?.(".user-list-item")) {
          _processUserListItem(node);
        }
        node.querySelectorAll?.(".user-list-item").forEach(_processUserListItem);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

/* ═══════════════════════════════════════════════════════════════
   PROCESS ALREADY-RENDERED NODES  (in case feed loaded before us)
════════════════════════════════════════════════════════════════ */
function _processExisting() {
  document.querySelectorAll("article.post-card").forEach(_processPostCard);
  document.querySelectorAll(".chat-bubble-wrap").forEach(_processChatBubble);
  document.querySelectorAll(".user-list-item").forEach(_processUserListItem);
}

/* ═══════════════════════════════════════════════════════════════
   AUTO-OPEN DM — triggered when arriving from profile.html
   profile.html sets:  localStorage.openDMWith = {uid, name, role}
   We pick it up here, switch to Private tab, and open the chat.
════════════════════════════════════════════════════════════════ */
function _handleDMRedirect() {
  const raw = localStorage.getItem("openDMWith");
  if (!raw) return;

  try {
    const peer = JSON.parse(raw);
    localStorage.removeItem("openDMWith");

    /* Wait for auth + chat UI to be ready */
    const attempt = (tries = 0) => {
      const chatUI      = document.getElementById("chatUI");
      const privateTab  = document.querySelector('.chat-tab[data-tab="private"]');
      const usersList   = document.getElementById("usersList");

      if (!chatUI || chatUI.hidden || !privateTab || tries > 20) return;

      /* Click the Private tab */
      privateTab.click();

      /* Find and click the matching user in the sidebar */
      const findAndClick = (t = 0) => {
        const items = document.querySelectorAll(".user-list-item");
        for (const item of items) {
          const nameEl = item.querySelector(".user-list-name");
          if (nameEl && nameEl.textContent.trim() === peer.name) {
            item.click();
            return;
          }
        }
        /* Sidebar may still be loading */
        if (t < 15) setTimeout(() => findAndClick(t + 1), 400);
      };

      setTimeout(findAndClick, 600);
    };

    /* Poll until chat UI is visible */
    const poll = setInterval(() => {
      const chatUI = document.getElementById("chatUI");
      if (chatUI && !chatUI.hidden) {
        clearInterval(poll);

        /* Scroll to chat section */
        document.getElementById("chat")?.scrollIntoView({ behavior: "smooth" });
        setTimeout(() => attempt(), 300);
      }
    }, 300);

    /* Bail after 10 s */
    setTimeout(() => clearInterval(poll), 10000);

  } catch { localStorage.removeItem("openDMWith"); }
}

/* ═══════════════════════════════════════════════════════════════
   BOOT — wait for auth, then start everything
════════════════════════════════════════════════════════════════ */
onAuthChange((user, profile) => {
  if (!user || !profile?.profileComplete) return;

  /* Start DOM observers */
  _startObservers();

  /* Process any nodes already in the DOM */
  _processExisting();

  /* Handle DM redirect from profile page */
  _handleDMRedirect();
});
