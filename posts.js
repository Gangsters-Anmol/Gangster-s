/**
 * posts.js
 * Create / read / like / delete posts.
 * Only specialUser accounts can create; all logged-in users can like.
 * ─────────────────────────────────────────────────────────────
 */

import {
  collection, addDoc, query, orderBy,
  onSnapshot, deleteDoc, doc,
  updateDoc, arrayUnion, arrayRemove,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

import { db }                              from "./firebase-config.js";
import { onAuthChange, showToast,
         currentUser, currentProfile }     from "./auth.js";

/* ═══════════════════════════════════════════════════════════════
   DOM REFS
════════════════════════════════════════════════════════════════ */
const postsAuthNotice = document.getElementById("postsAuthNotice");
const postsUI         = document.getElementById("postsUI");
const createPostWrap  = document.getElementById("createPostWrap");
const postContent     = document.getElementById("postContent");
const submitPostBtn   = document.getElementById("submitPostBtn");
const postCharCount   = document.getElementById("postCharCount");
const postsFeed       = document.getElementById("postsFeed");

let _unsub = null;

/* ═══════════════════════════════════════════════════════════════
   AUTH GATE
════════════════════════════════════════════════════════════════ */
onAuthChange((user, profile) => {
  if (user && profile?.profileComplete && !profile.banned) {
    postsAuthNotice.hidden = true;
    postsUI.hidden         = false;
    createPostWrap.hidden  = !profile.specialUser;
    _initFeed();
  } else {
    postsAuthNotice.hidden = false;
    postsUI.hidden         = true;
    _unsub?.(); _unsub = null;
  }
});

/* ═══════════════════════════════════════════════════════════════
   CHARACTER COUNTER
════════════════════════════════════════════════════════════════ */
postContent?.addEventListener("input", () => {
  const rem = 500 - postContent.value.length;
  postCharCount.textContent = `${rem} characters remaining`;
  postCharCount.classList.toggle("warn",   rem < 100);
  postCharCount.classList.toggle("danger", rem < 30);
});

/* Ctrl+Enter shortcut */
postContent?.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") _submitPost();
});

/* ═══════════════════════════════════════════════════════════════
   SUBMIT POST
════════════════════════════════════════════════════════════════ */
submitPostBtn?.addEventListener("click", _submitPost);

async function _submitPost() {
  if (!currentUser || !currentProfile?.specialUser) return;
  const text = postContent?.value.trim();
  if (!text) return showToast("Write something first!");
  submitPostBtn.disabled = true;
  submitPostBtn.textContent = "Sharing…";
  try {
    await addDoc(collection(db, "posts"), {
      content:    text,
      authorId:   currentUser.uid,
      authorName: currentProfile.name,
      authorRole: currentProfile.role,
      specialUser: true,
      timestamp:  serverTimestamp(),
      likes:      [],
      likeCount:  0,
    });
    postContent.value = "";
    postCharCount.textContent = "500 characters remaining";
    showToast("Post shared ✦");
  } catch { showToast("Failed to post."); }
  finally {
    submitPostBtn.disabled = false;
    submitPostBtn.textContent = "Share Post";
  }
}

/* ═══════════════════════════════════════════════════════════════
   REAL-TIME FEED
════════════════════════════════════════════════════════════════ */
function _initFeed() {
  _unsub?.();
  _unsub = onSnapshot(
    query(collection(db, "posts"), orderBy("timestamp", "desc")),
    snap => {
      postsFeed.innerHTML = "";
      if (snap.empty) {
        postsFeed.innerHTML = `<p class="posts-empty">No posts yet. Be the first to share! ✦</p>`;
        return;
      }
      snap.forEach(d => postsFeed.appendChild(_buildCard(d.id, d.data())));
    },
    err => console.error("posts feed:", err)
  );
}

/* ═══════════════════════════════════════════════════════════════
   BUILD POST CARD
════════════════════════════════════════════════════════════════ */
function _buildCard(id, data) {
  const mine    = data.authorId === currentUser?.uid;
  const canDel  = currentProfile?.admin || mine;
  const liked   = Array.isArray(data.likes) && data.likes.includes(currentUser?.uid);
  const count   = data.likeCount ?? 0;

  const time = data.timestamp?.toDate
    ? data.timestamp.toDate().toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric" })
    : "";

  const card = document.createElement("article");
  card.className = "post-card glass-panel";

  card.innerHTML = `
    <div class="post-card__header">
      <div class="post-card__avatar" data-role="${_esc(data.authorRole)}">
        ${data.authorName[0].toUpperCase()}
      </div>
      <div class="post-card__meta">
        <div class="post-card__author-row">
          <span class="post-card__author">${_esc(data.authorName)}</span>
          <span class="post-card__role-badge post-role--${_esc(data.authorRole)}">${_esc(data.authorRole)}</span>
          ${data.specialUser ? `<span class="post-card__special-badge">⭐</span>` : ""}
        </div>
        <span class="post-card__time">${time}</span>
      </div>
      ${canDel ? `<button class="post-del-btn js-del" data-id="${id}" title="Delete post">🗑</button>` : ""}
    </div>
    <p class="post-card__content">${_esc(data.content)}</p>
    <div class="post-card__footer">
      <button class="post-like-btn js-like ${liked ? "liked" : ""}" data-id="${id}">
        <span class="like-heart">${liked ? "♥" : "♡"}</span>
        <span class="like-num">${count}</span>
        <span class="like-label">like${count !== 1 ? "s" : ""}</span>
      </button>
    </div>`;

  /* Like handler */
  card.querySelector(".js-like").addEventListener("click", async () => {
    if (!currentUser) return showToast("Login to like posts.");
    const ref  = doc(db, "posts", id);
    const nowLiked = card.querySelector(".js-like").classList.contains("liked");
    await updateDoc(ref, {
      likes:     nowLiked ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid),
      likeCount: nowLiked ? Math.max(0, count - 1) : count + 1
    }).catch(() => showToast("Like failed."));
  });

  /* Delete handler */
  card.querySelector(".js-del")?.addEventListener("click", async () => {
    if (!confirm("Delete this post?")) return;
    await deleteDoc(doc(db, "posts", id)).catch(() => showToast("Delete failed."));
  });

  return card;
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════════════════════ */
function _esc(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
