/**
 * features/avatar.js
 * ─────────────────────────────────────────────────────────────────
 * PURELY ADDITIVE — does not modify any existing file.
 *
 * What this file does:
 *  1. On index.html — upgrades the nav user label to show the
 *     current user's avatar (photo or initials) next to their name.
 *  2. On index.html — upgrades post card avatars and chat bubble
 *     avatars to show real photos when a user has one set.
 *  3. Exports  openAvatarUpload()  used by profile.html's upload UI.
 *  4. Exports  getUserAvatar(uid)  returns a cached photoURL or null.
 *  5. The actual upload flow lives in profile.html (Step 2).
 *
 * Cloudinary config matches the existing posts.js / chat.js setup.
 * ─────────────────────────────────────────────────────────────────
 */

import {
  doc, getDoc, updateDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

import { db }                                        from "../firebase-config.js";
import { onAuthChange, currentUser, currentProfile } from "../auth.js";

/* ── Cloudinary (same credentials as posts.js / chat.js) ─────── */
const CLOUD_NAME    = "dsbsinbun";
const UPLOAD_PRESET = "ml_default";
const MAX_SIZE      = 5 * 1024 * 1024; // 5 MB

/* ── In-memory photo cache  uid → photoURL | null ────────────── */
const _photoCache = new Map();

/* ═══════════════════════════════════════════════════════════════
   INJECT STYLES
════════════════════════════════════════════════════════════════ */
(function _injectStyles() {
  if (document.getElementById("avatar-js-styles")) return;
  const s = document.createElement("style");
  s.id = "avatar-js-styles";
  s.textContent = `
    /* ── Nav Avatar ────────────────────────────────────────── */
    .nav__avatar {
      width: 30px; height: 30px;
      border-radius: 50%;
      object-fit: cover;
      border: 2px solid var(--accent, #c8a96e);
      vertical-align: middle;
      margin-right: 0.4rem;
      flex-shrink: 0;
      transition: transform 0.2s ease;
    }
    .nav__avatar:hover { transform: scale(1.08); }
    .nav__user-label {
      display: inline-flex !important;
      align-items: center;
    }

    /* ── Post card avatar upgrade ──────────────────────────── */
    .post-card__avatar img,
    .admin-user-avatar img {
      width: 100%; height: 100%;
      object-fit: cover;
      border-radius: 50%;
      display: block;
    }

    /* ── Chat bubble avatar upgrade ────────────────────────── */
    .follow-user-avatar img {
      width: 100%; height: 100%;
      object-fit: cover;
      border-radius: 50%;
    }

    /* ── Upload button (injected into profile.html avatar wrap) */
    .avatar-upload-overlay {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: rgba(0,0,0,0.45);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.2rem;
      opacity: 0;
      transition: opacity 0.22s ease;
      cursor: pointer;
      z-index: 5;
    }
    .avatar-upload-overlay:hover { opacity: 1; }
    .avatar-upload-overlay__icon {
      font-size: 1.3rem;
      line-height: 1;
    }
    .avatar-upload-overlay__label {
      font-family: 'Jost', sans-serif;
      font-size: 0.6rem;
      color: #fff;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      font-weight: 500;
    }

    /* ── Upload progress ring ──────────────────────────────── */
    .avatar-progress-ring {
      position: absolute;
      inset: -4px;
      border-radius: 50%;
      border: 3px solid transparent;
      border-top-color: var(--accent, #c8a96e);
      animation: avatar-spin 0.9s linear infinite;
      pointer-events: none;
      z-index: 6;
    }
    @keyframes avatar-spin { to { transform: rotate(360deg); } }

    /* ── Upload modal ──────────────────────────────────────── */
    .avatar-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.7);
      z-index: 9000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      animation: av-fade-in 0.18s ease;
    }
    @keyframes av-fade-in { from { opacity:0 } to { opacity:1 } }

    .avatar-modal-panel {
      background: var(--bg, #f9f6f1);
      border-radius: 20px;
      width: min(420px, 100%);
      padding: 2rem;
      position: relative;
      animation: av-slide-up 0.22s cubic-bezier(0.34,1.4,0.64,1);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.25rem;
      box-shadow: 0 24px 80px rgba(0,0,0,0.3);
    }
    @keyframes av-slide-up {
      from { transform: translateY(20px); opacity:0 }
      to   { transform: translateY(0);    opacity:1 }
    }

    .avatar-modal__close {
      position: absolute;
      top: 0.9rem; right: 0.9rem;
      width: 30px; height: 30px;
      border-radius: 50%;
      border: 1px solid var(--border, rgba(0,0,0,0.1));
      background: transparent;
      color: var(--text-muted, #7a736b);
      cursor: pointer;
      font-size: 0.9rem;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.2s ease;
    }
    .avatar-modal__close:hover { background: #e74c3c; color:#fff; border-color:#e74c3c; }

    .avatar-modal__title {
      font-family: 'Cormorant Garamond', serif;
      font-size: 1.4rem;
      font-weight: 600;
      color: var(--text, #1a1613);
      text-align: center;
    }

    /* Preview */
    .avatar-preview-wrap {
      position: relative;
      width: 110px; height: 110px;
    }
    .avatar-preview {
      width: 110px; height: 110px;
      border-radius: 50%;
      object-fit: cover;
      border: 3px solid var(--accent, #c8a96e);
      display: block;
    }
    .avatar-preview-initials {
      width: 110px; height: 110px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--accent,#c8a96e), #8b5e3c);
      display: flex; align-items: center; justify-content: center;
      font-family: 'Cormorant Garamond', serif;
      font-size: 2.8rem;
      font-weight: 600;
      color: #fff;
      border: 3px solid var(--accent, #c8a96e);
    }

    /* Drop zone */
    .avatar-dropzone {
      width: 100%;
      border: 2px dashed var(--border, rgba(0,0,0,0.12));
      border-radius: 12px;
      padding: 1.2rem 1rem;
      text-align: center;
      cursor: pointer;
      transition: all 0.2s ease;
      color: var(--text-muted, #7a736b);
    }
    .avatar-dropzone:hover,
    .avatar-dropzone.drag-over {
      border-color: var(--accent, #c8a96e);
      background: rgba(200,169,110,0.05);
      color: var(--accent, #c8a96e);
    }
    .avatar-dropzone__icon { font-size: 1.6rem; display:block; margin-bottom: 0.3rem; }
    .avatar-dropzone__text { font-size: 0.82rem; line-height: 1.5; }
    .avatar-dropzone__hint { font-size: 0.7rem; margin-top: 0.2rem; opacity:0.7; }

    /* Progress bar */
    .avatar-progress-bar-wrap {
      width: 100%;
      height: 4px;
      background: var(--border, rgba(0,0,0,0.08));
      border-radius: 2px;
      overflow: hidden;
    }
    .avatar-progress-bar {
      height: 100%;
      background: var(--accent, #c8a96e);
      border-radius: 2px;
      width: 0%;
      transition: width 0.15s ease;
    }

    /* Buttons */
    .avatar-btn-row {
      display: flex; gap: 0.75rem; width: 100%;
    }
    .avatar-save-btn {
      flex: 1;
      padding: 0.6rem 1rem;
      border-radius: 50px;
      background: var(--accent, #c8a96e);
      color: #fff;
      border: none;
      font-family: 'Jost', sans-serif;
      font-size: 0.88rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .avatar-save-btn:hover:not(:disabled) {
      background: var(--accent-2, #8b5e3c);
      transform: translateY(-1px);
    }
    .avatar-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .avatar-remove-btn {
      padding: 0.6rem 1rem;
      border-radius: 50px;
      background: transparent;
      color: #e74c3c;
      border: 1.5px solid #e74c3c33;
      font-family: 'Jost', sans-serif;
      font-size: 0.85rem;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .avatar-remove-btn:hover {
      background: #e74c3c11;
      border-color: #e74c3c;
    }

    .avatar-status {
      font-size: 0.8rem;
      color: var(--text-muted, #7a736b);
      text-align: center;
      min-height: 1.2em;
    }
    .avatar-status.error { color: #e74c3c; }
    .avatar-status.success { color: #27ae60; }
  `;
  document.head.appendChild(s);
})();

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: get cached photo URL for a uid
════════════════════════════════════════════════════════════════ */
export async function getUserAvatar(uid) {
  if (_photoCache.has(uid)) return _photoCache.get(uid);
  try {
    const snap = await getDoc(doc(db, "users", uid));
    const url  = snap.exists() ? (snap.data().photoURL || null) : null;
    _photoCache.set(uid, url);
    return url;
  } catch { return null; }
}

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: open the avatar upload modal
   Called from profile.html when user taps their avatar
════════════════════════════════════════════════════════════════ */
export function openAvatarUpload(onSuccess) {
  if (!currentUser) return;
  _showUploadModal(onSuccess);
}

/* ═══════════════════════════════════════════════════════════════
   UPLOAD MODAL
════════════════════════════════════════════════════════════════ */
function _showUploadModal(onSuccess) {
  document.getElementById("avatarModal")?.remove();

  const current    = currentProfile?.photoURL || null;
  const initials   = (currentProfile?.name || "?")[0].toUpperCase();
  let   _staged    = null; // staged File object
  let   _stagedURL = null; // object URL for preview

  const overlay = document.createElement("div");
  overlay.id        = "avatarModal";
  overlay.className = "avatar-modal-overlay";

  overlay.innerHTML = `
    <div class="avatar-modal-panel">
      <button class="avatar-modal__close" id="avModalClose">✕</button>
      <h2 class="avatar-modal__title">Update Profile Photo</h2>

      <div class="avatar-preview-wrap" id="avPreviewWrap">
        ${current
          ? `<img class="avatar-preview" id="avPreview" src="${_esc(current)}" alt="Avatar" />`
          : `<div class="avatar-preview-initials" id="avPreviewInitials">${initials}</div>`
        }
      </div>

      <div class="avatar-dropzone" id="avDropzone">
        <input type="file" id="avFileInput" accept="image/*" hidden />
        <span class="avatar-dropzone__icon">📷</span>
        <span class="avatar-dropzone__text">
          Click to choose a photo<br/>or drag & drop here
        </span>
        <span class="avatar-dropzone__hint">JPG, PNG, GIF, WebP · Max 5 MB</span>
      </div>

      <div class="avatar-progress-bar-wrap" id="avProgressWrap" hidden>
        <div class="avatar-progress-bar" id="avProgressBar"></div>
      </div>

      <p class="avatar-status" id="avStatus"></p>

      <div class="avatar-btn-row">
        <button class="avatar-save-btn" id="avSaveBtn" disabled>
          Save Photo
        </button>
        ${current
          ? `<button class="avatar-remove-btn" id="avRemoveBtn">Remove</button>`
          : ""
        }
      </div>
    </div>`;

  document.body.appendChild(overlay);

  /* DOM refs */
  const closeBtn    = overlay.querySelector("#avModalClose");
  const dropzone    = overlay.querySelector("#avDropzone");
  const fileInput   = overlay.querySelector("#avFileInput");
  const saveBtn     = overlay.querySelector("#avSaveBtn");
  const removeBtn   = overlay.querySelector("#avRemoveBtn");
  const statusEl    = overlay.querySelector("#avStatus");
  const progressWrap= overlay.querySelector("#avProgressWrap");
  const progressBar = overlay.querySelector("#avProgressBar");
  const previewWrap = overlay.querySelector("#avPreviewWrap");

  /* Close handlers */
  closeBtn.addEventListener("click", _close);
  overlay.addEventListener("click", e => { if (e.target === overlay) _close(); });
  function _close() {
    if (_stagedURL) URL.revokeObjectURL(_stagedURL);
    overlay.remove();
  }

  /* Dropzone click */
  dropzone.addEventListener("click", () => fileInput.click());

  /* Drag & drop */
  dropzone.addEventListener("dragover", e => {
    e.preventDefault();
    dropzone.classList.add("drag-over");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
  dropzone.addEventListener("drop", e => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
    const file = e.dataTransfer.files?.[0];
    if (file) _stageFile(file);
  });

  /* File input change */
  fileInput.addEventListener("change", e => {
    const file = e.target.files?.[0];
    if (file) _stageFile(file);
    fileInput.value = "";
  });

  function _stageFile(file) {
    if (!file.type.startsWith("image/")) {
      return _setStatus("Only image files are allowed.", "error");
    }
    if (file.size > MAX_SIZE) {
      return _setStatus("Image must be under 5 MB.", "error");
    }
    _staged = file;
    if (_stagedURL) URL.revokeObjectURL(_stagedURL);
    _stagedURL = URL.createObjectURL(file);

    /* Update preview */
    previewWrap.innerHTML = `
      <img class="avatar-preview" src="${_stagedURL}" alt="Preview" />`;

    saveBtn.disabled = false;
    _setStatus(`Ready to save: ${file.name}`, "");
  }

  /* Save */
  saveBtn.addEventListener("click", async () => {
    if (!_staged) return;
    saveBtn.disabled = true;
    progressWrap.hidden = false;
    _setStatus("Uploading…", "");

    try {
      const url = await _uploadToCloudinary(_staged, pct => {
        progressBar.style.width = pct + "%";
      });
      await _savePhotoURL(url);
      progressWrap.hidden = true;
      _setStatus("Profile photo updated! ✓", "success");
      onSuccess?.(url);
      setTimeout(_close, 1200);
    } catch (err) {
      progressWrap.hidden = true;
      saveBtn.disabled = false;
      _setStatus(err.message || "Upload failed. Try again.", "error");
    }
  });

  /* Remove */
  removeBtn?.addEventListener("click", async () => {
    if (!confirm("Remove your profile photo?")) return;
    removeBtn.disabled = true;
    try {
      await _savePhotoURL(null);
      onSuccess?.(null);
      _close();
    } catch {
      removeBtn.disabled = false;
      _setStatus("Failed to remove photo.", "error");
    }
  });

  function _setStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className   = `avatar-status${type ? " " + type : ""}`;
  }
}

/* ═══════════════════════════════════════════════════════════════
   CLOUDINARY UPLOAD
════════════════════════════════════════════════════════════════ */
async function _uploadToCloudinary(file, onProgress) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", UPLOAD_PRESET);
  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100));
    };
    xhr.onload = () => {
      if (xhr.status === 200) {
        const d = JSON.parse(xhr.responseText);
        if (d.secure_url) resolve(d.secure_url);
        else reject(new Error("No URL returned from Cloudinary."));
      } else {
        reject(new Error("Upload failed (status " + xhr.status + ")."));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.send(fd);
  });
}

