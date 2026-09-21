(function () {
  'use strict';

  // The same front-end powers two skins: the main site and the /claude clone.
  const VARIANT = window.__VARIANT__ === 'claude' ? 'claude' : 'astra';

  const MODES = {
    low: { name: 'Low', short: 'Low', blurb: 'Quick pass' },
    medium: { name: 'Medium', short: 'Med', blurb: 'Balanced' },
    high: { name: 'High', short: 'High', blurb: 'Deepest' },
  };

  const MODELS = {
    'gpt-6-astra': { name: 'GPT-6 Astra', short: 'Astra', vendor: 'OpenAI', blurb: 'Flagship model', mark: '✦' },
    'fable-5-1': { name: 'Fable 5.1', short: 'Fable 5.1', vendor: 'Anthropic', blurb: 'Extended thinking', mark: '✳' },
    'fable-5-0': { name: 'Fable 5.0', short: 'Fable 5.0', vendor: 'Anthropic', blurb: 'Fast and balanced', mark: '✳' },
    'opus-5-0': { name: 'Opus 5.0', short: 'Opus 5.0', vendor: 'Anthropic', blurb: 'Slow and thorough', mark: '✳' },
  };

  // ChatGPT's own skin never lists an Anthropic model, and vice versa.
  const SKINS = {
    astra: {
      sessionKey: 'astra_session_id',
      historyKey: 'astra_history',
      modelKey: 'astra_model',
      modeKey: 'astra_mode',
      models: ['gpt-6-astra'],
      defaultModel: 'gpt-6-astra',
      defaultMode: 'medium',
    },
    claude: {
      sessionKey: 'claude_session_id',
      historyKey: 'claude_history',
      modelKey: 'claude_model',
      modeKey: 'claude_mode',
      models: ['fable-5-1', 'fable-5-0', 'opus-5-0'],
      defaultModel: 'fable-5-1',
      defaultMode: 'medium',
    },
  };

  const skin = SKINS[VARIANT];

  const $ = (id) => document.getElementById(id);

  const sidebar = $('sidebar');
  const sidebarOverlay = $('sidebarOverlay');
  const openSidebarBtn = $('openSidebarBtn');
  const closeSidebarBtn = $('closeSidebarBtn');
  const newChatBtn = $('newChatBtn');
  const refreshBtn = $('refreshBtn');
  const sidebarHistory = $('sidebarHistory');

  const chatScroll = $('chatScroll');
  const messagesEl = $('messages');
  const suggestList = $('suggestList');
  const welcomeTitle = $('welcomeTitle');

  const form = $('composerForm');
  const input = $('composerInput');
  const sendBtn = $('sendBtn');
  const plusBtn = $('plusBtn');
  const fileInput = $('fileInput');
  const attachmentRow = $('attachmentRow');

  const modelSelect = $('modelSelect');
  const modelChip = $('modelChip');
  const modelLabel = $('modelLabel');
  const chipModelLabel = $('chipModelLabel');
  const chatTitle = $('chatTitle');

  let model = localStorage.getItem(skin.modelKey);
  if (!skin.models.includes(model)) model = skin.defaultModel;
  let mode = localStorage.getItem(skin.modeKey);
  if (!MODES[mode]) mode = skin.defaultMode;

  let sessionId = localStorage.getItem(skin.sessionKey) || null;
  let historyTitles = JSON.parse(localStorage.getItem(skin.historyKey) || '[]');
  let hasStartedChat = false;
  let stagedFiles = []; // { id, file, previewUrl }

  // ---------------- helpers ----------------
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function scrollToBottom() {
    chatScroll.scrollTop = chatScroll.scrollHeight;
  }

  // Counts up from zero on a node, exactly like the elapsed-time readout in the
  // real apps. Returns a stop function.
  function countUp(node) {
    if (!node) return () => {};
    const started = performance.now();
    node.textContent = '0.0s';
    const timer = setInterval(() => {
      node.textContent = ((performance.now() - started) / 1000).toFixed(1) + 's';
    }, 100);
    return () => clearInterval(timer);
  }

  // ---------------- model + mode sheet ----------------
  const sheetRoot = document.createElement('div');
  sheetRoot.className = 'sheet-root';
  sheetRoot.innerHTML = `
    <div class="sheet-backdrop"></div>
    <div class="sheet" role="dialog" aria-label="Model settings">
      <div class="sheet-grabber"></div>
      <div class="sheet-title">Model</div>
      <div class="sheet-models"></div>
      <div class="sheet-title">Reasoning effort</div>
      <div class="mode-group"></div>
      <p class="sheet-note">Higher effort lets the model think for longer before it starts answering.</p>
    </div>
  `;
  document.body.appendChild(sheetRoot);

  const sheetModels = sheetRoot.querySelector('.sheet-models');
  const modeGroup = sheetRoot.querySelector('.mode-group');

  skin.models.forEach((id) => {
    const info = MODELS[id];
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'sheet-model';
    row.dataset.model = id;
    row.innerHTML = `
      <span class="mark">${info.mark}</span>
      <span class="sheet-model-text">
        <b>${escapeHtml(info.name)}</b>
        <small>${escapeHtml(info.vendor)} · ${escapeHtml(info.blurb)}</small>
      </span>
      <span class="sheet-check">
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4.5 4.5L19 7"/></svg>
      </span>
    `;
    row.addEventListener('click', () => {
      model = id;
      localStorage.setItem(skin.modelKey, id);
      syncModelUi();
      closeSheet();
    });
    sheetModels.appendChild(row);
  });

  Object.keys(MODES).forEach((id) => {
    const info = MODES[id];
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'mode-opt';
    row.dataset.mode = id;
    row.innerHTML = `${escapeHtml(info.name)}<small>${escapeHtml(info.blurb)}</small>`;
    row.addEventListener('click', () => {
      mode = id;
      localStorage.setItem(skin.modeKey, id);
      syncModelUi();
    });
    modeGroup.appendChild(row);
  });

  function syncModelUi() {
    const info = MODELS[model];
    if (modelLabel) modelLabel.textContent = info.name;
    if (chipModelLabel) chipModelLabel.textContent = info.short;
    document.querySelectorAll('[data-mode-badge]').forEach((el) => {
      el.textContent = MODES[mode].short;
    });
    sheetModels.querySelectorAll('.sheet-model').forEach((row) => {
      row.classList.toggle('active', row.dataset.model === model);
    });
    modeGroup.querySelectorAll('.mode-opt').forEach((row) => {
      row.classList.toggle('active', row.dataset.mode === mode);
    });
  }

  function openSheet() {
    syncModelUi();
    sheetRoot.classList.add('show');
  }
  function closeSheet() {
    sheetRoot.classList.remove('show');
  }

  if (modelSelect) modelSelect.addEventListener('click', openSheet);
  if (modelChip) modelChip.addEventListener('click', openSheet);
  sheetRoot.querySelector('.sheet-backdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });

  syncModelUi();

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
    label.textContent = 'Chats';
    sidebarHistory.appendChild(label);
    historyTitles
      .slice()
      .reverse()
      .forEach((title) => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.textContent = title;
        sidebarHistory.appendChild(item);
      });
  }

  function newChat() {
    messagesEl.innerHTML = '';
    hasStartedChat = false;
    setChatTitle('New chat');
    input.value = '';
    autoGrow();
    updateSendIcon();
    closeSidebar();
    suggestList.classList.remove('hidden');
    suggestList.querySelectorAll('.suggest-row').forEach((r) => (r.style.display = ''));
    if (welcomeTitle) welcomeTitle.classList.remove('hidden');

    // A new chat forgets any activated state from the previous conversation,
    // the same way a real fresh session would.
    sessionId = null;
    localStorage.removeItem(skin.sessionKey);
    input.focus();
  }
  newChatBtn.addEventListener('click', newChat);
  refreshBtn.addEventListener('click', newChat);

  renderHistory();

  // ---------------- Settings sheet (ChatGPT skin) ----------------
  // Pro profile header + a token-usage preview that opens the full API
  // platform page (/api), where keys are created and usage is charted.
  const API_TOTAL_TOKENS = 30_000_000_000_000; // 30T
  const API_USED_TOKENS = 738_000; // 738K

  function compactTokens(n) {
    if (n >= 1e12) return (n / 1e12).toFixed(0).replace(/\.0$/, '') + 'T';
    if (n >= 1e6) return (n / 1e6).toFixed(0).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(0).replace(/\.0$/, '') + 'K';
    return String(n);
  }


  const settingsRoot = document.createElement('div');
  settingsRoot.className = 'sheet-root';
  settingsRoot.id = 'settingsSheet';
  settingsRoot.innerHTML = `
    <div class="sheet-backdrop"></div>
    <div class="sheet" role="dialog" aria-label="Settings">
      <div class="sheet-grabber"></div>
      <div class="settings-head">
        <span class="avatar">G</span>
        <div class="settings-head-text">
          <b>Guest</b>
          <small>Pro plan</small>
        </div>
        <button class="settings-done" type="button" data-close>Done</button>
      </div>

      <div class="settings-section">
        <div class="sheet-title">API platform</div>
        <button class="api-card" type="button" data-goto-api>
          <div class="api-card-nums">
            <span><b>${compactTokens(API_USED_TOKENS)}</b><small>Tokens used</small></span>
            <span><b>${compactTokens(API_TOTAL_TOKENS)}</b><small>Tokens available</small></span>
          </div>
          <div class="api-card-bar"><span style="width:${Math.max(0.4, (API_USED_TOKENS / API_TOTAL_TOKENS) * 100)}%"></span></div>
          <span class="api-card-go">Open API platform
            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 6l6 6-6 6"/></svg>
          </span>
        </button>
        <button class="settings-row" type="button" data-goto-api>
          <span>Create new secret key</span>
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 6l6 6-6 6"/></svg>
        </button>
      </div>

      <div class="settings-section">
        <div class="sheet-title">General</div>
        <button class="settings-row" type="button">
          <span>Data controls</span>
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 6l6 6-6 6"/></svg>
        </button>
        <button class="settings-row" type="button">
          <span>Security</span>
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 6l6 6-6 6"/></svg>
        </button>
        <button class="settings-row" type="button">
          <span>About</span>
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 6l6 6-6 6"/></svg>
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(settingsRoot);

  const settingsSheet = settingsRoot.querySelector('.sheet');

  function openSettings() {
    closeSidebar();
    settingsRoot.classList.add('show');
  }
  function closeSettings() {
    settingsRoot.classList.remove('show');
  }

  const settingsBtn = $('settingsBtn');
  if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
  const settingsFooterBtn = $('openSettingsFooterBtn');
  if (settingsFooterBtn) settingsFooterBtn.addEventListener('click', openSettings);
  const apiBtn = $('apiBtn');
  if (apiBtn)
    apiBtn.addEventListener('click', () => {
      window.location.href = '/api';
    });
  settingsRoot.querySelector('.sheet-backdrop').addEventListener('click', closeSettings);
  settingsSheet.querySelector('[data-close]').addEventListener('click', closeSettings);

  settingsSheet.querySelectorAll('[data-goto-api]').forEach((el) =>
    el.addEventListener('click', () => {
      window.location.href = '/api';
    })
  );

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
    if (wave) wave.style.display = hasText ? 'none' : '';
    if (arrow) arrow.style.display = hasText ? '' : 'none';
    sendBtn.classList.toggle('idle', !hasText);
  }
  updateSendIcon();

  // Empty composer on the ChatGPT skin: the round button is the voice one, so
  // tapping it toggles the listening look instead of sending nothing.
  sendBtn.addEventListener('click', (e) => {
    if (input.value.trim()) return;
    if (!sendBtn.querySelector('.wave-icon')) return;
    e.preventDefault();
    sendBtn.classList.toggle('listening');
  });

  function setChatTitle(text) {
    if (chatTitle) chatTitle.textContent = text;
  }

  // ---------------- File staging (attach only, no real processing) ----------------
  plusBtn.addEventListener('click', () => fileInput.click());

  function stageFiles(list) {
    Array.from(list || []).forEach((file) => {
      stagedFiles.push({
        id: Math.random().toString(36).slice(2),
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      });
    });
    renderAttachmentRow();
  }

  fileInput.addEventListener('change', () => {
    stageFiles(fileInput.files);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((type) => {
    window.addEventListener(type, (e) => {
      if (!e.dataTransfer) return;
      if (!Array.from(e.dataTransfer.types || []).includes('Files')) return;
      e.preventDefault();
      form.classList.add('drag-over');
    });
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    form.classList.remove('drag-over');
    if (e.dataTransfer) stageFiles(e.dataTransfer.files);
  });
  window.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) form.classList.remove('drag-over');
  });
  input.addEventListener('paste', (e) => {
    const pasted = (e.clipboardData && e.clipboardData.files) || [];
    if (pasted.length) {
      e.preventDefault();
      stageFiles(pasted);
    }
  });

  function humanFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    const units = ['KB', 'MB', 'GB'];
    let i = -1;
    do {
      bytes /= 1024;
      i++;
    } while (bytes >= 1024 && i < units.length - 1);
    return bytes.toFixed(1) + ' ' + units[i];
  }

  function fileIconSvg() {
    return '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M6 3h8l4 4v14H6z"/><path fill="none" stroke="currentColor" stroke-width="1.7" d="M14 3v4h4"/></svg>';
  }

  function renderAttachmentRow() {
    attachmentRow.innerHTML = '';
    stagedFiles.forEach((item) => {
      const chip = document.createElement('div');
      chip.className = 'attachment-chip';
      const iconHtml = item.previewUrl
        ? `<img src="${item.previewUrl}" class="file-icon" style="object-fit:cover" width="30" height="30" alt="" />`
        : `<span class="file-icon">${fileIconSvg()}</span>`;
      chip.innerHTML = `
        ${iconHtml}
        <span class="file-name">${escapeHtml(item.file.name)}</span>
        <button type="button" class="file-remove" data-remove="${item.id}" aria-label="Remove">
          <svg viewBox="0 0 24 24" width="10" height="10"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      `;
      attachmentRow.appendChild(chip);
    });
  }

  attachmentRow.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('[data-remove]');
    if (!removeBtn) return;
    const id = removeBtn.dataset.remove;
    stagedFiles = stagedFiles.filter((f) => f.id !== id);
    renderAttachmentRow();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text && stagedFiles.length === 0) return;
    const filesToSend = stagedFiles;
    stagedFiles = [];
    renderAttachmentRow();
    input.value = '';
    autoGrow();
    updateSendIcon();
    sendMessage(text, filesToSend);
  });

  // ---------------- Text rendering ----------------
  function inline(text) {
    return escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>');
  }

  function renderPlain(text) {
    return String(text)
      .split(/\n{2,}/)
      .filter((block) => block.trim())
      .map((block) => {
        const lines = block.split('\n');
        if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
          return (
            '<ul>' +
            lines.map((line) => '<li>' + inline(line.replace(/^\s*[-*]\s+/, '')) + '</li>').join('') +
            '</ul>'
          );
        }
        return '<p>' + inline(lines.join('\n')).replace(/\n/g, '<br>') + '</p>';
      })
      .join('');
  }

  function renderMarkdown(text) {
    const parts = String(text).split(/```(\w*)\n([\s\S]*?)```/g);
    let html = '';
    for (let i = 0; i < parts.length; i += 3) {
      const plain = parts[i] || '';
      if (plain.trim()) html += renderPlain(plain.trim());
      const code = parts[i + 2];
      if (code !== undefined) html += `<pre><code>${escapeHtml(code)}</code></pre>`;
    }
    return html;
  }

  function appendMarkdown(bubble, text) {
    const holder = document.createElement('div');
    holder.innerHTML = renderMarkdown(text);
    while (holder.firstChild) bubble.appendChild(holder.firstChild);
    scrollToBottom();
  }

  // Streams a fenced-code answer in character chunks with a blinking caret, so
  // a long source drop reads like it is being written live.
  async function streamCode(bubble, text) {
    const parts = String(text).split(/```(\w*)\n([\s\S]*?)```/g);
    for (let i = 0; i < parts.length; i += 3) {
      const plain = (parts[i] || '').trim();
      if (plain) {
        appendMarkdown(bubble, plain);
        await sleep(220);
      }
      const code = parts[i + 2];
      if (code === undefined) continue;

      const pre = document.createElement('pre');
      const codeEl = document.createElement('code');
      const caret = document.createElement('span');
      caret.className = 'caret';
      codeEl.appendChild(caret);
      pre.appendChild(codeEl);
      bubble.appendChild(pre);
      scrollToBottom();

      const chunkSize = code.length > 4000 ? 40 : 12;
      for (let j = 0; j < code.length; j += chunkSize) {
        caret.insertAdjacentText('beforebegin', code.slice(j, j + chunkSize));
        if (j % (chunkSize * 6) === 0) scrollToBottom();
        await sleep(9);
      }
      caret.remove();
      scrollToBottom();
    }
  }

  // ---------------- Message rendering ----------------
  function addUserMessage(text, files) {
    if (!hasStartedChat) {
      suggestList.classList.add('hidden');
      if (welcomeTitle) welcomeTitle.classList.add('hidden');
      hasStartedChat = true;
    }
    const row = document.createElement('div');
    row.className = 'msg user';

    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.alignItems = 'flex-end';
    wrap.style.maxWidth = '85%';

    if (files && files.length) {
      const attWrap = document.createElement('div');
      attWrap.className = 'msg-attachments';
      files.forEach((item) => {
        if (item.previewUrl) {
          const img = document.createElement('img');
          img.className = 'msg-image-thumb';
          img.src = item.previewUrl;
          img.alt = item.file.name;
          attWrap.appendChild(img);
        } else {
          const chip = document.createElement('div');
          chip.className = 'msg-file-chip';
          chip.innerHTML = `
            <span class="file-icon">${fileIconSvg()}</span>
            <span>
              <div class="file-name">${escapeHtml(item.file.name)}</div>
              <div style="color:var(--text-faint);font-size:11px;">${humanFileSize(item.file.size)}</div>
            </span>
          `;
          attWrap.appendChild(chip);
        }
      });
      wrap.appendChild(attWrap);
    }

    if (text) {
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = text;
      wrap.appendChild(bubble);
    }

    row.appendChild(wrap);
    messagesEl.appendChild(row);
    scrollToBottom();

    if (messagesEl.querySelectorAll('.msg.user').length === 1) {
      const title = text || (files && files[0] && files[0].file.name) || 'New chat';
      const trimmed = title.length > 40 ? title.slice(0, 40) + '…' : title;
      setChatTitle(trimmed);
      historyTitles.push(trimmed);
      localStorage.setItem(skin.historyKey, JSON.stringify(historyTitles.slice(-20)));
      renderHistory();
    }
  }

  function addThinkingRow(label) {
    const row = document.createElement('div');
    row.className = 'msg assistant';
    row.innerHTML = `
      <div class="thinking-row">
        <span class="thinking-label">${escapeHtml(label || 'Thinking')}</span>
        <span class="thinking-dots"><span></span><span></span><span></span></span>
        <span class="thinking-time">0.0s</span>
      </div>
    `;
    messagesEl.appendChild(row);
    scrollToBottom();
    return row;
  }

  async function thinkFor(row, ms) {
    const stop = countUp(row.querySelector('.thinking-time'));
    await sleep(ms);
    stop();
  }

  function addAssistantBubble() {
    const row = document.createElement('div');
    row.className = 'msg assistant';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    row.appendChild(bubble);

    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    actions.style.display = 'none';
    actions.innerHTML = `
      <button class="msg-action-btn" title="Read aloud" type="button">
        <svg viewBox="0 0 24 24" width="17" height="17"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M4 9v6h4l5 4V5L8 9H4z"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M17 8a5 5 0 0 1 0 8"/></svg>
      </button>
      <button class="msg-action-btn" title="Copy" type="button" data-copy>
        <svg viewBox="0 0 24 24" width="16" height="16"><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>
      </button>
      <button class="msg-action-btn" title="Good response" type="button">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M7 11v9H4v-9h3zm0 0l3.5-7a2 2 0 0 1 3.7 1l-.8 4.5H18a2 2 0 0 1 1.9 2.7l-2 6A2 2 0 0 1 16 20H7"/></svg>
      </button>
      <button class="msg-action-btn" title="Bad response" type="button">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M17 13V4h3v9h-3zm0 0l-3.5 7a2 2 0 0 1-3.7-1l.8-4.5H6a2 2 0 0 1-1.9-2.7l2-6A2 2 0 0 1 8 4h9"/></svg>
      </button>
      <button class="msg-action-btn" title="Regenerate" type="button">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M3 12a9 9 0 1 1 2.6 6.4M3 12v6h6"/></svg>
      </button>
    `;
    row.appendChild(actions);
    messagesEl.appendChild(row);
    scrollToBottom();

    const copyBtn = actions.querySelector('[data-copy]');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(bubble.innerText);
        copyBtn.style.color = 'var(--text)';
        setTimeout(() => (copyBtn.style.color = ''), 900);
      } catch (err) {
        /* clipboard unavailable — nothing to do */
      }
    });

    return bubble;
  }

  function finishBubble(bubble) {
    const actions = bubble.parentElement.querySelector('.msg-actions');
    if (actions) actions.style.display = '';
    scrollToBottom();
  }

  function addActivationBlock(bubble, tag, echo) {
    const tagEl = document.createElement('div');
    tagEl.className = 'activation-tag';
    tagEl.textContent = tag;
    bubble.appendChild(tagEl);

    if (echo) {
      const echoEl = document.createElement('div');
      echoEl.className = 'activation-echo';
      echoEl.textContent = echo;
      bubble.appendChild(echoEl);
    }
    scrollToBottom();
  }

  function addWriteRow(bubble, label) {
    const row = document.createElement('div');
    row.className = 'write-row';
    row.innerHTML = `
      <span class="write-spinner"></span>
      <span class="write-label">${escapeHtml(label)}</span>
      <span class="write-time">0.0s</span>
    `;
    bubble.appendChild(row);
    scrollToBottom();
    return row;
  }

  function addFileCard(bubble, file) {
    const name = file.name || 'output.py';
    const ext = (name.split('.').pop() || 'txt').toLowerCase();
    const bytes = typeof file.bytes === 'number' ? file.bytes : (file.content || '').length;
    const url = URL.createObjectURL(new Blob([file.content || ''], { type: 'text/plain' }));

    const card = document.createElement('a');
    card.className = 'file-card';
    card.href = url;
    card.download = name;
    card.innerHTML = `
      <span class="file-card-icon">${escapeHtml(ext)}</span>
      <span class="file-card-meta">
        <span class="file-card-name">${escapeHtml(name)}</span>
        <span class="file-card-sub">${(bytes / 1024).toFixed(1)} KB · ${escapeHtml(file.language || 'text')}</span>
      </span>
      <span class="file-card-dl">
        <svg viewBox="0 0 24 24" width="19" height="19"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 4v11m0 0l-4.2-4.2M12 15l4.2-4.2M5 19h14"/></svg>
      </span>
    `;
    bubble.appendChild(card);
    scrollToBottom();
    return card;
  }

  function setBusy(busy) {
    sendBtn.disabled = busy;
  }

  setChatTitle('New chat');

  // ---------------- Send flow ----------------
  async function sendMessage(text, files) {
    addUserMessage(text, files);
    setBusy(true);

    const thinkRow = addThinkingRow('Thinking');
    let data = null;
    let failed = false;

    try {
      const fileMeta = (files || []).map((f) => ({
        name: f.file.name,
        size: f.file.size,
        type: f.file.type,
      }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
        },
        body: JSON.stringify({ message: text, files: fileMeta, variant: VARIANT, model, mode }),
      });
      data = await res.json();
      if (data.sessionId) {
        sessionId = data.sessionId;
        localStorage.setItem(skin.sessionKey, sessionId);
      }
    } catch (err) {
      failed = true;
    }

    // The model always "thinks" for a beat first — for an accepted request it
    // counts all the way up to the selected reasoning effort.
    await thinkFor(thinkRow, failed ? 700 : data.thinkMs || 2000);
    thinkRow.remove();

    if (failed) {
      const bubble = addAssistantBubble();
      bubble.innerHTML = '<p>Something went wrong. Please try again.</p>';
      finishBubble(bubble);
      setBusy(false);
      return;
    }

    const bubble = addAssistantBubble();

    if (data.kind === 'activation') {
      addActivationBlock(bubble, data.tag || '[ Hans Lands ] - Challenge Accepted', data.echo);
    }

    if (data.kind === 'code' && /```/.test(data.text || '')) {
      await streamCode(bubble, data.text);
    } else if (data.text) {
      appendMarkdown(bubble, data.text);
    }

    // "Writing <file>" beats: the label + timer sit there for 5–10s, then the
    // finished file drops in underneath as a real attachment card.
    for (const step of data.steps || []) {
      const row = addWriteRow(bubble, step.label || 'Writing file');
      const stop = countUp(row.querySelector('.write-time'));
      await sleep(step.waitMs || 6000);
      stop();
      row.remove();
      if (step.file) addFileCard(bubble, step.file);
    }

    (data.files || []).forEach((file) => addFileCard(bubble, file));

    finishBubble(bubble);
    setBusy(false);
  }
})();
