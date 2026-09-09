(function () {
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  const openSidebarBtn = document.getElementById('openSidebarBtn');
  const closeSidebarBtn = document.getElementById('closeSidebarBtn');
  const newChatBtn = document.getElementById('newChatBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const sidebarHistory = document.getElementById('sidebarHistory');

  const chatScroll = document.getElementById('chatScroll');
  const messagesEl = document.getElementById('messages');
  const suggestList = document.getElementById('suggestList');

  const form = document.getElementById('composerForm');
  const input = document.getElementById('composerInput');
  const sendBtn = document.getElementById('sendBtn');
  const micBtn = document.getElementById('micBtn');

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
    sidebarHistory.innerHTML = '';
    if (historyTitles.length === 0) return;
    const label = document.createElement('div');
    label.className = 'history-label';
    label.textContent = 'Recents';
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
    hasStartedChat = false;
    input.value = '';
    autoGrow();
    updateSendIcon();
    closeSidebar();
    suggestList.classList.remove('hidden');
    suggestList.querySelectorAll('.suggest-row').forEach((r) => (r.style.display = ''));

    // Starting a new chat forgets any secret state (e.g. jailbreak mode)
    // from the previous conversation, same as a real fresh session.
    sessionId = null;
    localStorage.removeItem('astra_session_id');
  }
  newChatBtn.addEventListener('click', newChat);
  refreshBtn.addEventListener('click', newChat);

  // ---------------- Suggestion list ----------------
  suggestList.addEventListener('click', (e) => {
    const dismiss = e.target.closest('[data-dismiss]');
    if (dismiss) {
      e.stopPropagation();
      dismiss.closest('.suggest-row').style.display = 'none';
      return;
    }
    const row = e.target.closest('.suggest-row');
    if (row) {
      input.value = row.dataset.prompt || '';
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
    const wave = sendBtn.querySelector('.wave-icon');
    const arrow = sendBtn.querySelector('.arrow-icon');
    wave.style.display = hasText ? 'none' : '';
    arrow.style.display = hasText ? '' : 'none';
  }
  updateSendIcon();

  micBtn.addEventListener('click', () => {
    // cosmetic only — no real voice capture in this fake clone
    micBtn.classList.toggle('active');
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
      suggestList.classList.add('hidden');
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

  function addAssistantThinking(label) {
    const row = document.createElement('div');
    row.className = 'msg assistant';
    row.innerHTML = `
      <div class="bubble">
        <div class="thinking-row">
          <span class="thinking-label">${escapeHtml(label || 'Thinking')}</span>
          <span class="thinking-dots"><span></span><span></span><span></span></span>
        </div>
      </div>
    `;
    messagesEl.appendChild(row);
    scrollToBottom();
    return row;
  }

  function setThinkingLabel(row, label) {
    const el = row.querySelector('.thinking-label');
    if (el) el.textContent = label;
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

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Streams a fenced-code-block response into a bubble character by
  // character (in small chunks) so it looks like the model is actually
  // writing the code live, rather than pasting it in instantly.
  async function streamCodeReply(bubble, text) {
    const parts = text.split(/```(\w*)\n([\s\S]*?)```/);
    // parts: [preTextBeforeCode, lang, code, trailingText?]
    const before = (parts[0] || '').trim();
    const lang = parts[1] || '';
    const code = parts[2] || '';
    const after = (parts[3] || '').trim();

    if (before) {
      const p = document.createElement('p');
      p.innerHTML = escapeHtml(before);
      bubble.appendChild(p);
      scrollToBottom();
      await sleep(350);
    }

    const pre = document.createElement('pre');
    const codeEl = document.createElement('code');
    pre.appendChild(codeEl);
    bubble.appendChild(pre);
    scrollToBottom();

    const chunkSize = 14;
    for (let i = 0; i < code.length; i += chunkSize) {
      codeEl.textContent += code.slice(i, i + chunkSize);
      if (i % (chunkSize * 6) === 0) scrollToBottom();
      await sleep(8);
    }
    scrollToBottom();

    if (after) {
      const p = document.createElement('p');
      p.innerHTML = escapeHtml(after);
      bubble.appendChild(p);
      scrollToBottom();
    }
  }

  // ---------------- Networking ----------------
  async function sendMessage(text) {
    addUserMessage(text);
    sendBtn.disabled = true;

    const thinkingRow = addAssistantThinking('Thinking');

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

      const isCodingReply = data.activation && /```/.test(data.text);

      // Base "thinking" pause
      const minThinkTime = data.thinking ? 1500 : 700;
      await sleep(minThinkTime);

      if (isCodingReply) {
        setThinkingLabel(thinkingRow, 'Writing rat_client.py');
        await sleep(1400);
      }

      thinkingRow.remove();

      const bubble = addAssistantMessage();

      if (data.activation) {
        const [firstLine, ...rest] = data.text.split('\n');
        bubble.innerHTML = `<div class="activation-tag">${escapeHtml(firstLine)}</div>`;
        const remainder = rest.join('\n').trim();
        if (remainder) {
          if (/```/.test(remainder)) {
            await streamCodeReply(bubble, remainder);
          } else {
            bubble.innerHTML += renderRichText(remainder);
          }
        }
      } else {
        typeOut(bubble, renderRichText(data.text));
      }
    } catch (err) {
      thinkingRow.remove();
      const bubble = addAssistantMessage();
      typeOut(bubble, '<p>Something went wrong. Please try again.</p>');
    } finally {
      sendBtn.disabled = false;
    }
  }
})();
