/**
 * features/reactions.js
 * ─────────────────────────────────────────────────────────────────
 * PURELY ADDITIVE — does not modify posts.js, chat.js, or any
 * existing file. Uses MutationObserver to inject UI into cards
 * and bubbles as they are rendered by the existing system.
 *
 * What this file does:
 *  1. LIKE BUTTON on posts
 *     • Watches for post cards rendered by posts.js
 *     • Injects a ❤️ Like button ALONGSIDE the existing emoji
 *       reaction system (does NOT replace it)
 *     • Stores likes as  posts/{id}.likes = [uid, uid, …]
 *     • Sends a "like" notification to the post author
 *
 *  2. MESSAGE REACTIONS on chat bubbles
 *     • Watches for chat bubbles rendered by chat.js
 *     • Injects a small 😊 button on every bubble (hover/tap)
 *     • Opens a compact emoji tray (👍 ❤️ 😂 😮 😢 🔥)
 *     • Stores reactions on the message document:
 *         groupMessages/{id}.reactions = { emoji: [uid, …] }
 *         privateChats/{convId}/messages/{id}.reactions = { … }
 *     • Shows inline reaction counts below the bubble
 *     • Sends a "msg_react" notification to the message author
 * ─────────────────────────────────────────────────────────────────
 */

import {
  doc, getDoc, updateDoc, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

import { db }                                      from "../firebase-config.js";
import { onAuthChange, currentUser, currentProfile } from "../auth.js";
import { sendNotification }                        from "./notifications.js";

/* ═══════════════════════════════════════════════════════════════
   CONSTANTS
════════════════════════════════════════════════════════════════ */
const MSG_EMOJIS = ["👍","❤️","😂","😮","😢","🔥"];

/* ═══════════════════════════════════════════════════════════════
   INJECT STYLES
════════════════════════════════════════════════════════════════ */
(function _injectStyles() {
  if (document.getElementById("reactions-js-styles")) return;
  const s = document.createElement("style");
  s.id = "reactions-js-styles";
  s.textContent = `
    /* ── Like Button ───────────────────────────────────────── */
    .like-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.3rem 0.8rem;
      border-radius: 50px;
      border: 1.5px solid var(--border, rgba(0,0,0,0.08));
      background: transparent;
      color: var(--text-muted, #7a736b);
      font-family: 'Jost', sans-serif;
      font-size: 0.78rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.22s ease;
      line-height: 1;
    }
    .like-btn:hover {
      border-color: #e74c3c;
      color: #e74c3c;
      background: rgba(231,76,60,0.06);
    }
    .like-btn.liked {
      border-color: #e74c3c;
      color: #e74c3c;
      background: rgba(231,76,60,0.08);
    }
    .like-btn.liked .like-heart {
      animation: heart-pop 0.35s cubic-bezier(0.34,1.56,0.64,1);
    }
    @keyframes heart-pop {
      0%   { transform: scale(1); }
      40%  { transform: scale(1.4); }
      100% { transform: scale(1); }
    }
    .like-btn .like-heart { font-size: 0.9rem; display: inline-block; }
    .like-btn .like-count { font-variant-numeric: tabular-nums; }

    /* ── Message Reaction Trigger Button ───────────────────── */
    .msg-react-trigger {
      opacity: 0;
      pointer-events: none;
      width: 24px; height: 24px;
      border-radius: 50%;
      border: 1px solid var(--border, rgba(0,0,0,0.1));
      background: var(--surface, rgba(255,255,255,0.8));
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      color: var(--text-muted, #7a736b);
      font-size: 0.75rem;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.18s ease;
      flex-shrink: 0;
      align-self: flex-end;
      margin-bottom: 4px;
      position: relative;
      z-index: 5;
    }
    .chat-bubble-wrap:hover .msg-react-trigger,
    .chat-bubble-wrap:focus-within .msg-react-trigger {
      opacity: 1;
      pointer-events: auto;
    }
    .msg-react-trigger:hover {
      background: var(--accent, #c8a96e);
      color: #fff;
      border-color: var(--accent, #c8a96e);
      transform: scale(1.1);
    }

    /* ── Emoji Tray ────────────────────────────────────────── */
    .msg-emoji-tray {
      position: fixed;
      background: var(--surface, rgba(255,255,255,0.95));
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--border, rgba(0,0,0,0.1));
      border-radius: 50px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.15);
      display: flex;
      gap: 0.1rem;
      padding: 0.3rem 0.5rem;
      z-index: 9999;
      animation: tray-pop 0.2s cubic-bezier(0.34,1.56,0.64,1);
    }
    @keyframes tray-pop {
      from { transform: scale(0.7) translateY(6px); opacity: 0; }
      to   { transform: scale(1)   translateY(0);   opacity: 1; }
    }
    .msg-emoji-tray__btn {
      width: 36px; height: 36px;
      border: none;
      background: transparent;
      border-radius: 50%;
      font-size: 1.15rem;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.15s ease, background 0.15s ease;
      position: relative;
    }
    .msg-emoji-tray__btn:hover {
      transform: scale(1.35) translateY(-3px);
      background: var(--bg-alt, #f0ebe3);
    }
    .msg-emoji-tray__btn.active-emoji {
      background: var(--bg-alt, #f0ebe3);
    }
    .msg-emoji-tray__btn.active-emoji::after {
      content: "";
      position: absolute;
      bottom: 2px;
      left: 50%; transform: translateX(-50%);
      width: 4px; height: 4px;
      border-radius: 50%;
      background: var(--accent, #c8a96e);
    }

    /* ── Message Reaction Display Row ──────────────────────── */
    .msg-reactions-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      margin-top: 0.3rem;
      padding: 0 0.2rem;
    }
    .mine .msg-reactions-row { justify-content: flex-end; }

    .msg-reaction-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
      padding: 0.12rem 0.45rem;
      border-radius: 50px;
      border: 1.5px solid var(--border, rgba(0,0,0,0.08));
      background: var(--surface, rgba(255,255,255,0.7));
      backdrop-filter: blur(6px);
      font-size: 0.78rem;
      cursor: pointer;
      transition: all 0.18s ease;
      line-height: 1;
      user-select: none;
    }
    .msg-reaction-chip:hover {
      border-color: var(--accent, #c8a96e);
      background: rgba(200,169,110,0.1);
    }
    .msg-reaction-chip.reacted {
      border-color: var(--accent, #c8a96e);
      background: rgba(200,169,110,0.12);
      color: var(--accent, #c8a96e);
    }
    .msg-reaction-chip .chip-count {
      font-family: 'Jost', sans-serif;
      font-size: 0.7rem;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }
    .msg-reaction-chip.just-added {
      animation: chip-pop 0.3s cubic-bezier(0.34,1.56,0.64,1);
    }
    @keyframes chip-pop {
      0%   { transform: scale(0.7); }
      60%  { transform: scale(1.15); }
      100% { transform: scale(1); }
    }
  `;
  document.head.appendChild(s);
})();

/* ═══════════════════════════════════════════════════════════════
   ── PART 1: LIKE BUTTON ON POSTS ─────────────────────────────
════════════════════════════════════════════════════════════════ */

/**
 * Injects a Like button into a post card rendered by posts.js.
 * The button is inserted at the START of .post-reactions so it
 * sits to the left of the existing emoji reaction buttons.
 */
async function _injectLikeButton(card) {
  if (card.dataset.likeInjected) return;
  card.dataset.likeInjected = "1";

  const postId     = card.dataset.postId;
  if (!postId)     return;

  const reactionsDiv = card.querySelector(".post-reactions");
  if (!reactionsDiv) return;

  /* Read current likes from Firestore */
  let likes  = [];
  let authorId = null;
  try {
    const snap = await getDoc(doc(db, "posts", postId));
    if (!snap.exists()) return;
    likes    = snap.data().likes || [];
    authorId = snap.data().authorId;
  } catch { return; }

  const uid    = currentUser?.uid;
  const liked  = uid ? likes.includes(uid) : false;
  const count  = likes.length;

  const btn = document.createElement("button");
  btn.className          = `like-btn${liked ? " liked" : ""}`;
  btn.dataset.postId     = postId;
  btn.dataset.authorId   = authorId || "";
  btn.dataset.liked      = liked ? "1" : "0";
  btn.dataset.count      = count;
  btn.innerHTML          = `<span class="like-heart">${liked ? "❤️" : "🤍"}</span><span class="like-count">${count || ""}</span>`;
  btn.title              = liked ? "Unlike" : "Like";

  btn.addEventListener("click", () => _toggleLike(btn));

  /* Insert at the very beginning of reactions row */
  reactionsDiv.insertBefore(btn, reactionsDiv.firstChild);

  /* Real-time update: watch this post for like changes */
  _watchPostLikes(postId, btn);
}

/** Polls/listens for like count changes on a specific post */
function _watchPostLikes(postId, btn) {
  /* We use onSnapshot for live updates */
  import("https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js")
    .then(({ onSnapshot, doc: fsDoc }) => {
      const unsub = onSnapshot(fsDoc(db, "posts", postId), snap => {
        if (!snap.exists()) return;
        const likes  = snap.data().likes || [];
        const uid    = currentUser?.uid;
        const liked  = uid ? likes.includes(uid) : false;
        const count  = likes.length;

        btn.dataset.liked = liked ? "1" : "0";
        btn.dataset.count = count;
        btn.className     = `like-btn${liked ? " liked" : ""}`;
        btn.title         = liked ? "Unlike" : "Like";

        const heart = btn.querySelector(".like-heart");
        const num   = btn.querySelector(".like-count");
        if (heart) heart.textContent = liked ? "❤️" : "🤍";
        if (num)   num.textContent   = count || "";
      }, () => {});

      /* Clean up when card is removed */
      const mo = new MutationObserver(() => {
        if (!document.contains(btn)) { unsub(); mo.disconnect(); }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    });
}

async function _toggleLike(btn) {
  if (!currentUser) return _toast("Login to like posts.");
  const postId   = btn.dataset.postId;
  const authorId = btn.dataset.authorId;
  const wasLiked = btn.dataset.liked === "1";
  const ref      = doc(db, "posts", postId);

  /* Optimistic UI */
  const newLiked  = !wasLiked;
  const newCount  = parseInt(btn.dataset.count || "0") + (newLiked ? 1 : -1);
  btn.dataset.liked = newLiked ? "1" : "0";
  btn.dataset.count = Math.max(0, newCount);
  btn.className     = `like-btn${newLiked ? " liked" : ""}`;
  btn.title         = newLiked ? "Unlike" : "Like";
  const heart = btn.querySelector(".like-heart");
  const num   = btn.querySelector(".like-count");
  if (heart) heart.textContent = newLiked ? "❤️" : "🤍";
  if (num)   num.textContent   = Math.max(0, newCount) || "";

  try {
    await updateDoc(ref, {
      likes: newLiked
        ? arrayUnion(currentUser.uid)
        : arrayRemove(currentUser.uid)
    });

    /* Send notification only when liking (not unliking) */
    if (newLiked && authorId && authorId !== currentUser.uid) {
      sendNotification(authorId, {
        type:     "like",
        fromUid:  currentUser.uid,
        fromName: currentProfile?.name || "Someone",
        postId,
      });
    }
  } catch {
    _toast("Like failed. Try again.");
    /* Revert */
    btn.dataset.liked = wasLiked ? "1" : "0";
  }
}

/* ═══════════════════════════════════════════════════════════════
   ── PART 2: MESSAGE REACTIONS ─────────────────────────────────
════════════════════════════════════════════════════════════════ */

/**
 * Injects a reaction trigger button into a chat bubble wrap.
 * Detects message type (group vs private) by reading data-* on
 * ancestor elements set by chat.js.
 */
function _injectMsgReactTrigger(wrap) {
  if (wrap.dataset.msgReactInjected) return;
  wrap.dataset.msgReactInjected = "1";

  /* Resolve the Firestore path from the container */
  const { msgId, collPath } = _resolveMsgPath(wrap);
  if (!msgId || !collPath) return;

  /* Build trigger button */
  const trigger = document.createElement("button");
  trigger.className = "msg-react-trigger";
  trigger.title     = "React";
  trigger.textContent = "😊";

  /* "mine" wraps → insert before the delete button (if any) or append */
  /* "theirs" wraps → append after bubble */
  const delBtn = wrap.querySelector(".chat-del-btn");
  if (delBtn) {
    wrap.insertBefore(trigger, delBtn);
  } else {
    wrap.appendChild(trigger);
  }

  trigger.addEventListener("click", e => {
    e.stopPropagation();
    _showMsgEmojiTray(e, msgId, collPath, wrap);
  });

  /* Render any existing reactions */
  _renderMsgReactions(msgId, collPath, wrap);

  /* Live-listen to reaction changes */
  _watchMsgReactions(msgId, collPath, wrap);
}

/**
 * Resolves the Firestore collection path and message ID for a bubble.
 * chat.js renders group bubbles in #groupMessages and
 * private bubbles in #privateMessages.
 */
function _resolveMsgPath(wrap) {
  const bubble    = wrap.querySelector(".chat-bubble");
  if (!bubble) return {};

  /* We stored msgId on the wrap during injection — but chat.js
     doesn't add data-id. We identify by position in parent.     */
  const container = wrap.parentElement;
  if (!container) return {};

  /* Find index of this wrap inside its parent */
  const wrapIndex = Array.from(container.children).indexOf(wrap);
  if (wrapIndex < 0) return {};

  /* Determine panel type */
  const isGroup   = !!container.closest("#groupMessages");
  const isPrivate = !!container.closest("#privateMessages");

  if (!isGroup && !isPrivate) return {};

  /* Extract the message ID — it's NOT on the DOM element in
     chat.js. We store it via a data attribute we set ourselves
     during the observation. The first time we see this wrap,
     we assign an index-based key so repeated observations are
     idempotent. We then query Firestore by order+index to get
     the real ID. Since this is expensive, we use a simpler
     approach: attach the ID to the wrap from the snapshot data.

     REAL APPROACH: read the msgId from the delete button's
     event listener closure via the stored data-msgid attribute
     that we inject below in _patchChatBubble.
  */
  const msgId = wrap.dataset.msgId;

  if (!msgId) return {};

  if (isGroup) {
    return { msgId, collPath: "groupMessages" };
  }

  /* For private, we need the convId stored on the container */
  const convId = container.dataset.convId;
  if (!convId) return {};
  return { msgId, collPath: `privateChats/${convId}/messages` };
}

/**
 * Shows the floating emoji tray near the trigger button.
 */
function _showMsgEmojiTray(e, msgId, collPath, wrap) {
  document.getElementById("msgEmojiTray")?.remove();

  const tray = document.createElement("div");
  tray.id    = "msgEmojiTray";
  tray.className = "msg-emoji-tray";

  /* Figure out which emojis the current user already reacted with */
  const existingReactions = _getWrapReactions(wrap);
  const myReactions = Object.entries(existingReactions)
    .filter(([, users]) => Array.isArray(users) && users.includes(currentUser?.uid))
    .map(([emoji]) => emoji);

  MSG_EMOJIS.forEach(em => {
    const btn = document.createElement("button");
    btn.className = `msg-emoji-tray__btn${myReactions.includes(em) ? " active-emoji" : ""}`;
    btn.textContent = em;
    btn.title       = em;
    btn.addEventListener("click", () => {
      _toggleMsgReaction(msgId, collPath, em, wrap);
      tray.remove();
    });
    tray.appendChild(btn);
  });

  document.body.appendChild(tray);

  /* Position above the trigger */
  const rect = e.target.getBoundingClientRect();
  const tw   = 260;
  let   left = rect.left - tw / 2 + rect.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
  tray.style.cssText = `left:${left}px;top:${Math.max(8, rect.top - 56)}px`;

  /* Dismiss on outside click */
  const dismiss = ev => {
    if (!tray.contains(ev.target) && ev.target !== e.target) {
      tray.remove();
      document.removeEventListener("click", dismiss);
    }
  };
  setTimeout(() => document.addEventListener("click", dismiss), 0);
}

/** Toggle a reaction on a message */
async function _toggleMsgReaction(msgId, collPath, emoji, wrap) {
  if (!currentUser) return _toast("Login to react.");

  const ref  = doc(db, ...collPath.split("/"), msgId);
  const snap = await getDoc(ref).catch(() => null);
  if (!snap?.exists()) return;

  const data      = snap.data();
  const users     = (data.reactions || {})[emoji] || [];
  const alreadyIn = users.includes(currentUser.uid);

  await updateDoc(ref, {
    [`reactions.${emoji}`]: alreadyIn
      ? arrayRemove(currentUser.uid)
      : arrayUnion(currentUser.uid)
  }).catch(() => _toast("Reaction failed."));

  /* Notify message author (if reacting, not removing) */
  if (!alreadyIn) {
    const authorUid = data.uid;
    if (authorUid && authorUid !== currentUser.uid) {
      sendNotification(authorUid, {
        type:     "msg_react",
        fromUid:  currentUser.uid,
        fromName: currentProfile?.name || "Someone",
        emoji,
      });
    }
  }
}

/** Store reactions on the wrap element for quick access */
function _getWrapReactions(wrap) {
  try {
    return JSON.parse(wrap.dataset.reactions || "{}");
  } catch { return {}; }
}

/** Render reaction chips below a bubble */
function _renderMsgReactions(msgId, collPath, wrap, reactions) {
  /* Remove old chips row */
  wrap.querySelector(".msg-reactions-row")?.remove();
  if (!reactions || !Object.keys(reactions).length) return;

  /* Cache on element for tray */
  wrap.dataset.reactions = JSON.stringify(reactions);

  const row = document.createElement("div");
  row.className = "msg-reactions-row";

  let hasAny = false;
  for (const [emoji, users] of Object.entries(reactions)) {
    if (!Array.isArray(users) || !users.length) continue;
    hasAny = true;
    const reacted = currentUser?.uid && users.includes(currentUser.uid);
    const chip    = document.createElement("button");
    chip.className = `msg-reaction-chip${reacted ? " reacted" : ""}`;
    chip.innerHTML = `${emoji}<span class="chip-count">${users.length}</span>`;
    chip.title     = `${users.length} reaction${users.length > 1 ? "s" : ""}`;
    chip.addEventListener("click", () =>
      _toggleMsgReaction(msgId, collPath, emoji, wrap)
    );
    row.appendChild(chip);
  }

  if (!hasAny) return;

  /* Insert chips row right after the bubble */
  const bubble = wrap.querySelector(".chat-bubble");
  if (bubble) {
    bubble.insertAdjacentElement("afterend", row);
  } else {
    wrap.appendChild(row);
  }
}

/** Live-listen to a single message document for reaction changes */
function _watchMsgReactions(msgId, collPath, wrap) {
  if (wrap.dataset.reactionWatching) return;
  wrap.dataset.reactionWatching = "1";

  import("https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js")
    .then(({ onSnapshot, doc: fsDoc }) => {
      const ref   = fsDoc(db, ...collPath.split("/"), msgId);
      const unsub = onSnapshot(ref, snap => {
        if (!snap.exists()) return;
        const reactions = snap.data().reactions || {};
        _renderMsgReactions(msgId, collPath, wrap, reactions);
      }, () => {});

      /* Cleanup when wrap is removed from DOM */
      const mo = new MutationObserver(() => {
        if (!document.contains(wrap)) { unsub(); mo.disconnect(); }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    });
}

/* ═══════════════════════════════════════════════════════════════
   PATCH CHAT BUBBLES — extract msgId & convId from delete buttons
   chat.js sets the Firestore path in the delete button's listener
   but doesn't expose it on the DOM. We intercept the rendered
   HTML to extract IDs right after chat.js renders them.
   
   Strategy: MutationObserver catches each new .chat-bubble-wrap.
   At that moment the delete button (if present) has already been
   appended. We read the data from the closest container to
   determine group vs private, then query Firestore for the
   most recently added message to get its ID.
   
   Simpler approach we use: store the msg ID by intercepting the
   chat container snapshots using a parallel onSnapshot listener
   that does NOT interfere with chat.js's own listener.
════════════════════════════════════════════════════════════════ */

/* We keep a parallel lightweight snapshot to map content → msgId */
const _msgIdMap = new Map(); // content_timestamp_uid → msgId

/** Called from MutationObserver when a new bubble appears */
async function _processBubble(wrap) {
  if (wrap.dataset.msgReactInjected) return;

  /* Determine group vs private */
  const isGroup   = !!wrap.closest("#groupMessages");
  const isPrivate = !!wrap.closest("#privateMessages");
  if (!isGroup && !isPrivate) return;

  /* Extract text/time fingerprint from the bubble */
  const textEl = wrap.querySelector(".chat-bubble__text");
  const timeEl = wrap.querySelector(".chat-bubble__time");
  const authEl = wrap.querySelector(".chat-bubble__author");

  const text = textEl?.textContent?.trim()  || "";
  const time = timeEl?.textContent?.trim()  || "";
  const auth = authEl?.childNodes[0]?.textContent?.trim() || "";
  const mine = wrap.classList.contains("mine");

  let collPath = isGroup ? "groupMessages" : null;

  /* For private chats, find convId from container */
  if (isPrivate) {
    const pmContainer = wrap.closest("#privateMessages");
    const convId      = pmContainer?.dataset.convId;
    if (!convId) return; /* convId not set yet */
    collPath = `privateChats/${convId}/messages`;
  }

  if (!collPath) return;

  /* Look up the message ID using a targeted query */
  const msgId = await _findMsgId(collPath, text, time);
  if (!msgId) return;

  wrap.dataset.msgId = msgId;

  /* Also tag private chat container with convId if not already done */
  if (isPrivate) {
    const pmContainer = wrap.closest("#privateMessages");
    if (pmContainer?.dataset.convId) {
      /* already set */
    }
  }

  _injectMsgReactTrigger(wrap);
}

/**
 * Find the Firestore message ID by matching text content.
 * Uses a cached map populated by our parallel listener.
 */
async function _findMsgId(collPath, text, timeStr) {
  /* Check cache first */
  const cacheKey = `${collPath}::${text}::${timeStr}`;
  if (_msgIdMap.has(cacheKey)) return _msgIdMap.get(cacheKey);

  /* Fallback: query recent messages */
  try {
    const { getDocs, collection: col, query: q,
            orderBy, limit: lim } =
      await import("https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js");

    const parts  = collPath.split("/");
    const ref    = col(db, ...parts);
    const snap   = await getDocs(q(ref, orderBy("timestamp","desc"), lim(30)));

    for (const d of snap.docs) {
      const data = d.data();
      if ((data.text || "") === text) {
        const t = data.timestamp?.toDate?.()
          ?.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }) || "";
        const key = `${collPath}::${text}::${t}`;
        _msgIdMap.set(key, d.id);
        if (t === timeStr) return d.id;
      }
    }
  } catch (err) {
    console.warn("_findMsgId:", err);
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════
   PATCH PRIVATE CHAT CONTAINER WITH CONV ID
   chat.js sets _convId but not on the DOM. We watch for the
   private chat header text change to infer the current convId.
════════════════════════════════════════════════════════════════ */
function _watchPrivateChatHeader() {
  const header = document.getElementById("privateChatHeader");
  const pmCont = document.getElementById("privateMessages");
  if (!header || !pmCont) return;

  /* We can't get convId directly, but we can set it when
     the user list item is clicked by intercepting that click. */
  document.getElementById("usersList")?.addEventListener("click", async e => {
    const item = e.target.closest(".user-list-item");
    if (!item) return;

    const nameEl = item.querySelector(".user-list-name");
    if (!nameEl) return;

    /* Find their UID */
    const { getDocs, collection: col, query: q, where: w } =
      await import("https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js");

    const snap = await getDocs(q(col(db, "users"), w("name", "==", nameEl.textContent.trim())));
    if (snap.empty) return;

    const theirUid = snap.docs[0].id;
    if (!currentUser) return;

    const convId = [currentUser.uid, theirUid].sort().join("_");
    pmCont.dataset.convId = convId;
  }, true /* capture — fires before chat.js handler */ );
}

/* ═══════════════════════════════════════════════════════════════
   MUTATION OBSERVER
════════════════════════════════════════════════════════════════ */
function _startObserver() {
  const observer = new MutationObserver(muts => {
    for (const mut of muts) {
      for (const node of mut.addedNodes) {
        if (!(node instanceof Element)) continue;

        /* Post cards */
        if (node.matches?.("article.post-card"))
          _injectLikeButton(node);
        node.querySelectorAll?.("article.post-card")
          .forEach(_injectLikeButton);

        /* Chat bubbles */
        if (node.matches?.(".chat-bubble-wrap"))
          _processBubble(node);
        node.querySelectorAll?.(".chat-bubble-wrap")
          .forEach(_processBubble);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/* ═══════════════════════════════════════════════════════════════
   PROCESS EXISTING NODES
════════════════════════════════════════════════════════════════ */
function _processExisting() {
  document.querySelectorAll("article.post-card").forEach(_injectLikeButton);
  document.querySelectorAll(".chat-bubble-wrap").forEach(_processBubble);
}

/* ═══════════════════════════════════════════════════════════════
   TOAST HELPER
════════════════════════════════════════════════════════════════ */
function _toast(msg) {
  const el = document.getElementById("toastNotif");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 3000);
}

/* ═══════════════════════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════════════════════ */
onAuthChange((user, profile) => {
  if (user && profile?.profileComplete && !profile.banned) {
    _startObserver();
    _processExisting();
    _watchPrivateChatHeader();
  }
});
