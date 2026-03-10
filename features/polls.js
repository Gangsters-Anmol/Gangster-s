/**
 * features/polls.js — Polls & Voting System
 * Works in both Community Posts and World Chat
 */

import { db } from '../firebase-config.js';
import { onAuthChange, currentUser, currentProfile, showToast } from '../auth.js';
import {
  collection, addDoc, doc, updateDoc, getDoc, onSnapshot,
  arrayUnion, serverTimestamp, query, orderBy
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';

/* ══ INJECT POLL BUTTONS ════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  _injectPollUI();
  // Also inject when posts UI becomes visible (auth change)
  onAuthChange(() => {
    setTimeout(_injectPollUI, 300);
  });
});

function _injectPollUI() {
  // Inject "Add Poll" button in post composer
  const postMediaRow = document.getElementById('postMediaRow');
  if (postMediaRow && !document.getElementById('postAddPollBtn')) {
    const btn = document.createElement('button');
    btn.id = 'postAddPollBtn';
    btn.className = 'add-poll-btn';
    btn.type = 'button';
    btn.innerHTML = '📊 Add Poll';
    postMediaRow.appendChild(btn);

    const composer = document.createElement('div');
    composer.id = 'postPollComposer';
    composer.className = 'poll-composer';
    postMediaRow.closest('.create-post-panel')?.appendChild(composer);
    _buildPollComposer(composer, 'post');

    btn.addEventListener('click', () => {
      composer.classList.toggle('open');
      btn.textContent = composer.classList.contains('open') ? '❌ Remove Poll' : '📊 Add Poll';
    });
  }

  // Inject "Poll" button in group chat
  const groupBar = document.querySelector('#msgGroupPanel .chat-input-bar')
               || document.querySelector('#groupChatPanel .chat-input-bar');
  if (groupBar && !document.getElementById('chatAddPollBtn')) {
    const btn = document.createElement('button');
    btn.id = 'chatAddPollBtn';
    btn.className = 'add-poll-btn';
    btn.type = 'button';
    btn.title = 'Create Poll';
    btn.innerHTML = '📊';
    btn.style.cssText = 'padding:.3rem .5rem;font-size:1rem;border-radius:8px;';
    groupBar.insertBefore(btn, groupBar.querySelector('.chat-send-btn'));

    btn.addEventListener('click', () => _openChatPollModal());
  }
}

/* ══ POST POLL COMPOSER ══════════════════════════════════════ */
function _buildPollComposer(container, context) {
  container.innerHTML = `
    <div class="poll-composer__label">📊 Create a Poll</div>
    <input type="text" class="poll-q-input" placeholder="Ask a question…" maxlength="200">
    <div class="poll-options-list" id="${context}PollOptions">
      <div class="poll-option-row">
        <input type="text" placeholder="Option 1" maxlength="100" class="poll-opt-input">
        <button class="poll-option-remove" type="button">✕</button>
      </div>
      <div class="poll-option-row">
        <input type="text" placeholder="Option 2" maxlength="100" class="poll-opt-input">
        <button class="poll-option-remove" type="button">✕</button>
      </div>
    </div>
    <button class="poll-add-option-btn" type="button" id="${context}AddPollOption">+ Add option</button>
    <div class="poll-duration-row">
      <label>Duration:</label>
      <select class="poll-duration-select" id="${context}PollDuration">
        <option value="0">No limit</option>
        <option value="1">1 day</option>
        <option value="3">3 days</option>
        <option value="7">7 days</option>
      </select>
    </div>
    <div class="poll-composer__actions">
      <button class="btn-poll-submit" type="button" id="${context}PollSubmit">Create Poll</button>
      <button class="btn-poll-cancel" type="button" id="${context}PollCancel">Cancel</button>
    </div>`;

  // Add/remove options
  const optList = container.querySelector('.poll-options-list');
  container.querySelector(`#${context}AddPollOption`).addEventListener('click', () => {
    if (optList.children.length >= 6) { showToast('Max 6 options'); return; }
    const row = document.createElement('div');
    row.className = 'poll-option-row';
    const idx = optList.children.length + 1;
    row.innerHTML = `
      <input type="text" placeholder="Option ${idx}" maxlength="100" class="poll-opt-input">
      <button class="poll-option-remove" type="button">✕</button>`;
    optList.appendChild(row);
    _bindRemoveOption(row.querySelector('.poll-option-remove'), optList);
  });

  optList.querySelectorAll('.poll-option-remove').forEach(btn => _bindRemoveOption(btn, optList));

  container.querySelector(`#${context}PollCancel`).addEventListener('click', () => {
    container.classList.remove('open');
    if (context === 'post') {
      const addBtn = document.getElementById('postAddPollBtn');
      if (addBtn) addBtn.textContent = '📊 Add Poll';
    }
    container.querySelector('.poll-q-input').value = '';
    optList.querySelectorAll('.poll-opt-input').forEach(i => i.value = '');
  });

  if (context === 'post') {
    container.querySelector(`#${context}PollSubmit`).addEventListener('click', () => {
      const pollData = _getPollData(container);
      if (!pollData) return;
      // Store poll data to be included in post
      window._pendingPoll = pollData;
      showToast('Poll added to post ✓');
      container.classList.remove('open');
      document.getElementById('postAddPollBtn').textContent = '✓ Poll Added';
    });
  }
}

function _bindRemoveOption(btn, optList) {
  btn.addEventListener('click', () => {
    if (optList.children.length <= 2) { showToast('Minimum 2 options'); return; }
    btn.closest('.poll-option-row').remove();
  });
}

function _getPollData(container) {
  const question = container.querySelector('.poll-q-input')?.value.trim();
  if (!question) { showToast('Please enter a question'); return null; }

  const opts = [...container.querySelectorAll('.poll-opt-input')]
    .map(i => i.value.trim())
    .filter(Boolean);

  if (opts.length < 2) { showToast('Please enter at least 2 options'); return null; }

  const durDays = parseInt(container.querySelector('.poll-duration-select')?.value || '0');
  const expiresAt = durDays > 0
    ? new Date(Date.now() + durDays * 86400000)
    : null;

  return {
    question,
    options: opts.map(text => ({ text, votes: [] })),
    expiresAt,
    totalVotes: 0,
  };
}

/* ══ CHAT POLL MODAL ═════════════════════════════════════════ */
function _openChatPollModal() {
  if (!currentUser) { showToast('Login to create polls'); return; }

  const modal = document.createElement('div');
  modal.className = 'edit-bio-modal';
  modal.id = 'chatPollModal';
  modal.innerHTML = `
    <div class="edit-bio-modal__panel">
      <h3 class="edit-bio-modal__title">📊 Create Poll</h3>
      <div id="chatPollComposerInner"></div>
    </div>`;

  document.body.appendChild(modal);
  const inner = document.getElementById('chatPollComposerInner');
  inner.innerHTML = `
    <div class="poll-options-list" id="chatModalPollOptions">
      <input type="text" id="chatModalPollQ" placeholder="Ask a question…" maxlength="200"
             style="width:100%;padding:.6rem .8rem;background:var(--clr-input-bg);border:1px solid var(--clr-border);border-radius:8px;color:var(--clr-text);font-family:var(--font-body);font-size:.86rem;margin-bottom:.5rem;outline:none;">
      <div class="poll-option-row">
        <input type="text" placeholder="Option 1" maxlength="100" class="poll-opt-input">
        <button class="poll-option-remove" type="button">✕</button>
      </div>
      <div class="poll-option-row">
        <input type="text" placeholder="Option 2" maxlength="100" class="poll-opt-input">
        <button class="poll-option-remove" type="button">✕</button>
      </div>
    </div>
    <button class="poll-add-option-btn" type="button" id="chatModalAddOpt">+ Add option</button>
    <div class="poll-duration-row">
      <label>Duration:</label>
      <select class="poll-duration-select" id="chatModalDuration">
        <option value="0">No limit</option>
        <option value="1">1 day</option>
        <option value="3">3 days</option>
        <option value="7">7 days</option>
      </select>
    </div>
    <div class="edit-bio-modal__actions" style="margin-top:.75rem;">
      <button class="btn-save-bio" id="chatModalSubmitPoll">Post Poll</button>
      <button class="btn-cancel-bio" id="chatModalCancelPoll">Cancel</button>
    </div>`;

  const optList = document.getElementById('chatModalPollOptions');
  document.getElementById('chatModalAddOpt').addEventListener('click', () => {
    if (optList.querySelectorAll('.poll-opt-input').length >= 6) { showToast('Max 6 options'); return; }
    const row = document.createElement('div');
    row.className = 'poll-option-row';
    const idx = optList.querySelectorAll('.poll-opt-input').length + 1;
    row.innerHTML = `<input type="text" placeholder="Option ${idx}" maxlength="100" class="poll-opt-input">
      <button class="poll-option-remove" type="button">✕</button>`;
    optList.appendChild(row);
    row.querySelector('.poll-option-remove').addEventListener('click', () => {
      if (optList.querySelectorAll('.poll-opt-input').length > 2) row.remove();
      else showToast('Min 2 options');
    });
  });

  optList.querySelectorAll('.poll-option-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      if (optList.querySelectorAll('.poll-opt-input').length > 2) btn.closest('.poll-option-row').remove();
      else showToast('Min 2 options');
    });
  });

  document.getElementById('chatModalCancelPoll').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  document.getElementById('chatModalSubmitPoll').addEventListener('click', async () => {
    const question = document.getElementById('chatModalPollQ')?.value.trim();
    if (!question) { showToast('Enter a question'); return; }
    const opts = [...optList.querySelectorAll('.poll-opt-input')]
      .map(i => i.value.trim()).filter(Boolean);
    if (opts.length < 2) { showToast('Need at least 2 options'); return; }
    const durDays = parseInt(document.getElementById('chatModalDuration')?.value || '0');
    const expiresAt = durDays > 0 ? new Date(Date.now() + durDays * 86400000) : null;

    try {
      await addDoc(collection(db, 'groupMessages'), {
        type: 'poll',
        poll: {
          question,
          options: opts.map(text => ({ text, votes: [] })),
          expiresAt,
          totalVotes: 0,
        },
        authorId: currentUser.uid,
        authorName: currentProfile?.displayName || currentUser.email,
        authorAvatar: currentProfile?.photoURL || null,
        createdAt: serverTimestamp(),
      });
      showToast('Poll posted! 📊');
      modal.remove();
    } catch(e) {
      showToast('Error posting poll');
    }
  });
}

