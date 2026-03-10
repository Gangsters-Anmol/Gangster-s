/**
 * posts.js — UPGRADED
 * Features: text + multi-media posts, Cloudinary upload, file size validation,
 * public/private posts, privacy list, emoji reactions (real-time),
 * comments (text), delete posts/comments, infinite scroll.
 */

import {
  collection, addDoc, query, orderBy, limit, startAfter,
  onSnapshot, deleteDoc, doc, updateDoc, getDoc, getDocs,
  arrayUnion, arrayRemove, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

import { db }                              from "./firebase-config.js";
import { onAuthChange, showToast,
         currentUser, currentProfile }     from "./auth.js";
import { sendNotification }               from "./features/notifications.js";

/* ══ CLOUDINARY CONFIG ══════════════════════════════════════════ */
const CLOUD_NAME    = "dsbsinbun";
const UPLOAD_PRESET = "ghost_user"; // Set to your unsigned preset in Cloudinary dashboard

/* ══ FILE SIZE LIMITS ═══════════════════════════════════════════ */
const MAX_IMAGE_SIZE = 5  * 1024 * 1024;  // 5 MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100 MB

/* ══ DOM REFS ════════════════════════════════════════════════════ */
const postsAuthNotice = document.getElementById("postsAuthNotice");
const postsUI         = document.getElementById("postsUI");
const createPostWrap  = document.getElementById("createPostWrap");
const postContent     = document.getElementById("postContent");
const submitPostBtn   = document.getElementById("submitPostBtn");
const postCharCount   = document.getElementById("postCharCount");
const postsFeed       = document.getElementById("postsFeed");

let _unsub       = null;
let _lastDoc     = null;
let _loadingMore = false;
let _allLoaded   = false;
let _pendingFiles = [];
const PAGE_SIZE  = 10;

/* ══ INJECT EXTRA UI ════════════════════════════════════════════ */
function _injectCreatePostUI() {
  const panel = document.querySelector(".create-post-panel");
  if (!panel || document.getElementById("postMediaRow")) return;

  const extras = document.createElement("div");
  extras.innerHTML = `
    <div id="postMediaRow" class="post-media-row">
      <label class="media-upload-btn" title="Attach image / GIF / video">
        📎 Media
        <input type="file" id="postMediaInput" accept="image/*,video/*" multiple hidden />
      </label>
      <select id="postPrivacy" class="post-privacy-select">
        <option value="public">🌐 Public</option>
        <option value="private">🔒 Private</option>
      </select>
      <button id="managePrivacyListBtn" class="post-privacy-list-btn" hidden>👥 Privacy List</button>
    </div>
    <div id="postMediaPreview" class="post-media-preview"></div>
    <div id="uploadProgress" class="upload-progress" hidden>
      <div class="upload-progress__bar"><div id="uploadProgressFill" class="upload-progress__fill"></div></div>
      <span id="uploadProgressLabel" class="upload-progress__label">Uploading…</span>
    </div>`;

  const footer = panel.querySelector(".create-post-footer");
  panel.insertBefore(extras, footer);

  document.getElementById("postPrivacy")?.addEventListener("change", e => {
    document.getElementById("managePrivacyListBtn").hidden = e.target.value !== "private";
  });
  document.getElementById("managePrivacyListBtn")?.addEventListener("click", _openPrivacyListModal);
  document.getElementById("postMediaInput")?.addEventListener("change", _handleMediaSelect);
}

/* ══ MEDIA HANDLING ═════════════════════════════════════════════ */
function _handleMediaSelect(e) {
  Array.from(e.target.files).forEach(f => {
    const isVideo = f.type.startsWith("video/");
    const limit   = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
    const label   = isVideo ? "100MB" : "5MB";
    if (f.size > limit) { showToast(`"${f.name}" exceeds ${label} limit.`); return; }
    _pendingFiles.push(f);
  });
  e.target.value = "";
  _renderMediaPreview();
}

function _renderMediaPreview() {
  const wrap = document.getElementById("postMediaPreview");
  if (!wrap) return;
  wrap.innerHTML = "";
  _pendingFiles.forEach((f, i) => {
    const item = document.createElement("div");
    item.className = "media-preview-item";
    const url = URL.createObjectURL(f);
    item.innerHTML = f.type.startsWith("video/")
      ? `<video src="${url}" class="media-preview-thumb" muted></video>`
      : `<img src="${url}" class="media-preview-thumb" alt="">`;
    const rm = document.createElement("button");
    rm.className = "media-preview-remove";
    rm.textContent = "✕";
    rm.addEventListener("click", () => { _pendingFiles.splice(i, 1); _renderMediaPreview(); });
    item.appendChild(rm);
    wrap.appendChild(item);
  });
}

async function _uploadToCloudinary(file, onProgress) {
  const fd  = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", UPLOAD_PRESET);
  const isVideo = file.type.startsWith("video/");
  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${isVideo ? "video" : "image"}/upload`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100)); };
    xhr.onload = () => {
      if (xhr.status === 200) {
        const d = JSON.parse(xhr.responseText);
        resolve({ url: d.secure_url, type: isVideo ? "video" : "image" });
      } else {
        reject(new Error("Upload failed: " + xhr.responseText));
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(fd);
  });
}

/* ══ AUTH GATE ══════════════════════════════════════════════════ */
onAuthChange((user, profile) => {
  if (user && profile?.profileComplete && !profile.banned) {
    postsAuthNotice.hidden = true;
    postsUI.hidden         = false;
    createPostWrap.hidden  = !profile.specialUser;
    if (profile.specialUser) _injectCreatePostUI();
    _initFeed();
  } else {
    postsAuthNotice.hidden = false;
    postsUI.hidden         = true;
    _unsub?.(); _unsub = null;
  }
});

/* ══ CHARACTER COUNTER ══════════════════════════════════════════ */
postContent?.addEventListener("input", () => {
  const rem = 500 - postContent.value.length;
  postCharCount.textContent = `${rem} characters remaining`;
  postCharCount.classList.toggle("warn",   rem < 100);
  postCharCount.classList.toggle("danger", rem < 30);
});
postContent?.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") _submitPost();
});

/* ══ SUBMIT POST ════════════════════════════════════════════════ */
submitPostBtn?.addEventListener("click", _submitPost);

async function _submitPost() {
  if (!currentUser || !currentProfile?.specialUser) return;
  const text = postContent?.value.trim();
  if (!text && _pendingFiles.length === 0 && !window._pendingPoll) return showToast("Write something, attach media, or add a poll!");

  submitPostBtn.disabled    = true;
  submitPostBtn.textContent = "Sharing…";
  const progressWrap  = document.getElementById("uploadProgress");
  const progressFill  = document.getElementById("uploadProgressFill");
  const progressLabel = document.getElementById("uploadProgressLabel");

  try {
    let mediaItems = [];
    if (_pendingFiles.length > 0) {
      if (progressWrap) progressWrap.hidden = false;
      for (let i = 0; i < _pendingFiles.length; i++) {
        if (progressLabel) progressLabel.textContent = `Uploading ${i+1}/${_pendingFiles.length}…`;
        const res = await _uploadToCloudinary(_pendingFiles[i], pct => {
          if (progressFill) progressFill.style.width = pct + "%";
        });
        mediaItems.push(res);
      }
      if (progressWrap) progressWrap.hidden = true;
    }

    const privacy = document.getElementById("postPrivacy")?.value || "public";
    let privacyList = [];
    if (privacy === "private") {
      const snap = await getDoc(doc(db, "users", currentUser.uid));
      privacyList = snap.data()?.privacyList || [];
    }

    // Include any pending poll from polls.js
    const pollPayload = window._pendingPoll || null;
    if (pollPayload) window._pendingPoll = null;

    await addDoc(collection(db, "posts"), {
      content:      text || "",
      mediaItems,
      authorId:     currentUser.uid,
      authorName:   currentProfile.name,
      authorRole:   currentProfile.role,
      specialUser:  true,
      privacy,
      privacyList,
      timestamp:    serverTimestamp(),
      reactions:    {},
      commentCount: 0,
      ...(pollPayload ? { poll: pollPayload } : {}),
    });

    // Reset poll button if a poll was attached
    if (pollPayload) {
      const pollBtn = document.getElementById("wapPollPostBtn");
      if (pollBtn) { pollBtn.textContent = "📊 Poll"; pollBtn.classList.remove("on"); }
    }

    postContent.value         = "";
    postCharCount.textContent = "500 characters remaining";
    _pendingFiles = [];
    _renderMediaPreview();
    showToast("Post shared ✦");

    // Notify @mentioned users in the post content
    if (text) {
      const mentions = _parseMentions(text);
      for (const name of mentions) {
        const uid = await _getUidByName(name);
        if (uid && uid !== currentUser.uid) {
          sendNotification(uid, {
            type: "mention_post", fromUid: currentUser.uid,
            fromName: currentProfile?.name || "Someone",
            text: text.slice(0, 80),
          });
        }
      }
    }
  } catch (err) {
    console.error("post submit:", err);
    showToast("Failed to post. Check Cloudinary upload preset.");
    if (progressWrap) progressWrap.hidden = true;
  } finally {
    submitPostBtn.disabled    = false;
    submitPostBtn.textContent = "Share Post";
  }
}

/* ══ PRIVACY LIST MODAL ═════════════════════════════════════════ */
function _openPrivacyListModal() {
  document.getElementById("privacyListModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "privacyListModal";
  modal.className = "modal-overlay";
  modal.style.cssText = "display:flex;";
  modal.innerHTML = `
    <div class="modal-panel" style="max-width:420px;max-height:80vh;overflow-y:auto">
      <button class="modal-close" id="closePrivModal">✕</button>
      <div class="modal-logo">👥</div>
      <h2 class="modal-title">Privacy List</h2>
      <p class="modal-sub">Only listed people see your private posts</p>
      <div id="privacyUsersList" style="margin-top:1rem"></div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById("closePrivModal").onclick = () => modal.remove();
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  _loadPrivacyListUI();
}

async function _loadPrivacyListUI() {
  const container = document.getElementById("privacyUsersList");
  if (!container) return;
  container.innerHTML = `<p class="admin-hint">Loading…</p>`;
  const [usersSnap, myDoc] = await Promise.all([
    getDocs(collection(db, "users")),
    getDoc(doc(db, "users", currentUser.uid))
  ]);
  const myList = myDoc.data()?.privacyList || [];
  container.innerHTML = "";
  usersSnap.forEach(d => {
    if (d.id === currentUser.uid) return;
    const u = d.data();
    if (!u.profileComplete || u.banned) return;
    const inList = myList.includes(d.id);
    const row = document.createElement("div");
    row.className = "privacy-list-row";
    row.innerHTML = `
      <span class="user-list-avatar">${u.name[0].toUpperCase()}</span>
      <span style="flex:1">${_esc(u.name)} <em style="opacity:0.6;font-size:0.8em">${u.role}</em></span>
      <button class="priv-toggle-btn ${inList?"active":""}" data-uid="${d.id}">${inList?"✓ Added":"+ Add"}</button>`;
    row.querySelector(".priv-toggle-btn").addEventListener("click", async e => {
      const uid = e.target.dataset.uid;
      const was = e.target.classList.contains("active");
      await updateDoc(doc(db, "users", currentUser.uid), {
        privacyList: was ? arrayRemove(uid) : arrayUnion(uid)
      });
      e.target.classList.toggle("active", !was);
      e.target.textContent = was ? "+ Add" : "✓ Added";
      // Notify the person that they were added to a private list
      if (!was) {
        sendNotification(uid, {
          type: "privacy_list_add", fromUid: currentUser.uid,
          fromName: currentProfile?.name || "Someone",
        });
      }
    });
    container.appendChild(row);
  });
  if (!container.children.length) container.innerHTML = `<p class="admin-hint">No other users yet.</p>`;
}

/* ══ REAL-TIME FEED ═════════════════════════════════════════════ */
function _initFeed() {
  _unsub?.();
  _lastDoc   = null;
  _allLoaded = false;
  postsFeed.innerHTML = "";

  const q = query(collection(db, "posts"), orderBy("timestamp", "desc"), limit(PAGE_SIZE));
  _unsub = onSnapshot(q, snap => {
    postsFeed.innerHTML = "";
    if (snap.empty) {
      postsFeed.innerHTML = `<p class="posts-empty">No posts yet. Be the first to share! ✦</p>`;
      return;
    }
    _lastDoc = snap.docs[snap.docs.length - 1];
    snap.forEach(d => {
      const card = _buildCard(d.id, d.data());
      if (card) {
        postsFeed.appendChild(card);
        if (d.data().poll && window.hydratePollCard) {
          const pollHost = card.querySelector(".wap-post-poll");
          if (pollHost) window.hydratePollCard(pollHost);
        }
      }
    });
    _attachInfiniteScroll();
  }, err => console.error("posts feed:", err));
}

/* ══ INFINITE SCROLL ════════════════════════════════════════════ */
function _attachInfiniteScroll() {
  document.getElementById("postScrollSentinel")?.remove();
  if (_allLoaded) return;
  const sentinel = document.createElement("div");
  sentinel.id = "postScrollSentinel";
  sentinel.style.height = "10px";
  postsFeed.appendChild(sentinel);
  const io = new IntersectionObserver(async entries => {
    if (!entries[0].isIntersecting || _loadingMore || _allLoaded) return;
    _loadingMore = true;
    await _loadMorePosts();
    _loadingMore = false;
  }, { threshold: 0.1 });
  io.observe(sentinel);
}

async function _loadMorePosts() {
  if (!_lastDoc || _allLoaded) return;
  const loader = Object.assign(document.createElement("p"), { className: "posts-loading", textContent: "Loading more…" });
  const sentinel = document.getElementById("postScrollSentinel");
  postsFeed.insertBefore(loader, sentinel);
  try {
    const q = query(collection(db, "posts"), orderBy("timestamp","desc"), startAfter(_lastDoc), limit(PAGE_SIZE));
    const snap = await new Promise((res, rej) => { const u = onSnapshot(q, s => { u(); res(s); }, rej); });
    loader.remove();
    if (snap.docs.length < PAGE_SIZE) _allLoaded = true;
    if (snap.docs.length) _lastDoc = snap.docs[snap.docs.length - 1];
    snap.forEach(d => {
      const card = _buildCard(d.id, d.data());
      if (card) {
        postsFeed.insertBefore(card, sentinel);
        if (d.data().poll && window.hydratePollCard) {
          const pollHost = card.querySelector(".wap-post-poll");
          if (pollHost) window.hydratePollCard(pollHost);
        }
      }
    });
  } catch { loader.remove(); }
}

/* ══ BUILD POST CARD ════════════════════════════════════════════ */
function _buildCard(id, data) {
  if (data.privacy === "private") {
    const uid = currentUser?.uid;
    if (!uid) return null;
    if (!currentProfile?.admin && data.authorId !== uid && !(data.privacyList||[]).includes(uid)) return null;
  }

  const mine   = data.authorId === currentUser?.uid;
  const canDel = currentProfile?.admin || mine;
  const time   = data.timestamp?.toDate
    ? data.timestamp.toDate().toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric" })
    : "";

  // Reactions
  const reactions = data.reactions || {};
  let reactionsHTML = "";
  for (const [emoji, users] of Object.entries(reactions)) {
    if (!Array.isArray(users) || !users.length) continue;
    const reacted = users.includes(currentUser?.uid);
    reactionsHTML += `<button class="reaction-btn ${reacted?"reacted":""}" data-emoji="${_esc(emoji)}" data-id="${id}">${emoji} <span>${users.length}</span></button>`;
  }

  // Media
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
  card.className = "post-card glass-panel post-card--enter";
  card.dataset.postId = id;
  card.innerHTML = `
    <div class="post-card__header">
      <div class="post-card__avatar" data-role="${_esc(data.authorRole)}">${(data.authorName||"?")[0].toUpperCase()}</div>
      <div class="post-card__meta">
        <div class="post-card__author-row">
          <span class="post-card__author">${_esc(data.authorName)}</span>
          <span class="post-card__role-badge post-role--${_esc(data.authorRole)}">${_esc(data.authorRole)}</span>
          ${data.specialUser ? `<span class="post-card__special-badge">⭐</span>` : ""}
          ${data.privacy === "private" ? `<span class="post-privacy-badge" title="Private post">🔒</span>` : ""}
        </div>
        <span class="post-card__time">${time}</span>
      </div>
      ${canDel ? `<button class="post-del-btn js-del" data-id="${id}" title="Delete post">🗑</button>` : ""}
    </div>
    ${data.content ? `<p class="post-card__content">${_esc(data.content)}</p>` : ""}
    ${mediaHTML}
    ${data.poll ? `<div class="wap-post-poll" data-doc="${id}" data-col="posts"></div>` : ""}
    <div class="post-card__footer">
      <div class="post-reactions" id="reactions-${id}">
        ${reactionsHTML}
        <button class="reaction-add-btn js-react" data-id="${id}" title="Add reaction">😊 +</button>
      </div>
      <button class="post-comment-toggle js-comments" data-id="${id}">💬 Comments${data.commentCount ? ` (${data.commentCount})` : ""}</button>
    </div>
    <div class="post-comments-section" id="comments-${id}" hidden></div>`;

  card.querySelector(".js-del")?.addEventListener("click", async () => {
    if (!confirm("Delete this post?")) return;
    await deleteDoc(doc(db, "posts", id)).catch(() => showToast("Delete failed."));
  });
  card.querySelector(".js-react")?.addEventListener("click", e => _showEmojiPicker(e, id));
  card.querySelectorAll(".reaction-btn").forEach(btn => {
    btn.addEventListener("click", () => _toggleReaction(id, btn.dataset.emoji));
  });
  card.querySelector(".js-comments")?.addEventListener("click", () => {
    const section = document.getElementById(`comments-${id}`);
    if (!section) return;
    section.hidden = false;
    if (!section.dataset.loaded) { section.dataset.loaded = "1"; _loadComments(id, section); }
  });

  requestAnimationFrame(() => card.classList.add("post-card--visible"));
  return card;
}

/* ══ EMOJI PICKER ═══════════════════════════════════════════════ */
const COMMON_EMOJIS = ["❤️","😂","😮","😢","👍","🔥","🎉","😍","🙌","💯","😎","🥺","✨","🤣","👏","💪","🤩","😭","👀","🫶"];

function _showEmojiPicker(e, postId) {
  document.getElementById("emojiPicker")?.remove();
  const picker = document.createElement("div");
  picker.id = "emojiPicker";
  picker.className = "emoji-picker";
  COMMON_EMOJIS.forEach(em => {
    const btn = document.createElement("button");
    btn.className = "emoji-picker__btn";
    btn.textContent = em;
    btn.addEventListener("click", () => { _toggleReaction(postId, em); picker.remove(); });
    picker.appendChild(btn);
  });
  document.body.appendChild(picker);
  const rect = e.target.getBoundingClientRect();
  picker.style.cssText = `position:fixed;top:${rect.bottom+4}px;left:${Math.min(rect.left, innerWidth-290)}px;z-index:9999`;
  const dismiss = ev => { if (!picker.contains(ev.target)) { picker.remove(); document.removeEventListener("click", dismiss); } };
  setTimeout(() => document.addEventListener("click", dismiss), 0);
}

async function _toggleReaction(postId, emoji) {
  if (!currentUser) return showToast("Login to react.");
  const ref  = doc(db, "posts", postId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const users    = (snap.data().reactions || {})[emoji] || [];
  const alreadyIn = users.includes(currentUser.uid);
  await updateDoc(ref, {
    [`reactions.${emoji}`]: alreadyIn ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid)
  }).catch(() => showToast("Reaction failed."));
}

/* ══ COMMENTS ═══════════════════════════════════════════════════ */
function _loadComments(postId, section) {
  section.innerHTML = `
    <div class="comments-list" id="clist-${postId}"></div>
    <div class="comment-form">
      <input type="text" id="ctext-${postId}" class="comment-input" placeholder="Add a comment…" maxlength="300" />
      <button class="comment-submit js-csend" data-id="${postId}">Send</button>
    </div>`;

  section.querySelector(".js-csend")?.addEventListener("click", () => _submitComment(postId));
  section.querySelector(`#ctext-${postId}`)?.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); _submitComment(postId); }
  });

  const q = query(collection(db, "posts", postId, "comments"), orderBy("timestamp", "asc"));
  onSnapshot(q, snap => {
    const list = document.getElementById(`clist-${postId}`);
    if (!list) return;
    list.innerHTML = "";
    if (snap.empty) { list.innerHTML = `<p class="comment-empty">No comments yet.</p>`; return; }
    snap.forEach(d => {
      const c    = d.data();
      const mine   = c.authorId === currentUser?.uid;
      const canDel = currentProfile?.admin || mine;
      const time   = c.timestamp?.toDate
        ? c.timestamp.toDate().toLocaleDateString("en-IN", { day:"numeric", month:"short" }) : "";
      const div = document.createElement("div");
      div.className = "comment-item";
      div.innerHTML = `
        <div class="comment-header">
          <span class="comment-avatar">${(c.authorName||"?")[0].toUpperCase()}</span>
          <span class="comment-author">${_esc(c.authorName)}</span>
          <span class="comment-time">${time}</span>
          ${canDel ? `<button class="comment-del js-cdel" data-pid="${postId}" data-cid="${d.id}">🗑</button>` : ""}
        </div>
        <p class="comment-text">${_esc(c.text)}</p>`;
      div.querySelector(".js-cdel")?.addEventListener("click", async ev => {
        if (!confirm("Delete comment?")) return;
        await deleteDoc(doc(db, "posts", ev.target.dataset.pid, "comments", ev.target.dataset.cid))
          .catch(() => showToast("Delete failed."));
      });
      list.appendChild(div);
    });
  });
}

