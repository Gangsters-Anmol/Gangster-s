/**
 * features/feed.js
 * ─────────────────────────────────────────────────────────────────
 * PURELY ADDITIVE — does not modify posts.js, index.html, or any
 * existing file.
 *
 * What this file does:
 *  1. Injects a "Following Feed" tab toggle into the existing
 *     Posts section — sitting above the current feed.
 *  2. "All Posts" tab  → shows the existing postsFeed (untouched)
 *  3. "Following" tab  → hides postsFeed and shows a new
 *     #followingFeed div populated with posts ONLY from users
 *     the current user follows, ordered newest first.
 *  4. The following feed updates in real-time via onSnapshot.
 *  5. If the user follows nobody yet, a friendly empty state
 *     with a "Discover People" button is shown.
 *  6. Post cards in the following feed are built with the same
 *     visual style as the existing posts so reactions.js and
 *     follow.js can decorate them automatically.
 * ─────────────────────────────────────────────────────────────────
 */

import {
  collection, query, where, orderBy, limit,
  onSnapshot, getDoc, getDocs, doc
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

import { db }                                        from "../firebase-config.js";
import { onAuthChange, currentUser, currentProfile } from "../auth.js";

/* ═══════════════════════════════════════════════════════════════
   CONSTANTS
════════════════════════════════════════════════════════════════ */
const FEED_LIMIT = 30; // max posts to load in following feed

/* ═══════════════════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════════════════════ */
let _followingUids = [];   // UIDs the current user follows
let _feedUnsubs    = [];   // onSnapshot unsubscribers
let _activeTab     = "all"; // "all" | "following"
let _injected      = false;

/* ═══════════════════════════════════════════════════════════════
   INJECT STYLES
════════════════════════════════════════════════════════════════ */
(function _injectStyles() {
  if (document.getElementById("feed-js-styles")) return;
  const s = document.createElement("style");
  s.id = "feed-js-styles";
  s.textContent = `
    /* ── Feed Tab Bar ──────────────────────────────────────── */
    .feed-tab-bar {
      display: flex;
      gap: 0;
      margin-bottom: 1.5rem;
      border-bottom: 1px solid var(--border, rgba(0,0,0,0.08));
      position: relative;
    }
    .feed-tab {
      padding: 0.65rem 1.4rem;
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--text-muted, #7a736b);
      font-family: 'Jost', sans-serif;
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.22s ease;
      letter-spacing: 0.04em;
      margin-bottom: -1px;
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .feed-tab.active {
      color: var(--accent, #c8a96e);
      border-bottom-color: var(--accent, #c8a96e);
    }
    .feed-tab:hover:not(.active) { color: var(--text, #1a1613); }

    .feed-tab .feed-tab__badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 4px;
      border-radius: 50px;
      background: var(--accent, #c8a96e);
      color: #fff;
      font-size: 0.62rem;
      font-weight: 700;
      line-height: 1;
    }
    .feed-tab .feed-tab__badge[hidden] { display: none !important; }

    /* ── Following Feed Container ──────────────────────────── */
    #followingFeed {
      display: flex;
      flex-direction: column;
      gap: 0; /* post cards have their own margin */
    }

    /* ── Empty State ───────────────────────────────────────── */
    .feed-empty {
      text-align: center;
      padding: 4rem 2rem;
      color: var(--text-muted, #7a736b);
    }
    .feed-empty__icon {
      font-size: 3rem;
      display: block;
      margin-bottom: 1rem;
      opacity: 0.7;
    }
    .feed-empty__title {
      font-family: 'Cormorant Garamond', serif;
      font-size: 1.5rem;
      color: var(--text, #1a1613);
      margin-bottom: 0.4rem;
    }
    .feed-empty__desc {
      font-size: 0.85rem;
      max-width: 280px;
      margin: 0 auto 1.5rem;
      line-height: 1.6;
    }
    .feed-empty__btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.6rem 1.5rem;
      border-radius: 50px;
      background: var(--accent, #c8a96e);
      color: #fff;
      border: none;
      font-family: 'Jost', sans-serif;
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.22s ease;
    }
    .feed-empty__btn:hover {
      background: var(--accent-2, #8b5e3c);
      transform: translateY(-1px);
    }

    /* ── Loading State ─────────────────────────────────────── */
    .feed-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      padding: 3rem 1rem;
      color: var(--text-muted, #7a736b);
      font-size: 0.88rem;
    }
    .feed-spinner {
      width: 22px; height: 22px;
      border: 2.5px solid var(--border, rgba(0,0,0,0.1));
      border-top-color: var(--accent, #c8a96e);
      border-radius: 50%;
      animation: fspin 0.75s linear infinite;
    }
    @keyframes fspin { to { transform: rotate(360deg); } }

    /* ── New Posts Pill ────────────────────────────────────── */
    .feed-new-pill {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .feed-new-pill button {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.45rem 1.2rem;
      border-radius: 50px;
      background: var(--text, #1a1613);
      color: var(--bg, #f9f6f1);
      border: none;
      font-family: 'Jost', sans-serif;
      font-size: 0.78rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.22s ease;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
      animation: pill-drop 0.35s cubic-bezier(0.34,1.56,0.64,1);
    }
    @keyframes pill-drop {
      from { transform: translateY(-12px) scale(0.9); opacity: 0; }
      to   { transform: translateY(0) scale(1); opacity: 1; }
    }
    .feed-new-pill button:hover {
      background: var(--accent, #c8a96e);
      transform: translateY(-1px);
    }

    /* ── Following Feed Post Card (mirrors posts.js styles) ── */
    /* The existing .post-card styles from style.css apply.
       We only add the enter animation here. */
    .ff-card--enter {
      opacity: 0;
      transform: translateY(12px);
    }
    .ff-card--visible {
      opacity: 1;
      transform: translateY(0);
      transition: opacity 0.3s ease, transform 0.3s ease;
    }

    /* ── "Who to Follow" sidebar hint ─────────────────────── */
    .feed-follow-hint {
      background: var(--surface, rgba(255,255,255,0.72));
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--border, rgba(0,0,0,0.08));
      border-radius: 12px;
      padding: 1rem 1.25rem;
      margin-bottom: 1.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .feed-follow-hint__text {
      font-size: 0.82rem;
      color: var(--text-muted, #7a736b);
      line-height: 1.5;
    }
    .feed-follow-hint__text strong {
      display: block;
      color: var(--text, #1a1613);
      font-size: 0.88rem;
      margin-bottom: 0.15rem;
    }
    .feed-follow-hint__avatars {
      display: flex;
      gap: -6px;
    }
    .fha {
      width: 32px; height: 32px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--accent, #c8a96e), #8b5e3c);
      display: flex; align-items: center; justify-content: center;
      font-family: 'Cormorant Garamond', serif;
      font-weight: 600;
      color: #fff;
      font-size: 0.85rem;
      border: 2px solid var(--bg, #f9f6f1);
      margin-left: -8px;
      cursor: pointer;
      transition: transform 0.18s ease;
      flex-shrink: 0;
    }
    .fha:first-child { margin-left: 0; }
    .fha:hover { transform: translateY(-3px); }
  `;
  document.head.appendChild(s);
})();

/* ═══════════════════════════════════════════════════════════════
   INJECT FEED TAB BAR INTO POSTS SECTION
════════════════════════════════════════════════════════════════ */
function _injectTabBar() {
  if (_injected) return;
  _injected = true;

  /* Wait for postsUI to be visible (auth gate) */
  const postsUI   = document.getElementById("postsUI");
  const postsFeed = document.getElementById("postsFeed");
  if (!postsUI || !postsFeed) return;

  /* Create tab bar */
  const tabBar = document.createElement("div");
  tabBar.className = "feed-tab-bar";
  tabBar.id        = "feedTabBar";
  tabBar.innerHTML = `
    <button class="feed-tab active" data-feed="all">
      🌐 All Posts
    </button>
    <button class="feed-tab" data-feed="following">
      ✦ Following
      <span class="feed-tab__badge" id="followingFeedBadge" hidden>0</span>
    </button>
  `;

  /* Insert tab bar before the posts feed */
  postsUI.insertBefore(tabBar, postsFeed);

  /* Create following feed container (hidden initially) */
  const followingFeed = document.createElement("div");
  followingFeed.id     = "followingFeed";
  followingFeed.hidden = true;
  postsUI.insertBefore(followingFeed, postsFeed);

  /* Bind tab clicks */
  tabBar.querySelectorAll(".feed-tab").forEach(tab => {
    tab.addEventListener("click", () => _switchTab(tab.dataset.feed));
  });
}

/* ═══════════════════════════════════════════════════════════════
   SWITCH TABS
════════════════════════════════════════════════════════════════ */
function _switchTab(tab) {
  _activeTab = tab;
  const postsFeed     = document.getElementById("postsFeed");
  const followingFeed = document.getElementById("followingFeed");
  const allTab        = document.querySelector('[data-feed="all"]');
  const followTab     = document.querySelector('[data-feed="following"]');

  if (!postsFeed || !followingFeed) return;

  allTab?.classList.toggle("active",    tab === "all");
  followTab?.classList.toggle("active", tab === "following");

  if (tab === "all") {
    postsFeed.hidden     = false;
    followingFeed.hidden = true;
  } else {
    postsFeed.hidden     = true;
    followingFeed.hidden = false;
    _loadFollowingFeed();
  }
}

/* ═══════════════════════════════════════════════════════════════
   LOAD FOLLOWING UIDS
════════════════════════════════════════════════════════════════ */
async function _loadFollowingUids() {
  if (!currentUser) return [];
  try {
    const snap = await getDocs(
      query(
        collection(db, "follows"),
        where("followerId", "==", currentUser.uid)
      )
    );
    return snap.docs.map(d => d.data().followingId).filter(Boolean);
  } catch (err) {
    console.warn("_loadFollowingUids:", err);
    return [];
  }
}

/* ═══════════════════════════════════════════════════════════════
   LOAD FOLLOWING FEED
════════════════════════════════════════════════════════════════ */
let _feedLoaded = false;
let _pendingNew = [];  // posts that arrived while user is scrolled down

async function _loadFollowingFeed() {
  const container = document.getElementById("followingFeed");
  if (!container) return;

  /* Only load once per session; re-show if already loaded */
  if (_feedLoaded) return;
  _feedLoaded = true;

  /* Loading state */
  container.innerHTML = `
    <div class="feed-loading">
      <div class="feed-spinner"></div>
      <span>Loading your following feed…</span>
    </div>`;

  /* Get followed UIDs */
  _followingUids = await _loadFollowingUids();

  if (_followingUids.length === 0) {
    _showEmptyState(container);
    return;
  }

  /* Firestore "in" queries support max 30 items.
     Split into chunks of 30 if needed.             */
  const chunks = _chunkArray(_followingUids, 30);
  const allPosts = [];

  for (const chunk of chunks) {
    try {
      const q    = query(
        collection(db, "posts"),
        where("authorId", "in", chunk),
        orderBy("timestamp", "desc"),
        limit(FEED_LIMIT)
      );
      const snap = await new Promise((res, rej) => {
        const unsub = onSnapshot(q, s => { unsub(); res(s); }, rej);
      });
      snap.docs.forEach(d => allPosts.push({ id: d.id, data: d.data() }));
    } catch (err) {
      console.warn("feed chunk:", err);
    }
  }

  /* Sort all chunks together by timestamp descending */
  allPosts.sort((a, b) => {
    const ta = a.data.timestamp?.toDate?.()?.getTime() || 0;
    const tb = b.data.timestamp?.toDate?.()?.getTime() || 0;
    return tb - ta;
  });

  container.innerHTML = "";

  if (allPosts.length === 0) {
    _showEmptyState(container, true);
    return;
  }

  /* Show a hint bar with avatars of followed users */
  _injectFollowHint(container);

  /* Render posts */
  for (const { id, data } of allPosts) {
    const card = await _buildFeedCard(id, data);
    if (card) container.appendChild(card);
  }

  /* Start real-time listener for new posts */
  _startRealtimeFeed();
}

/* ═══════════════════════════════════════════════════════════════
   REAL-TIME LISTENER — new posts from followed users
════════════════════════════════════════════════════════════════ */
function _startRealtimeFeed() {
  /* Clear old listeners */
  _feedUnsubs.forEach(u => u());
  _feedUnsubs = [];

  if (_followingUids.length === 0) return;

  /* We listen to the most recent post timestamp we've seen */
  const container = document.getElementById("followingFeed");
  if (!container) return;

  /* Get the newest timestamp from existing cards */
  let newestTs = new Date();

  const chunks = _chunkArray(_followingUids, 30);
  for (const chunk of chunks) {
    const q = query(
      collection(db, "posts"),
      where("authorId", "in", chunk),
      where("timestamp", ">", newestTs),
      orderBy("timestamp", "desc"),
      limit(10)
    );
    const unsub = onSnapshot(q, snap => {
      if (snap.empty) return;
      const newCount = snap.docs.length;
      if (newCount === 0) return;

      /* Show "New posts" pill */
      _showNewPostsPill(container, snap.docs);

      /* Update badge */
      const badge = document.getElementById("followingFeedBadge");
      if (badge) {
        const cur = parseInt(badge.textContent || "0") + newCount;
        badge.textContent = cur > 99 ? "99+" : cur;
        badge.hidden = false;
      }
    }, () => {});
    _feedUnsubs.push(unsub);
  }
}

/* ═══════════════════════════════════════════════════════════════
   NEW POSTS PILL
════════════════════════════════════════════════════════════════ */
function _showNewPostsPill(container, newDocs) {
  /* Don't stack multiple pills */
  if (container.querySelector(".feed-new-pill")) return;

  const pill = document.createElement("div");
  pill.className = "feed-new-pill";
  pill.innerHTML = `
    <button>
      ↑ ${newDocs.length} new post${newDocs.length > 1 ? "s" : ""} — tap to refresh
    </button>`;

  pill.querySelector("button").addEventListener("click", async () => {
    pill.remove();
    /* Reset and reload */
    _feedLoaded = false;
    _feedUnsubs.forEach(u => u());
    _feedUnsubs = [];
    const badge = document.getElementById("followingFeedBadge");
    if (badge) badge.hidden = true;
    container.innerHTML = "";
    _loadFollowingFeed();
  });

  container.insertBefore(pill, container.firstChild);
}

/* ═══════════════════════════════════════════════════════════════
   BUILD A FEED POST CARD
   Matches the visual style of posts.js post cards so that
   features/reactions.js and features/follow.js work on them too.
════════════════════════════════════════════════════════════════ */
async function _buildFeedCard(id, data) {
  /* Skip private posts unless admin */
  if (data.privacy === "private") {
    if (!currentProfile?.admin &&
        !(data.privacyList || []).includes(currentUser?.uid)) {
      return null;
    }
  }

  const mine   = data.authorId === currentUser?.uid;
  const canDel = currentProfile?.admin || mine;
  const time   = data.timestamp?.toDate
    ? data.timestamp.toDate().toLocaleDateString("en-IN",
        { day:"numeric", month:"short", year:"numeric" })
    : "";

  /* Reactions */
  const reactions = data.reactions || {};
  let reactionsHTML = "";
  for (const [emoji, users] of Object.entries(reactions)) {
    if (!Array.isArray(users) || !users.length) continue;
    const reacted = users.includes(currentUser?.uid);
    reactionsHTML += `
      <button class="reaction-btn ${reacted ? "reacted" : ""}"
              data-emoji="${_esc(emoji)}" data-id="${id}">
        ${emoji} <span>${users.length}</span>
      </button>`;
  }

  /* Media */
  let mediaHTML = "";
  if (Array.isArray(data.mediaItems) && data.mediaItems.length) {
    const cnt = Math.min(data.mediaItems.length, 3);
    mediaHTML = `<div class="post-media-grid post-media-grid--${cnt}">`;
    data.mediaItems.forEach(m => {
      mediaHTML += m.type === "video"
        ? `<video src="${_esc(m.url)}" class="post-media-item" controls preload="metadata"></video>`
        : `<img src="${_esc(m.url)}" class="post-media-item" alt="Post media" loading="lazy" />`;
    });
    mediaHTML += `</div>`;
  }

  const card = document.createElement("article");
  card.className   = "post-card glass-panel ff-card--enter";
  card.dataset.postId = id;
  card.style.marginBottom = "1.25rem";

  card.innerHTML = `
    <div class="post-card__header">
      <div class="post-card__avatar"
           data-role="${_esc(data.authorRole)}"
           style="cursor:pointer"
           title="View profile">
        ${(data.authorName || "?")[0].toUpperCase()}
      </div>
      <div class="post-card__meta">
        <div class="post-card__author-row">
          <span class="post-card__author" style="cursor:pointer;transition:color .2s" title="View profile">
            ${_esc(data.authorName)}
          </span>
          <span class="post-card__role-badge post-role--${_esc(data.authorRole)}">
            ${_esc(data.authorRole)}
          </span>
          ${data.specialUser
            ? `<span class="post-card__special-badge">⭐</span>` : ""}
          ${data.privacy === "private"
            ? `<span class="post-privacy-badge" title="Private post">🔒</span>` : ""}
        </div>
        <span class="post-card__time">${time}</span>
      </div>
      ${canDel
        ? `<button class="post-del-btn js-ffdel" data-id="${id}" title="Delete post">🗑</button>`
        : ""}
    </div>
    ${data.content
      ? `<p class="post-card__content">${_esc(data.content)}</p>` : ""}
    ${mediaHTML}
    <div class="post-card__footer">
      <div class="post-reactions" id="reactions-${id}">
        ${reactionsHTML}
        <button class="reaction-add-btn js-ffreact" data-id="${id}" title="Add reaction">
          😊 +
        </button>
      </div>
      <button class="post-comment-toggle js-ffcomments" data-id="${id}">
        💬 Comments${data.commentCount ? ` (${data.commentCount})` : ""}
      </button>
    </div>
    <div class="post-comments-section" id="ffcomments-${id}" hidden></div>
  `;

  /* Profile link on avatar / author name */
  const avatarEl = card.querySelector(".post-card__avatar");
  const authorEl = card.querySelector(".post-card__author");
  const _goProfile = () => window.open(`profile.html?user=${data.authorId}`, "_blank");
  avatarEl?.addEventListener("click", _goProfile);
  authorEl?.addEventListener("click", _goProfile);
  authorEl?.classList.add("profile-link");

  /* Delete */
  card.querySelector(".js-ffdel")?.addEventListener("click", async () => {
    if (!confirm("Delete this post?")) return;
    const { deleteDoc, doc: fsDoc } =
      await import("https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js");
    await deleteDoc(fsDoc(db, "posts", id)).catch(() => _toast("Delete failed."));
    card.remove();
  });

  /* Reaction add btn — use same emoji picker from posts.js via DOM re-use */
  card.querySelector(".js-ffreact")?.addEventListener("click", e => {
    /* Dispatch a synthetic click on the nearest add-reaction button
       that posts.js handles — but since this card is outside postsFeed,
       we handle it ourselves with a simple picker. */
    _showFeedEmojiPicker(e, id);
  });

  /* Existing reaction buttons */
  card.querySelectorAll(".reaction-btn").forEach(btn => {
    btn.addEventListener("click", () => _toggleFeedReaction(id, btn.dataset.emoji));
  });

  /* Comments toggle */
  card.querySelector(".js-ffcomments")?.addEventListener("click", () => {
    const section = document.getElementById(`ffcomments-${id}`);
    if (!section) return;
    section.hidden = !section.hidden;
    if (!section.dataset.loaded) {
      section.dataset.loaded = "1";
      _loadFeedComments(id, section);
    }
  });

  /* Live update reactions on this card */
  _watchFeedCardReactions(id, card);

  /* Animate in */
  requestAnimationFrame(() => card.classList.add("ff-card--visible"));

  return card;
}

/* ═══════════════════════════════════════════════════════════════
   LIVE REACTION UPDATES FOR FEED CARDS
════════════════════════════════════════════════════════════════ */
function _watchFeedCardReactions(postId, card) {
  import("https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js")
    .then(({ onSnapshot, doc: fsDoc }) => {
      const unsub = onSnapshot(fsDoc(db, "posts", postId), snap => {
        if (!snap.exists()) return;
        const reactions = snap.data().reactions || {};
        const row = card.querySelector(`#reactions-${postId}`);
        if (!row) return;
        const addBtn = row.querySelector(".js-ffreact");
        /* Re-render reaction buttons */
        row.innerHTML = "";
        for (const [emoji, users] of Object.entries(reactions)) {
          if (!Array.isArray(users) || !users.length) continue;
          const reacted = users.includes(currentUser?.uid);
          const btn = document.createElement("button");
          btn.className = `reaction-btn${reacted ? " reacted" : ""}`;
          btn.dataset.emoji = emoji;
          btn.dataset.id    = postId;
          btn.innerHTML     = `${emoji} <span>${users.length}</span>`;
          btn.addEventListener("click", () => _toggleFeedReaction(postId, emoji));
          row.appendChild(btn);
        }
        if (addBtn) {
          row.appendChild(addBtn);
        } else {
          const newAdd = document.createElement("button");
          newAdd.className = "reaction-add-btn js-ffreact";
          newAdd.dataset.id = postId;
          newAdd.title = "Add reaction";
          newAdd.textContent = "😊 +";
          newAdd.addEventListener("click", e => _showFeedEmojiPicker(e, postId));
          row.appendChild(newAdd);
        }
      }, () => {});

      const mo = new MutationObserver(() => {
        if (!document.contains(card)) { unsub(); mo.disconnect(); }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    });
}

/* ═══════════════════════════════════════════════════════════════
   EMOJI PICKER (for feed cards — mirrors posts.js)
════════════════════════════════════════════════════════════════ */
const FEED_EMOJIS = ["❤️","😂","😮","😢","👍","🔥","🎉","😍","🙌","💯","😎","🥺","✨","🤣","👏","💪","🤩","😭","👀","🫶"];

function _showFeedEmojiPicker(e, postId) {
  document.getElementById("feedEmojiPicker")?.remove();
  const picker = document.createElement("div");
  picker.id = "feedEmojiPicker";
  picker.className = "emoji-picker";
  FEED_EMOJIS.forEach(em => {
    const btn = document.createElement("button");
    btn.className = "emoji-picker__btn";
    btn.textContent = em;
    btn.addEventListener("click", () => {
      _toggleFeedReaction(postId, em);
      picker.remove();
    });
    picker.appendChild(btn);
  });
  document.body.appendChild(picker);
  const rect = e.target.getBoundingClientRect();
  picker.style.cssText = `position:fixed;top:${rect.bottom+4}px;left:${
    Math.min(rect.left, innerWidth - 290)}px;z-index:9999`;
  const dismiss = ev => {
    if (!picker.contains(ev.target)) {
      picker.remove();
      document.removeEventListener("click", dismiss);
    }
  };
  setTimeout(() => document.addEventListener("click", dismiss), 0);
}

async function _toggleFeedReaction(postId, emoji) {
  if (!currentUser) return _toast("Login to react.");
  const { updateDoc: upd, doc: fsDoc, arrayUnion: au, arrayRemove: ar, getDoc: gd } =
    await import("https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js");
  const ref  = fsDoc(db, "posts", postId);
  const snap = await gd(ref);
  if (!snap.exists()) return;
  const users     = (snap.data().reactions || {})[emoji] || [];
  const alreadyIn = users.includes(currentUser.uid);
  await upd(ref, {
    [`reactions.${emoji}`]: alreadyIn ? ar(currentUser.uid) : au(currentUser.uid)
  }).catch(() => _toast("Reaction failed."));
}

/* ═══════════════════════════════════════════════════════════════
   COMMENTS (mirrors posts.js pattern)
════════════════════════════════════════════════════════════════ */
function _loadFeedComments(postId, section) {
  section.innerHTML = `
    <div class="comments-list" id="ffclist-${postId}"></div>
    <div class="comment-form">
      <input type="text" id="ffctext-${postId}" class="comment-input"
             placeholder="Add a comment…" maxlength="300" />
      <button class="comment-submit js-ffcsend" data-id="${postId}">Send</button>
    </div>`;

  section.querySelector(".js-ffcsend")?.addEventListener("click", () =>
    _submitFeedComment(postId));
  section.querySelector(`#ffctext-${postId}`)?.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); _submitFeedComment(postId); }
  });

  import("https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js")
    .then(({ onSnapshot, collection: col, query: q, orderBy: ob, doc: fsDoc }) => {
      const cq = q(col(db, "posts", postId, "comments"), ob("timestamp", "asc"));
      onSnapshot(cq, snap => {
        const list = document.getElementById(`ffclist-${postId}`);
        if (!list) return;
        list.innerHTML = "";
        if (snap.empty) {
          list.innerHTML = `<p class="comment-empty">No comments yet.</p>`;
          return;
        }
        snap.forEach(d => {
          const c    = d.data();
          const mine = c.authorId === currentUser?.uid;
          const canD = currentProfile?.admin || mine;
          const time = c.timestamp?.toDate
            ? c.timestamp.toDate().toLocaleDateString("en-IN",
                { day:"numeric", month:"short" }) : "";
          const div = document.createElement("div");
          div.className = "comment-item";
          div.innerHTML = `
            <div class="comment-header">
              <span class="comment-avatar">${(c.authorName||"?")[0].toUpperCase()}</span>
              <span class="comment-author">${_esc(c.authorName)}</span>
              <span class="comment-time">${time}</span>
              ${canD ? `<button class="comment-del js-ffcdel"
                               data-pid="${postId}" data-cid="${d.id}">🗑</button>` : ""}
            </div>
            <p class="comment-text">${_esc(c.text)}</p>`;
          div.querySelector(".js-ffcdel")?.addEventListener("click", async ev => {
            if (!confirm("Delete comment?")) return;
            const { deleteDoc: dd, doc: fsd } =
              await import("https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js");
            await dd(fsd(db, "posts", ev.target.dataset.pid,
              "comments", ev.target.dataset.cid)).catch(() => _toast("Delete failed."));
          });
          list.appendChild(div);
        });
      });
    });
}

