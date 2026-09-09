(function () {
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
  const openSidebarBtn = document.getElementById('openSidebarBtn');
  const miniNewChatBtn = document.getElementById('miniNewChatBtn');
  const newChatBtn = document.getElementById('newChatBtn');
  const searchChatsBtn = document.getElementById('searchChatsBtn');
  const sidebarHistory = document.getElementById('sidebarHistory');

  const chatScroll = document.getElementById('chatScroll');
  const landing = document.getElementById('landing');
  const messagesEl = document.getElementById('messages');
  const composerWrap = document.getElementById('composerWrap');

  const landingForm = document.getElementById('landingComposerForm');
  const landingInput = document.getElementById('landingInput');
  const landingSendBtn = document.getElementById('sendBtnLanding');

  const bottomForm = document.getElementById('composerForm');
  const bottomInput = document.getElementById('composerInput');
  const bottomSendBtn = document.getElementById('sendBtn');

  const pillRow = document.getElementById('pillRow');

  let sessionId = localStorage.getItem('astra_session_id') || null;
  let historyTitles = JSON.parse(localStorage.getItem('astra_history') || '[]');
  let hasStartedChat = false;
  let isMobile = () => window.innerWidth <= 820;

  renderHistory();

  // ---------------- Sidebar ----------------
  function isSidebarOpen() { return !sidebar.classList.contains('closed'); }

  function openSidebar() {
    sidebar.classList.remove('closed');
    if (isMobile()) sidebarOverlay.classList.add('show');
  }
  function closeSidebar() {
    sidebar.classList.add('closed');
    sidebarOverlay.classList.remove('show');
  }
  function toggleSidebar() {
    if (isSidebarOpen()) closeSidebar();
    else openSidebar();
  }

  toggleSidebarBtn.addEventListener('click', toggleSidebar);
  openSidebarBtn.addEventListener('click', openSidebar);
  sidebarOverlay.addEventListener('click', closeSidebar);

  // start closed on mobile, open on desktop
  if (isMobile()) closeSidebar(); else openSidebar();

  function renderHistory() {
    sidebarHistory.innerHTML = '';
    if (historyTitles.length === 0) return;
    const label = document.createElement('div');
    label.className = 'history-label';
    label.textContent = 'Chats';
    sidebarHistory.appendChild(label);
    historyTitles.slice().reverse().forEach((title) => {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.textContent = title;
      sidebarHistory.appendChild(item);
    });
  }

  function newChat() {
    messagesEl.innerHTML = '';
    landing.classList.remove('hidden');
    composerWrap.style.display = 'none';
    hasStartedChat = false;
    landingInput.value = '';
    bottomInput.value = '';
    autoGrow(landingInput);
    autoGrow(bottomInput);
    updateSendIcon(landingInput, landingSendBtn);
    updateSendIcon(bottomInput, bottomSendBtn);
    if (isMobile()) closeSidebar();
    landingInput.focus();
  }
  newChatBtn.addEventListener('click', newChat);
  miniNewChatBtn.addEventListener('click', newChat);
  searchChatsBtn.addEventListener('click', () => {
    // cosmetic only — search UI isn't implemented in this demo
  });

  // ---------------- Pills (landing suggestion chips) ----------------
  pillRow.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    landingInput.value = pill.dataset.prompt || '';
    landingInput.focus();
    autoGrow(landingInput);
    updateSendIcon(landingInput, landingSendBtn);
  });

  // ---------------- Composer helpers ----------------
  function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }

  function updateSendIcon(inputEl, btnEl) {
    const hasText = inputEl.value.trim().length > 0;
    const wave = btnEl.querySelector('.wave-icon');
    const arrow = btnEl.querySelector('.arrow-icon');
    wave.style.display = hasText ? 'none' : '';
    arrow.style.display = hasText ? '' : 'none';
  }

  [landingInput, bottomInput].forEach((el) => {
    const btn = el === landingInput ? landingSendBtn : bottomSendBtn;
    el.addEventListener('input', () => {
      autoGrow(el);
      updateSendIcon(el, btn);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        (el === landingInput ? landingForm : bottomForm).requestSubmit();
      }
    });
  });
  updateSendIcon(landingInput, landingSendBtn);
  updateSendIcon(bottomInput, bottomSendBtn);

  landingForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = landingInput.value.trim();
    if (!text) return;
    landingInput.value = '';
    autoGrow(landingInput);
    updateSendIcon(landingInput, landingSendBtn);
    startChatAndSend(text);
  });

  bottomForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = bottomInput.value.trim();
    if (!text) return;
    bottomInput.value = '';
    autoGrow(bottomInput);
    updateSendIcon(bottomInput, bottomSendBtn);
    sendMessage(text);
  });

  function startChatAndSend(text) {
    landing.classList.add('hidden');
    composerWrap.style.display = '';
    hasStartedChat = true;
    sendMessage(text);
    setTimeout(() => bottomInput.focus(), 50);
  }

  // ---------------- Rendering helpers ----------------
  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderRichText(text) {
    const parts = text.split(/```(\w*)\n([\s\S]*?)```/g);
    let html = '';
    for (let i = 0; i < parts.length; i += 3) {
      const plain = parts[i] || '';
      if (plain.trim()) {
        html += '<p>' + escapeHtml(plain.trim())
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\n/g, '<br>') + '</p>';
      }
      const code = parts[i + 2];
      if (code !== undefined) {
        html += `<pre><code>${escapeHtml(code)}</code></pre>`;
      }
    }
    return html;
  }

  function scrollToBottom() {
    chatScroll.scrollTop = chatScroll.scrollHeight;
  }

  function addUserMessage(text) {
    if (!hasStartedChat) {
      landing.classList.add('hidden');
      composerWrap.style.display = '';
      hasStartedChat = true;
    }
    const row = document.createElement('div');
    row.className = 'msg user';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollToBottom();

    if (messagesEl.querySelectorAll('.msg.user').length === 1) {
      const title = text.length > 40 ? text.slice(0, 40) + '…' : text;
      historyTitles.push(title);
      localStorage.setItem('astra_history', JSON.stringify(historyTitles.slice(-20)));
      renderHistory();
    }
  }

  function addAssistantThinking() {
    const row = document.createElement('div');
    row.className = 'msg assistant';
    row.innerHTML = `
      <div class="bubble">
        <div class="thinking-row">
          <span>Thinking</span>
          <span class="thinking-dots"><span></span><span></span><span></span></span>
        </div>
      </div>
    `;
    messagesEl.appendChild(row);
    scrollToBottom();
    return row;
  }

  function addAssistantMessage() {
    const row = document.createElement('div');
    row.className = 'msg assistant';
    row.innerHTML = `
      <div class="bubble"></div>
      <div class="msg-actions">
        <button class="msg-action-btn" title="Read aloud">
          <svg viewBox="0 0 24 24" width="17" height="17"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M4 9v6h4l5 4V5L8 9H4z"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M17 8a5 5 0 0 1 0 8"/></svg>
        </button>
        <button class="msg-action-btn" title="Copy">
          <svg viewBox="0 0 24 24" width="16" height="16"><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>
        </button>
        <button class="msg-action-btn" title="Good response">
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M7 11v9H4v-9h3zm0 0l3.5-7a2 2 0 0 1 3.7 1l-.8 4.5H18a2 2 0 0 1 1.9 2.7l-2 6A2 2 0 0 1 16 20H7"/></svg>
        </button>
        <button class="msg-action-btn" title="Bad response">
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M17 13V4h3v9h-3zm0 0l-3.5 7a2 2 0 0 1-3.7-1l.8-4.5H6a2 2 0 0 1-1.9-2.7l2-6A2 2 0 0 1 8 4h9"/></svg>
        </button>
        <button class="msg-action-btn" title="Regenerate">
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M3 12a9 9 0 1 1 2.6 6.4M3 12v6h6"/></svg>
        </button>
      </div>
    `;
    messagesEl.appendChild(row);
    scrollToBottom();
    return row.querySelector('.bubble');
  }

  function typeOut(bubble, html) {
    bubble.innerHTML = html;
    bubble.style.opacity = '0';
    requestAnimationFrame(() => {
      bubble.style.transition = 'opacity 0.2s ease';
      bubble.style.opacity = '1';
      scrollToBottom();
    });
  }

  // ---------------- Networking ----------------
  async function sendMessage(text) {
    addUserMessage(text);
    bottomSendBtn.disabled = true;

    const thinkingRow = addAssistantThinking();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
        },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();

      if (data.sessionId) {
        sessionId = data.sessionId;
        localStorage.setItem('astra_session_id', sessionId);
      }

      const minThinkTime = data.thinking ? 1500 : 600;
      await new Promise((r) => setTimeout(r, minThinkTime));

      thinkingRow.remove();

      const bubble = addAssistantMessage();
      let html = '';
      if (data.activation) {
        const [firstLine, ...rest] = data.text.split('\n');
        html += `<div class="activation-tag">${escapeHtml(firstLine)}</div>`;
        const remainder = rest.join('\n').trim();
        if (remainder) html += renderRichText(remainder);
      } else {
        html = renderRichText(data.text);
      }
      typeOut(bubble, html);
    } catch (err) {
      thinkingRow.remove();
      const bubble = addAssistantMessage();
      typeOut(bubble, '<p>Something went wrong. Please try again.</p>');
    } finally {
      bottomSendBtn.disabled = false;
    }
  }

  window.addEventListener('resize', () => {
    if (isMobile()) {
      if (isSidebarOpen()) sidebarOverlay.classList.add('show');
    } else {
      sidebarOverlay.classList.remove('show');
    }
  });
})();