/* ═══════════════════════════════════════════════════════════════
   SAVE photoURL TO FIRESTORE + UPDATE LOCAL CACHE
════════════════════════════════════════════════════════════════ */
async function _savePhotoURL(url) {
  if (!currentUser) throw new Error("Not logged in.");
  await updateDoc(doc(db, "users", currentUser.uid), {
    photoURL: url || null
  });
  /* Update cache */
  _photoCache.set(currentUser.uid, url || null);
  /* Update currentProfile reference in memory */
  if (currentProfile) currentProfile.photoURL = url || null;
  /* Update nav avatar immediately */
  _refreshNavAvatar(url);
}

/* ═══════════════════════════════════════════════════════════════
   NAV AVATAR  — shows photo (or initials) next to user label
════════════════════════════════════════════════════════════════ */
function _injectNavAvatar(photoURL, name) {
  const label = document.getElementById("navUserLabel");
  if (!label) return;

  /* Remove old avatar if present */
  label.querySelector(".nav__avatar")?.remove();
  label.querySelector(".nav__avatar-initials")?.remove();

  const initials = (name || "?")[0].toUpperCase();

  if (photoURL) {
    const img = document.createElement("img");
    img.className = "nav__avatar";
    img.src       = photoURL;
    img.alt       = name || "Avatar";
    img.onerror   = () => img.replaceWith(_makeInitialsCircle(initials));
    label.prepend(img);
  } else {
    label.prepend(_makeInitialsCircle(initials));
  }
}