async function _submitFeedComment(postId) {
  if (!currentUser || !currentProfile) return _toast("Login to comment.");
  const input = document.getElementById(`ffctext-${postId}`);
  const text  = input?.value.trim();
  if (!text) return;
  input.value = "";
  const { addDoc: ad, collection: col, doc: fsDoc,
          serverTimestamp: sts, updateDoc: upd, getDoc: gd } =
    await import("https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js");
  try {
    await ad(col(db, "posts", postId, "comments"), {
      text,
      authorId:   currentUser.uid,
      authorName: currentProfile.name,
      authorRole: currentProfile.role,
      timestamp:  sts(),
    });
    const snap = await gd(fsDoc(db, "posts", postId));
    if (snap.exists()) {
      await upd(fsDoc(db, "posts", postId),
        { commentCount: (snap.data().commentCount || 0) + 1 });
    }
  } catch { _toast("Comment failed."); }
}

/* ═══════════════════════════════════════════════════════════════
   EMPTY STATE
════════════════════════════════════════════════════════════════ */
async function _injectFollowHint(container) {
  /* Show mini avatars of followed users */
  const snap = await getDocs(
    query(collection(db, "follows"), where("followerId", "==", currentUser.uid))
  ).catch(() => null);
  if (!snap || snap.empty) return;

  const uids = snap.docs.slice(0, 5).map(d => d.data().followingId);
  const users = await Promise.all(uids.map(uid =>
    getDoc(doc(db, "users", uid)).then(s => s.exists() ? s.data() : null).catch(() => null)
  ));
  const valid = users.filter(Boolean);
  if (!valid.length) return;

  const hint = document.createElement("div");
  hint.className = "feed-follow-hint";
  hint.innerHTML = `
    <div class="feed-follow-hint__text">
      <strong>✦ Following Feed</strong>
      Posts from ${valid.length} classmate${valid.length > 1 ? "s" : ""} you follow
    </div>
    <div class="feed-follow-hint__avatars">
      ${valid.map(u => `
        <div class="fha" title="${_esc(u.name)}"
             onclick="window.open('profile.html?user=${_esc(u.uid)}','_blank')">
          ${(u.name || "?")[0].toUpperCase()}
        </div>`).join("")}
    </div>`;
  container.insertBefore(hint, container.firstChild);
}