async function _submitComment(postId) {
  if (!currentUser || !currentProfile) return showToast("Login to comment.");
  const input = document.getElementById(`ctext-${postId}`);
  const text  = input?.value.trim();
  if (!text) return;
  input.value = "";
  try {
    await addDoc(collection(db, "posts", postId, "comments"), {
      text, authorId: currentUser.uid,
      authorName: currentProfile.name, authorRole: currentProfile.role,
      timestamp: serverTimestamp(),
    });
    const snap = await getDoc(doc(db, "posts", postId));
    if (snap.exists()) {
      await updateDoc(doc(db, "posts", postId), { commentCount: (snap.data().commentCount||0)+1 });

      // Notify post author about the comment
      const authorId = snap.data().authorId;
      if (authorId && authorId !== currentUser.uid) {
        sendNotification(authorId, {
          type: "comment", fromUid: currentUser.uid,
          fromName: currentProfile.name, postId,
          text: text.slice(0, 80),
        });
      }

      // Notify any @mentioned users in the comment
      const mentions = _parseMentions(text);
      for (const name of mentions) {
        const uid = await _getUidByName(name);
        if (uid && uid !== currentUser.uid && uid !== authorId) {
          sendNotification(uid, {
            type: "mention_comment", fromUid: currentUser.uid,
            fromName: currentProfile.name, postId,
            text: text.slice(0, 80),
          });
        }
      }
    }
  } catch { showToast("Comment failed."); }
}

/* ── Mention helpers ──────────────────────────────────────────── */
function _parseMentions(text) {
  const matches = text.match(/@([\w. ]+?)(?=\s|$|[,!?.])/g) || [];
  return matches.map(m => m.slice(1).trim()).filter(Boolean);
}

const _nameUidCache = new Map();
async function _getUidByName(name) {
  if (_nameUidCache.has(name)) return _nameUidCache.get(name);
  try {
    const snap = await getDocs(collection(db, "users"));
    for (const d of snap.docs) {
      if ((d.data().name || "").toLowerCase() === name.toLowerCase()) {
        _nameUidCache.set(name, d.id);
        return d.id;
      }
    }
  } catch { /* silent */ }
  return null;
}

/* ══ HELPERS ════════════════════════════════════════════════════ */
function _esc(s) {
  return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
