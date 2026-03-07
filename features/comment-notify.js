/**
 * features/comment-notify.js
 * ─────────────────────────────────────────────────────────────────
 * PURELY ADDITIVE — does not modify any existing file.
 *
 * What this file does:
 *  Watches for comment submit buttons rendered by posts.js and
 *  feed.js. After a comment is submitted, sends a "comment"
 *  notification to the post author via sendNotification().
 *
 *  Never notifies the user if they comment on their own post.
 * ─────────────────────────────────────────────────────────────────
 */

import {
  doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

import { db }                                        from "../firebase-config.js";
import { onAuthChange, currentUser, currentProfile } from "../auth.js";
import { sendNotification }                          from "./notifications.js";

/* ═══════════════════════════════════════════════════════════════
   INTERCEPT A SINGLE SUBMIT BUTTON
   Posts.js / feed.js render buttons with class:
     .comment-submit  (posts.js)
     .js-ffcsend      (feed.js following feed)
   Both carry  data-id = postId  on the button element.
════════════════════════════════════════════════════════════════ */
function _bindButton(btn) {
  if (btn.dataset.cnBound) return;
  btn.dataset.cnBound = "1";

  btn.addEventListener("click", async () => {
    /* Resolve the post ID — posts.js uses data-id on the button */
    const postId = btn.dataset.id;
    if (!postId) return;

    /* Get the comment text — sibling input within the same form wrap */
    const form    = btn.closest(".comment-form");
    const input   = form?.querySelector("input, textarea");
    const text    = input?.value?.trim();
    if (!text) return; /* empty comment — posts.js will reject it anyway */

    /* Look up post author */
    try {
      const snap = await getDoc(doc(db, "posts", postId));
      if (!snap.exists()) return;

      const authorId = snap.data().authorId;
      if (!authorId)                           return;
      if (authorId === currentUser?.uid)       return; /* own post */

      sendNotification(authorId, {
        type:     "comment",
        fromUid:  currentUser.uid,
        fromName: currentProfile?.name || "Someone",
        postId,
      });
    } catch { /* silent — notification is best-effort */ }
  });
}

/* ═══════════════════════════════════════════════════════════════
   MUTATION OBSERVER
   Watches for comment submit buttons added by posts.js and feed.js
════════════════════════════════════════════════════════════════ */
function _startObserver() {
  const observer = new MutationObserver(muts => {
    for (const mut of muts) {
      for (const node of mut.addedNodes) {
        if (!(node instanceof Element)) continue;

        /* posts.js submit button */
        if (node.matches?.(".comment-submit"))
          _bindButton(node);
        node.querySelectorAll?.(".comment-submit")
          .forEach(_bindButton);

        /* feed.js following-feed submit button */
        if (node.matches?.(".js-ffcsend"))
          _bindButton(node);
        node.querySelectorAll?.(".js-ffcsend")
          .forEach(_bindButton);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/* ═══════════════════════════════════════════════════════════════
   PROCESS ALREADY-RENDERED BUTTONS (e.g. if comments opened
   before this module loaded)
════════════════════════════════════════════════════════════════ */
function _processExisting() {
  document.querySelectorAll(".comment-submit, .js-ffcsend")
    .forEach(_bindButton);
}

/* ═══════════════════════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════════════════════ */
onAuthChange((user, profile) => {
  if (user && profile?.profileComplete && !profile.banned) {
    _startObserver();
    _processExisting();
  }
});
