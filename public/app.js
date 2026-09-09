(function () {
  const chatScroll = document.getElementById('chatScroll');
  const chatEmpty = document.getElementById('chatEmpty');
  const messagesEl = document.getElementById('messages');
  const form = document.getElementById('composerForm');
  const input = document.getElementById('composerInput');
  const sendBtn = document.getElementById('sendBtn');
  const micBtn = document.getElementById('micBtn');
  const waveIcon = sendBtn.querySelector('.wave-icon');
  const arrowIcon = sendBtn.querySelector('.arrow-icon');
  const chipRow = document.getElementById('chipRow');
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  const openSidebarBtn = document.getElementById('openSidebar');
  const closeSidebarBtn = document.getElementById('closeSidebar');
  const newChatBtn = document.getElementById('newChatBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const sidebarHistory = document.getElementById('sidebarHistory');

  let sessionId = localStorage.getItem('astra_session_id') || null;
  let historyTitles = JSON.parse(localStorage.getItem('astra_history') || '[]');
  let hasStartedChat = false;

  renderHistory();

  // ---------------- Sidebar ----------------
  function openSidebar() {
    sidebar.classList.add('open');
    sidebarOverlay.classList.add('show');
  }
  function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('show');
  }
  openSidebarBtn.addEventListener('click', openSidebar);
  closeSidebarBtn.addEventListener('click', closeSidebar);
  sidebarOverlay.addEventListener('click', closeSidebar);

  function renderHistory() {
    const existing = sidebarHistory.querySelectorAll('.history-item');
    existing.forEach((el) => el.remove());
    historyTitles.slice().reverse().forEach((title) => {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.textContent = title;
      sidebarHistory.appendChild(item);
    });
  }

  function newChat() {
    messagesEl.innerHTML = '';
    chatEmpty.classList.remove('hidden');
    hasStartedChat = false;
    input.value = '';
    autoGrow();
    updateSendIcon();
    closeSidebar();
  }
  newChatBtn.addEventListener('click', newChat);
  refreshBtn.addEventListener('click', newChat);

  // ---------------- Chips ----------------
  chipRow.addEventListener('click', (e) => {
    const dismiss = e.target.closest('[data-dismiss]');
    if (dismiss) {
      e.stopPropagation();
      dismiss.closest('.chip').style.display = 'none';
      return;
    }
    const chip = e.target.closest('.chip');
    if (chip) {
      input.value = chip.dataset.prompt || '';
      input.focus();
      autoGrow();
      updateSendIcon();
    }
  });

  // ---------------- Composer ----------------
  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  }
  input.addEventListener('input', () => {
    autoGrow();
    updateSendIcon();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  function updateSendIcon() {
    const hasText = input.value.trim().length > 0;
    waveIcon.style.display = hasText ? 'none' : '';
    arrowIcon.style.display = hasText ? '' : 'none';
  }
  updateSendIcon();

  micBtn.addEventListener('click', () => {
    micBtn.classList.toggle('active');
    // purely cosmetic — no real voice capture, this is a fake clone
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    autoGrow();
    updateSendIcon();
    sendMessage(text);
  });

  // ---------------- Rendering helpers ----------------
  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderRichText(text) {
    // Handle fenced code blocks ```lang\n...\n```
    const parts = text.split(/```(\w*)\n([\s\S]*?)```/g);
    let html = '';
    for (let i = 0; i < parts.length; i += 3) {
      const plain = parts[i] || '';
      html += escapeHtml(plain)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
      const lang = parts[i + 1];
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
      chatEmpty.classList.add('hidden');
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

    if (historyTitles.length === 0 || messagesEl.querySelectorAll('.msg.user').length === 1) {
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
      <div class="avatar-mark">✨</div>
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
    row.innerHTML = `<div class="avatar-mark">✨</div><div class="bubble"></div>`;
    messagesEl.appendChild(row);
    scrollToBottom();
    return row.querySelector('.bubble');
  }

  function typeOut(bubble, html, done) {
    // Render progressively for a "streaming" feel, but since we already
    // have final HTML with tags, just reveal it in chunks of plain text
    // using a temp container split by tags is complex; simplest: fade in.
    bubble.innerHTML = html;
    bubble.style.opacity = '0';
    requestAnimationFrame(() => {
      bubble.style.transition = 'opacity 0.2s ease';
      bubble.style.opacity = '1';
      scrollToBottom();
      if (done) done();
    });
  }

  // ---------------- Networking ----------------
  async function sendMessage(text) {
    addUserMessage(text);
    sendBtn.disabled = true;

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

      const minThinkTime = data.thinking ? 1400 : 550;
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
      typeOut(bubble, 'Something went wrong. Please try again.');
    } finally {
      sendBtn.disabled = false;
    }
  }
})();