function _makeInitialsCircle(initial) {
  const span = document.createElement("span");
  span.className = "nav__avatar-initials";
  span.style.cssText = `
    width:28px;height:28px;border-radius:50%;
    background:linear-gradient(135deg,var(--accent,#c8a96e),#8b5e3c);
    display:inline-flex;align-items:center;justify-content:center;
    font-family:'Cormorant Garamond',serif;font-size:0.85rem;
    font-weight:600;color:#fff;margin-right:0.4rem;flex-shrink:0;
    border:2px solid var(--accent,#c8a96e);vertical-align:middle;
  `;
  span.textContent = initial;
  return span;
}

function _refreshNavAvatar(photoURL) {
  const name = currentProfile?.name || "";
  _injectNavAvatar(photoURL, name);
}

/* ═══════════════════════════════════════════════════════════════
   UPGRADE POST CARD AVATARS — inject real photos into initials divs
   Uses MutationObserver (same pattern as follow.js / reactions.js)
════════════════════════════════════════════════════════════════ */
async function _upgradePostAvatar(card) {
  if (card.dataset.avatarUpgraded) return;
  card.dataset.avatarUpgraded = "1";

  const avatarDiv = card.querySelector(".post-card__avatar");
  if (!avatarDiv) return;

  const postId = card.dataset.postId;
  if (!postId) return;

  try {
    const snap = await getDoc(doc(db, "posts", postId));
    if (!snap.exists()) return;
    const { authorId, authorName } = snap.data();
    if (!authorId) return;

    const photoURL = await getUserAvatar(authorId);
    if (!photoURL) return;

    /* Replace text content with img */
    const img = document.createElement("img");
    img.src   = photoURL;
    img.alt   = authorName || "";
    img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;";
    img.onerror = () => img.remove(); // graceful fallback to initials
    avatarDiv.innerHTML = "";
    avatarDiv.appendChild(img);
  } catch { /* silent */ }
}

