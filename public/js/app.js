/**
 * Modisha Community Messenger - Frontend Application Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  // Global State
  let currentUser = null;
  const socket = io();

  // DOM Reference Selector
  const loginModal = document.getElementById('loginModal');
  const loginForm = document.getElementById('loginForm');
  const roleInput = document.getElementById('roleInput');
  const passwordField = document.getElementById('passwordField');
  const passwordInput = document.getElementById('passwordInput');
  const messageForm = document.getElementById('messageForm');
  const messageInput = document.getElementById('messageInput');
  
  const messageFeed = document.getElementById('messageFeed');
  const pendingFeed = document.getElementById('pendingFeed');
  const adminPanel = document.getElementById('adminPanel');
  const adminQueueToggle = document.getElementById('adminQueueToggle');
  const closeAdminPanel = document.getElementById('closeAdminPanel');
  const pendingBadgeCount = document.getElementById('pendingBadgeCount');
  const logoutBtn = document.getElementById('logoutBtn');
  const mobileLogoutBtn = document.getElementById('mobileLogoutBtn');

  // Restore persisted login if present
  try {
    const stored = localStorage.getItem('modisha_user');
    if (stored) {
      currentUser = JSON.parse(stored);
      loginModal.classList.add('hidden');
      setupUserUI();
      loadApprovedMessages();
      if (currentUser.role === 'admin') {
        adminQueueToggle.classList.remove('hidden');
        loadPendingMessages();
      }
    }
  } catch (err) {
    console.error('Failed to restore stored user:', err);
    localStorage.removeItem('modisha_user');
  }

  // --------------------------------------------------------------------------
  // 1. Authentication & Session Handling
  // --------------------------------------------------------------------------

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fullname = document.getElementById('fullnameInput').value.trim();
    const residence = document.getElementById('residenceInput').value;
    const role = roleInput.value;
    const password = passwordInput.value;

    if (!fullname || !residence) {
      alert('Please enter your full name and select a residence.');
      return;
    }

    if (role === 'admin' && !password) {
      alert('Admin password is required.');
      return;
    }

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullname, residence, role, password })
      });

      const data = await res.json();
      if (res.ok && data.user) {
        currentUser = data.user;
        loginModal.classList.add('hidden');
        setupUserUI();
        // Persist login
        try { localStorage.setItem('modisha_user', JSON.stringify(currentUser)); } catch (e) { console.error('Persist failed', e); }
        loadApprovedMessages();

        if (currentUser.role === 'admin') {
          adminQueueToggle.classList.remove('hidden');
          loadPendingMessages();
        }
      } else {
        alert(data.error || 'Unable to sign in.');
      }
    } catch (err) {
      console.error('Login error:', err);
      alert('Unable to sign in. Please verify your backend server is active.');
    }
  });

  function setupUserUI() {
    document.getElementById('userNameDisplay').textContent = currentUser.fullname;
    document.getElementById('userResidenceDisplay').textContent = currentUser.residence || 'No residence set';
    document.getElementById('userAvatar').textContent = currentUser.fullname.charAt(0).toUpperCase();
    logoutBtn.classList.remove('hidden');
    // Join the socket.io room for the user's residence so events are scoped
    if (currentUser.residence) socket.emit('joinResidence', currentUser.residence);
    
    const badge = document.getElementById('userRoleBadge');
    badge.textContent = currentUser.role;
    if (currentUser.role === 'admin') {
      badge.className = 'inline-block px-2 py-0.5 text-[10px] font-bold rounded bg-amber-500/20 text-amber-400 uppercase tracking-wider border border-amber-500/30';
    }
  }

  // --------------------------------------------------------------------------
  // 2. Data Fetching (REST Endpoints)
  // --------------------------------------------------------------------------

  async function loadApprovedMessages() {
    try {
      let url = '/api/messages/approved';
      if (currentUser && currentUser.residence) {
        url += `?residence=${encodeURIComponent(currentUser.residence)}`;
      }
      const res = await fetch(url);
      const messages = await res.json();
      messageFeed.innerHTML = '';
      messages.forEach(appendApprovedMessage);
      scrollToBottom();
    } catch (err) {
      console.error('Failed to load community chat history:', err);
    }
  }

  async function loadPendingMessages() {
    try {
      let url = '/api/messages/pending';
      if (currentUser && currentUser.residence) {
        url += `?residence=${encodeURIComponent(currentUser.residence)}`;
      }
      const res = await fetch(url);
      const messages = await res.json();
      pendingFeed.innerHTML = '';
      messages.forEach(appendPendingMessage);
      updatePendingBadge();
    } catch (err) {
      console.error('Failed to load moderation queue:', err);
    }
  }

  // --------------------------------------------------------------------------
  // 3. Message Submission
  // --------------------------------------------------------------------------

  messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const content = messageInput.value.trim();
    if (!content) return;

    socket.emit('sendMessage', {
      userId: currentUser.id,
      content: content || ''
    });

    messageInput.value = '';
  });

  // image upload removed

  // --------------------------------------------------------------------------
  // 4. UI Rendering Functions
  // --------------------------------------------------------------------------

  function appendApprovedMessage(msg) {
    const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isAdminMsg = msg.role === 'admin';
    const canDelete = currentUser && currentUser.role === 'admin' && !isAdminMsg;
    const residenceLabel = msg.residence ? ` - ${escapeHtml(msg.residence)}` : '';
    const contentText = msg.content ? escapeHtml(msg.content).replace(/\n/g, '<br>') : '<span class="text-slate-400 italic">No text provided</span>';
    const likes = msg.likes || 0;
    const dislikes = msg.dislikes || 0;

    const div = document.createElement('div');
    div.id = `approved-message-${msg.id}`;
    div.className = 'flex gap-3 max-w-3xl chat-bubble';
    div.innerHTML = `
      <div class="w-10 h-10 rounded-xl ${isAdminMsg ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-slate-800 text-slate-300 border border-slate-700'} flex items-center justify-center font-bold text-sm flex-shrink-0">
        ${msg.fullname.charAt(0).toUpperCase()}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1">
          <span class="font-bold text-sm text-white truncate">${escapeHtml(msg.fullname)}${residenceLabel}</span>
          ${isAdminMsg ? '<span class="px-1.5 py-0.2 text-[9px] font-extrabold bg-amber-500 text-slate-950 rounded uppercase">Admin</span>' : ''}
          <span class="text-[11px] text-slate-500">${time}</span>
          ${canDelete ? `<button onclick="deleteMsg(${msg.id})" class="ml-auto text-slate-400 hover:text-rose-400 transition-colors" title="Delete message">
            <i class="fa-solid fa-trash-can text-xs"></i>
          </button>` : ''}
        </div>
        <div class="bg-slate-800/80 border border-slate-700/60 text-slate-200 text-sm p-3.5 rounded-2xl rounded-tl-none leading-relaxed break-words">
          ${contentText}
        </div>
        <div class="flex items-center gap-2 mt-2 text-xs">
          <button onclick="reactToMessage(${msg.id}, 'like')" class="flex items-center gap-1 rounded-full bg-slate-800/80 px-2.5 py-1 text-emerald-400 border border-slate-700">
            <i class="fa-solid fa-thumbs-up"></i><span>${likes}</span>
          </button>
          <button onclick="reactToMessage(${msg.id}, 'dislike')" class="flex items-center gap-1 rounded-full bg-slate-800/80 px-2.5 py-1 text-rose-400 border border-slate-700">
            <i class="fa-solid fa-thumbs-down"></i><span>${dislikes}</span>
          </button>
        </div>
      </div>
    `;
    messageFeed.appendChild(div);
    scrollToBottom();
  }

  function appendPendingMessage(msg) {
    const div = document.createElement('div');
    div.id = `pending-card-${msg.id}`;
    const isAdminMsg = msg.role === 'admin';
    const canDelete = currentUser && currentUser.role === 'admin' && !isAdminMsg;
    div.className = 'bg-slate-900 border border-slate-800 p-3.5 rounded-xl space-y-3';
    div.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="font-semibold text-xs text-slate-300 truncate">${escapeHtml(msg.fullname)}${msg.residence ? ` - ${escapeHtml(msg.residence)}` : ''}${msg.username ? ` (@${escapeHtml(msg.username)})` : ''}</span>
        <span class="text-[10px] text-slate-500">${new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <p class="text-xs text-slate-300 bg-slate-950 p-2.5 rounded-lg border border-slate-800 break-words">${msg.content ? escapeHtml(msg.content).replace(/\n/g, '<br>') : ''}</p>
      <div class="flex gap-2">
        <button onclick="approveMsg(${msg.id})" class="flex-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 py-1.5 rounded-lg text-xs font-bold transition-all">
          Approve & Publish
        </button>
        <button onclick="rejectMsg(${msg.id})" class="flex-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 py-1.5 rounded-lg text-xs font-bold transition-all">
          Reject
        </button>
        ${canDelete ? `<button onclick="deleteMsg(${msg.id})" class="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 py-1.5 rounded-lg text-xs font-bold transition-all">
          Delete
        </button>` : ''}
      </div>
    `;
    pendingFeed.appendChild(div);
    updatePendingBadge();
  }

  // Global scope helper bindings for inline onclick events
  window.approveMsg = function(id) {
    socket.emit('approveMessage', id);
  };

  window.rejectMsg = function(id) {
    socket.emit('rejectMessage', id);
  };

  window.deleteMsg = function(id) {
    if (!currentUser || currentUser.role !== 'admin') return;
    socket.emit('deleteMessage', { messageId: id, role: currentUser.role });
  };

  window.reactToMessage = function(id, reaction) {
    if (!currentUser) return;
    socket.emit('reactToMessage', { messageId: id, userId: currentUser.id, reaction });
  };

  function resetUserUI() {
    document.getElementById('userNameDisplay').textContent = 'Loading...';
    document.getElementById('userResidenceDisplay').textContent = '-';
    document.getElementById('userAvatar').textContent = 'U';
    document.getElementById('userRoleBadge').className = 'inline-block px-2 py-0.5 text-[10px] font-bold rounded bg-slate-800 text-slate-400 uppercase tracking-wider';
    document.getElementById('userRoleBadge').textContent = 'Resident';
    logoutBtn.classList.add('hidden');
    adminQueueToggle.classList.add('hidden');
    pendingFeed.innerHTML = '';
    updatePendingBadge();
  }

  logoutBtn.addEventListener('click', () => {
    currentUser = null;
    loginForm.reset();
    passwordInput.value = '';
    passwordField.classList.add('hidden');
    resetUserUI();
    // Clear persisted login
    localStorage.removeItem('modisha_user');
    loginModal.classList.remove('hidden');
  });

  // Wire mobile logout button to the same logout flow
  if (mobileLogoutBtn) {
    mobileLogoutBtn.addEventListener('click', () => {
      // trigger existing logout handler
      logoutBtn && logoutBtn.click();
    });
  }

  roleInput.addEventListener('change', () => {
    passwordField.classList.toggle('hidden', roleInput.value !== 'admin');
  });

  // --------------------------------------------------------------------------
  // 5. Socket Real-Time Event Handlers
  // --------------------------------------------------------------------------

  socket.on('messageSubmitted', (res) => {
    showToast(res.message);
  });

  socket.on('messageApproved', (msg) => {
    // Only append if message matches user's residence or user is admin
    if (!currentUser) return;
    if (currentUser.role === 'admin' || msg.residence === currentUser.residence) {
      appendApprovedMessage(msg);
    }
  });

  socket.on('newPendingMessage', (msg) => {
    if (currentUser && currentUser.role === 'admin') {
      appendPendingMessage(msg);
    }
  });

  socket.on('removePendingMessage', (id) => {
    const card = document.getElementById(`pending-card-${id}`);
    if (card) card.remove();
    updatePendingBadge();
  });

  socket.on('messageDeleted', (id) => {
    const approvedCard = document.getElementById(`approved-message-${id}`);
    if (approvedCard) approvedCard.remove();

    const pendingCard = document.getElementById(`pending-card-${id}`);
    if (pendingCard) pendingCard.remove();

    updatePendingBadge();
    showToast('Message deleted.');
  });

  socket.on('messageReactionUpdated', (data) => {
    const card = document.getElementById(`approved-message-${data.id}`);
    if (!card) return;
    const likeButton = card.querySelector('[onclick*="reactToMessage(' + data.id + ', \'like\')"]');
    const dislikeButton = card.querySelector('[onclick*="reactToMessage(' + data.id + ', \'dislike\')"]');
    if (likeButton) likeButton.innerHTML = `<i class="fa-solid fa-thumbs-up"></i><span>${data.likes || 0}</span>`;
    if (dislikeButton) dislikeButton.innerHTML = `<i class="fa-solid fa-thumbs-down"></i><span>${data.dislikes || 0}</span>`;
  });

  // --------------------------------------------------------------------------
  // 6. Utility Functions
  // --------------------------------------------------------------------------

  function scrollToBottom() {
    messageFeed.scrollTop = messageFeed.scrollHeight;
  }

  function updatePendingBadge() {
    const count = pendingFeed.children.length;
    if (count > 0) {
      pendingBadgeCount.textContent = count;
      pendingBadgeCount.classList.remove('hidden');
      pendingBadgeCount.classList.add('badge-pulse');
    } else {
      pendingBadgeCount.classList.add('hidden');
      pendingBadgeCount.classList.remove('badge-pulse');
    }
  }

  function showToast(text) {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-20 left-1/2 -translate-x-1/2 bg-emerald-500 text-slate-950 px-4 py-2 rounded-xl font-bold text-xs shadow-xl z-50 toast-animate flex items-center gap-2';
    toast.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>${text}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m]));
  }

  // Admin Drawer Controls
  adminQueueToggle.addEventListener('click', () => {
    adminPanel.classList.remove('translate-x-full');
  });

  closeAdminPanel.addEventListener('click', () => {
    adminPanel.classList.add('translate-x-full');
  });
});

let deferredPrompt;
const installBtn = document.getElementById('installAppBtn');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  // Show your install button/banner
  if (installBtn) installBtn.classList.remove('hidden');
});

installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') {
    console.log('User installed the app');
  }
  deferredPrompt = null;
  installBtn.classList.add('hidden');
});