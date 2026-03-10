/**
 * features/notify-extend.js
 * ─────────────────────────────────────────────────────────────────
 * PURELY ADDITIVE — does NOT modify any existing file.
 *
 * Adds notification triggers for:
 *  1. Follow-back  — when the person you follow also follows you back
 *  2. Comment reply — when someone replies to a comment you made
 *  3. Profile visit  — when someone views your profile (optional)
 *  4. Group chat reply — notifies recent participants when a new
 *     message arrives in a group chat thread they've been active in
 * ─────────────────────────────────────────────────────────────────
 */

import {
  collection, query, where, getDocs, doc, getDoc,
  onSnapshot, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

import { db }                                        from "../firebase-config.js";
import { onAuthChange, currentUser, currentProfile } from "../auth.js";
import { sendNotification }                          from "./notifications.js";

/* ═══════════════════════════════════════════════════════════════
   1. FOLLOW-BACK DETECTION
   When user A follows user B, if user B is already following A,
   user A gets a "follow_back" notification.
   We watch the follows collection for new docs where followingId
   === currentUser.uid. When one appears, check if we also follow
   that person back — if yes, notify them.
════════════════════════════════════════════════════════════════ */
function _watchFollowBack() {
  if (!currentUser) return;
  const q = query(
    collection(db, "follows"),
    where("followingId", "==", currentUser.uid)
  );
  onSnapshot(q, snap => {
    snap.docChanges().forEach(async change => {
      if (change.type !== "added") return;
      const followerId = change.doc.data().followerId;
      if (!followerId || followerId === currentUser.uid) return;

      // Check if we also follow them back
      const reverseId = `${currentUser.uid}_${followerId}`;
      try {
        const rev = await getDoc(doc(db, "follows", reverseId));
        if (rev.exists()) {
          // We follow them AND they just followed us → follow-back
          sendNotification(followerId, {
            type:     "follow_back",
            fromUid:  currentUser.uid,
            fromName: currentProfile?.name || "Someone",
          });
        }
      } catch { /* silent */ }
    });
  }, () => {});
}

/* ═══════════════════════════════════════════════════════════════
   2. COMMENT REPLY DETECTION
   When a new comment arrives on a post, check if the commenter
   is replying to another commenter (i.e., previous commenters
   who are not the post author get notified).
   We watch for new comment documents across all posts the current
   user has commented on.
════════════════════════════════════════════════════════════════ */

/* Track posts the current user has commented on */
const _commentedPostIds = new Set();

function _watchCommentReplies() {
  if (!currentUser) return;

  // Find posts this user has commented on (last 20 to keep it light)
  const q = query(
    collection(db, "posts"),
    orderBy("timestamp", "desc"),
    limit(20)
  );

  onSnapshot(q, snap => {
    snap.docs.forEach(postDoc => {
      const postId = postDoc.id;
      if (_commentedPostIds.has(postId)) return; // already watching

      // Watch comments on this post
      const cq = query(
        collection(db, "posts", postId, "comments"),
        orderBy("timestamp", "asc")
      );
      onSnapshot(cq, cSnap => {
        // Check if current user has a comment here
        const myComments = cSnap.docs.filter(d => d.data().authorId === currentUser.uid);
        if (!myComments.length) return;

        _commentedPostIds.add(postId);

        // On each new comment, notify all prior commenters (except post author and self)
        cSnap.docChanges().forEach(change => {
          if (change.type !== "added") return;
          const newComment = change.doc.data();
          if (newComment.authorId === currentUser.uid) return; // it's us
          // Only notify if I have a comment earlier in this thread
          const myEarliestComment = myComments[0]?.data()?.timestamp;
          const newTime = newComment.timestamp;
          if (myEarliestComment && newTime && newTime > myEarliestComment) {
            sendNotification(currentUser.uid, {
              type:     "comment_reply",
              fromUid:  newComment.authorId,
              fromName: newComment.authorName || "Someone",
              postId,
              text:     (newComment.text || "").slice(0, 80),
            });
          }
        });
      }, () => {});
    });
  }, () => {});
}

/* ═══════════════════════════════════════════════════════════════
   3. PROFILE VISIT NOTIFICATION (optional)
   When someone visits profile.html?user=X, we write a
   "profile_visit" notification. This is done from profile.html
   which is a separate page — we attach a global listener here
   that profile.html can call via window._notifyProfileVisit.
════════════════════════════════════════════════════════════════ */
window._notifyProfileVisit = function(targetUid) {
  if (!currentUser || !targetUid) return;
  if (currentUser.uid === targetUid) return; // visiting own profile
  sendNotification(targetUid, {
    type:     "profile_visit",
    fromUid:  currentUser.uid,
    fromName: currentProfile?.name || "Someone",
  });
};

/* ═══════════════════════════════════════════════════════════════
   4. GROUP CHAT PARTICIPATION NOTIFICATION
   When a new message arrives in groupMessages, notify recent
   active participants (users who sent messages in the last 50).
   Fires once per new message for users who were recently active.
════════════════════════════════════════════════════════════════ */

/* Cache of recent group chat participant UIDs → last seen timestamp */
const _groupParticipants = new Map();

function _watchGroupChat() {
  if (!currentUser) return;

  const q = query(
    collection(db, "groupMessages"),
    orderBy("timestamp", "desc"),
    limit(50)
  );

  let _initialized = false;

  onSnapshot(q, snap => {
    // On first load, just populate the participants cache
    if (!_initialized) {
      snap.docs.forEach(d => {
        const uid = d.data().uid;
        if (uid) _groupParticipants.set(uid, d.data().timestamp);
      });
      _initialized = true;
      return;
    }

    // For each new message, notify recent participants (not the sender)
    snap.docChanges().forEach(change => {
      if (change.type !== "added") return;
      const newMsg = change.doc.data();
      const senderUid = newMsg.uid;
      if (!senderUid) return;

      // Update participant cache
      _groupParticipants.set(senderUid, newMsg.timestamp);

      // Only notify if I'm a recent participant and this isn't my message
      if (senderUid !== currentUser.uid && _groupParticipants.has(currentUser.uid)) {
        sendNotification(currentUser.uid, {
          type:     "group_chat_reply",
          fromUid:  senderUid,
          fromName: newMsg.name || "Someone",
          text:     (newMsg.text || "New poll 📊").slice(0, 60),
        });
      }
    });
  }, () => {});
}

/* ═══════════════════════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════════════════════ */
onAuthChange((user, profile) => {
  if (!user || !profile?.profileComplete || profile.banned) return;

  _watchFollowBack();
  _watchCommentReplies();
  _watchGroupChat();
});