function _showEmptyState(container, hasFollowingButNoPosts = false) {
  container.innerHTML = `
    <div class="feed-empty">
      <span class="feed-empty__icon">${hasFollowingButNoPosts ? "📭" : "🌱"}</span>
      <h3 class="feed-empty__title">
        ${hasFollowingButNoPosts ? "No posts yet" : "Your feed is empty"}
      </h3>
      <p class="feed-empty__desc">
        ${hasFollowingButNoPosts
          ? "The people you follow haven't posted anything yet. Check back soon!"
          : "Follow classmates to see their posts here. Visit their profiles and hit Follow!"}
      </p>
      <button class="feed-empty__btn" onclick="
        document.getElementById('posts')?.scrollIntoView({behavior:'smooth'});
        document.querySelector('[data-feed=\"all\"]')?.click();
      ">
        🌐 Browse All Posts
      </button>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════════════════════ */
function _chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function _esc(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function _toast(msg) {
  const el = document.getElementById("toastNotif");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 3000);
}

/* ═══════════════════════════════════════════════════════════════
   BOOT — wait for postsUI to become visible
════════════════════════════════════════════════════════════════ */
onAuthChange((user, profile) => {
  if (!user || !profile?.profileComplete || profile.banned) {
    /* Reset on logout */
    _injected   = false;
    _feedLoaded = false;
    _feedUnsubs.forEach(u => u());
    _feedUnsubs    = [];
    _followingUids = [];
    document.getElementById("feedTabBar")?.remove();
    document.getElementById("followingFeed")?.remove();
    return;
  }

  /* postsUI might be hidden until auth resolves — poll for it */
  const tryInject = (tries = 0) => {
    const postsUI = document.getElementById("postsUI");
    if (postsUI && !postsUI.hidden) {
      _injectTabBar();
      return;
    }
    if (tries < 30) setTimeout(() => tryInject(tries + 1), 300);
  };
  tryInject();
});