/* ══ RENDER POLL WIDGET ══════════════════════════════════════ */
export function renderPollWidget(pollData, docId, collection_name) {
  if (!pollData) return '';
  const uid = currentUser?.uid;
  const total = pollData.totalVotes || 0;
  const expired = pollData.expiresAt && new Date(pollData.expiresAt.toDate?.() || pollData.expiresAt) < new Date();
  const userVoted = pollData.options?.some(o => o.votes?.includes(uid));

  const opts = (pollData.options || []).map((o, i) => {
    const votes = o.votes?.length || 0;
    const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
    const isMyVote = o.votes?.includes(uid);
    return `
      <div class="poll-option ${userVoted || expired ? 'voted' : ''} ${isMyVote ? 'my-vote' : ''}"
           data-idx="${i}" data-doc="${docId}" data-col="${collection_name}"
           ${!userVoted && !expired ? 'onclick="window.castPollVote(this)"' : ''}>
        <div class="poll-option__bar" style="width:${userVoted || expired ? pct : 0}%"></div>
        <div class="poll-option__content">
          <span>${o.text}${isMyVote ? ' ✓' : ''}</span>
          ${userVoted || expired ? `<span class="poll-option__pct">${pct}%</span>` : ''}
        </div>
      </div>`;
  }).join('');

  return `
    <div class="poll-widget" id="poll-${docId}">
      <div class="poll-widget__question">${pollData.question}</div>
      ${opts}
      <div class="poll-widget__meta">
        ${total} vote${total !== 1 ? 's' : ''}
        ${expired ? '<span class="poll-expired-badge">ENDED</span>' : ''}
        ${pollData.expiresAt && !expired ? `· Ends ${_formatDate(pollData.expiresAt)}` : ''}
      </div>
    </div>`;
}