/* ═══════════════════════════════════════════════════════════════
   UPGRADE CHAT BUBBLE AVATARS
   chat.js doesn't render img avatars — it uses author initials
   in the author label. We can add a small avatar circle next to
   the author name for "theirs" bubbles.
════════════════════════════════════════════════════════════════ */
async function _upgradeChatAvatar(wrap) {
  if (wrap.dataset.avatarUpgraded) return;
  if (!wrap.classList.contains("theirs")) return;
  wrap.dataset.avatarUpgraded = "1";

  const authorEl = wrap.querySelector(".chat-bubble__author");
  if (!authorEl) return;

  /* Get author name text */
  const nameNode = authorEl.childNodes[0];
  const name     = nameNode?.textContent?.trim();
  if (!name) return;

  /* Look up UID + photo */
  try {
    const { getDocs, collection, query, where } =
      await import("https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js");
    const snap = await getDocs(query(collection(db, "users"), where("name", "==", name)));
    if (snap.empty) return;
    const uid = snap.docs[0].id;
    const photoURL = await getUserAvatar(uid);
    if (!photoURL) return;

    /* Inject tiny avatar circle before the author label */
    const bubble = wrap.querySelector(".chat-bubble");
    if (!bubble) return;

    const img = document.createElement("img");
    img.src       = photoURL;
    img.alt       = name;
    img.className = "chat-bubble__mini-avatar";
    img.style.cssText = `
      width:22px;height:22px;border-radius:50%;
      object-fit:cover;flex-shrink:0;
      border:1.5px solid var(--accent,#c8a96e);
      vertical-align:middle;margin-right:0.35rem;
    `;
    img.onerror = () => img.remove();

    /* Prepend to bubble */
    bubble.insertBefore(img, bubble.firstChild);
  } catch { /* silent */ }
}