/* ══ VOTE HANDLER (global) ═══════════════════════════════════ */
window.castPollVote = async (el) => {
  if (!currentUser) { showToast('Login to vote'); return; }
  const optIdx  = parseInt(el.dataset.idx);
  const docId   = el.dataset.doc;
  const colName = el.dataset.col;

  try {
    const docRef = doc(db, colName, docId);
    const snap = await getDoc(docRef);
    const data  = snap.data();
    const poll  = data?.poll || data?.pollData;
    if (!poll) return;

    // Check already voted
    const alreadyVoted = poll.options?.some(o => o.votes?.includes(currentUser.uid));
    if (alreadyVoted) { showToast('Already voted!'); return; }

    // Check expired
    if (poll.expiresAt) {
      const exp = poll.expiresAt.toDate?.() || new Date(poll.expiresAt);
      if (exp < new Date()) { showToast('This poll has ended'); return; }
    }

    // Update vote
    const updatedOptions = poll.options.map((o, i) => ({
      ...o,
      votes: i === optIdx ? [...(o.votes || []), currentUser.uid] : (o.votes || []),
    }));

    const field = data.poll ? 'poll' : 'pollData';
    await updateDoc(docRef, {
      [`${field}.options`]: updatedOptions,
      [`${field}.totalVotes`]: (poll.totalVotes || 0) + 1,
    });
    showToast('Vote cast! 📊');
  } catch(e) {
    showToast('Error voting');
  }
};

/* ══ HELPERS ═════════════════════════════════════════════════ */
function _formatDate(ts) {
  try {
    const d = ts.toDate?.() || new Date(ts);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  } catch(e) { return ''; }
}