/* ═══════════════════════════════════════════════════════════════
   MUTATION OBSERVER
════════════════════════════════════════════════════════════════ */
function _startObserver() {
  const observer = new MutationObserver(muts => {
    for (const mut of muts) {
      for (const node of mut.addedNodes) {
        if (!(node instanceof Element)) continue;

        if (node.matches?.("article.post-card"))
          _upgradePostAvatar(node);
        node.querySelectorAll?.("article.post-card")
          .forEach(_upgradePostAvatar);

        if (node.matches?.(".chat-bubble-wrap"))
          _upgradeChatAvatar(node);
        node.querySelectorAll?.(".chat-bubble-wrap")
          .forEach(_upgradeChatAvatar);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/* ═══════════════════════════════════════════════════════════════
   LIVE LISTENER — watch current user's own profile doc
   So if they update their photo in another tab it reflects here
════════════════════════════════════════════════════════════════ */
function _listenOwnProfile(uid) {
  const ref = doc(db, "users", uid);
  onSnapshot(ref, snap => {
    if (!snap.exists()) return;
    const data = snap.data();
    const url  = data.photoURL || null;
    _photoCache.set(uid, url);
    if (currentProfile) currentProfile.photoURL = url;
    _refreshNavAvatar(url);
  }, () => {});
}

/* ═══════════════════════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════════════════════ */
onAuthChange((user, profile) => {
  if (user && profile?.profileComplete && !profile.banned) {
    /* Set up nav avatar */
    _injectNavAvatar(profile.photoURL || null, profile.name);

    /* Live-listen to own profile doc */
    _listenOwnProfile(user.uid);

    /* Start DOM observer for post cards + chat bubbles */
    _startObserver();

    /* Process already-rendered nodes */
    document.querySelectorAll("article.post-card").forEach(_upgradePostAvatar);
    document.querySelectorAll(".chat-bubble-wrap").forEach(_upgradeChatAvatar);
  } else {
    /* Clear nav avatar on logout */
    const label = document.getElementById("navUserLabel");
    label?.querySelector(".nav__avatar")?.remove();
    label?.querySelector(".nav__avatar-initials")?.remove();
  }
});

/* ═══════════════════════════════════════════════════════════════
   HELPER
════════════════════════════════════════════════════════════════ */
function _esc(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
