/* global Office, PowerPoint, ChatPanel */

Office.onReady(() => {
  const urlInput = document.getElementById('server-url');
  if (urlInput) {
    wsUrl = urlInput.value.replace(/\/$/, '');
    urlInput.addEventListener('change', () => {
      wsUrl = urlInput.value.replace(/\/$/, '');
    });
  }

  document.getElementById('btn-reconnect').addEventListener('click', () => {
    wsUrl = document.getElementById('server-url').value.replace(/\/$/, '');
    connect();
  });

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${tab}`).classList.add('active');
    });
  });

  const sidEl = document.getElementById('session-id');
  if (sidEl) sidEl.textContent = sessionId;

  _initAutoStart();
  connect();
});

let wsUrl = 'wss://localhost:12309';
let ws = null;
let reconnectTimer = null;

const sessionId = _loadOrCreateSessionId();
let documentName = _getDocumentName();

// ── WebSocket connection ───────────────────────────────────────────────────

function connect() {
  clearTimeout(reconnectTimer);
  if (ws) {
    ws.onclose = null;
    ws.close();
  }

  setStatus('connecting');
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    setStatus('connected');
    send({ type: 'ready', sessionId, documentName });
    log(`Connected — session: ${sessionId}`);
    _resolveDocumentName();
    if (!window.chatPanel) {
      window.chatPanel = new ChatPanel(document.getElementById('chat-container'));
    }
  };

  ws.onmessage = async (event) => {
    let cmd;
    try {
      cmd = JSON.parse(event.data);
    } catch (e) {
      log(`Bad message: ${event.data}`);
      return;
    }
    if (cmd.type && cmd.type.startsWith('chat_')) {
      if (window.chatPanel) window.chatPanel.handleEvent(cmd);
      return;
    }
    if (cmd.sessionId && cmd.sessionId !== sessionId) return;
    log(`▶ ${JSON.stringify(cmd, null, 2)}`);
    const result = await executeCommand(cmd);
    send({ id: cmd.id, sessionId, ...result });
  };

  ws.onerror = () => setStatus('disconnected');

  ws.onclose = () => {
    setStatus('disconnected');
    reconnectTimer = setTimeout(connect, 3000);
  };
}

function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ── Command dispatcher ─────────────────────────────────────────────────────

async function executeCommand(cmd) {
  try {
    switch (cmd.action) {
      case 'add_slide':
        return await cmdAddSlide(cmd);
      case 'delete_slide':
        return await cmdDeleteSlide(cmd);
      case 'set_title':
        return await cmdSetTitle(cmd);
      case 'set_text':
        return await cmdSetText(cmd);
      case 'add_textbox':
        return await cmdAddTextbox(cmd);
      case 'exec':
        return await cmdExec(cmd);
      case 'screenshot':
        return await cmdScreenshot(cmd);
      default:
        return { ok: false, error: `unknown action: ${cmd.action}` };
    }
  } catch (e) {
    log(`✖ ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// ── Commands ───────────────────────────────────────────────────────────────

async function cmdAddSlide(cmd) {
  await PowerPoint.run(async (ctx) => {
    const opts = {};
    if (cmd.layout) opts.layoutName = cmd.layout;
    ctx.presentation.slides.add(opts);
    await ctx.sync();
  });
  return { ok: true };
}

async function cmdDeleteSlide(cmd) {
  await PowerPoint.run(async (ctx) => {
    const slide = ctx.presentation.slides.getItemAt(cmd.slideIndex ?? 0);
    slide.delete();
    await ctx.sync();
  });
  return { ok: true };
}

async function cmdSetTitle(cmd) {
  await PowerPoint.run(async (ctx) => {
    const slide = ctx.presentation.slides.getItemAt(cmd.slideIndex ?? 0);
    const shapes = slide.shapes;
    shapes.load('items/name,items/textFrame');
    await ctx.sync();
    const shape = shapes.items.find((s) => /title/i.test(s.name)) || shapes.items[0];
    if (shape) {
      shape.textFrame.textRange.text = cmd.text ?? '';
      await ctx.sync();
    }
  });
  return { ok: true };
}

async function cmdSetText(cmd) {
  await PowerPoint.run(async (ctx) => {
    const slide = ctx.presentation.slides.getItemAt(cmd.slideIndex ?? 0);
    const shapes = slide.shapes;
    shapes.load('items/name,items/textFrame');
    await ctx.sync();
    const shape = shapes.items.find((s) => s.name === cmd.shapeName);
    if (!shape) throw new Error(`shape not found: ${cmd.shapeName}`);
    shape.textFrame.textRange.text = cmd.text ?? '';
    await ctx.sync();
  });
  return { ok: true };
}

async function cmdAddTextbox(cmd) {
  await PowerPoint.run(async (ctx) => {
    const slide = ctx.presentation.slides.getItemAt(cmd.slideIndex ?? 0);
    slide.shapes.addTextBox(cmd.text ?? '', {
      left: cmd.left ?? 100,
      top: cmd.top ?? 100,
      width: cmd.width ?? 300,
      height: cmd.height ?? 50,
    });
    await ctx.sync();
  });
  return { ok: true };
}

async function cmdExec(cmd) {
  if (!cmd.code) return { ok: false, error: 'missing code' };
  const result = await window.executePpt(cmd.code);
  return { ok: true, result: result ?? null };
}

async function cmdScreenshot(cmd) {
  const slideIndex = cmd.slideIndex ?? 0;
  const imageBase64 = await window.executePpt(
    `const slide = context.presentation.slides.getItemAt(${slideIndex});` +
      `const img = slide.getImageAsBase64();` +
      `await context.sync();` +
      `return img.value;`,
  );
  return { ok: true, imageBase64, slideIndex };
}

// ── UI helpers (DOM-safe) ──────────────────────────────────────────────────

function setStatus(state) {
  const dot = document.getElementById('status-dot');
  const txt = document.getElementById('status-text');
  if (!dot || !txt) return;
  const labels = {
    connected: 'Connected',
    disconnected: 'Disconnected',
    connecting: 'Connecting…',
  };
  dot.className = `dot ${state}`;
  txt.textContent = labels[state] ?? state;
}

function log(msg) {
  const el = document.getElementById('log');
  if (el) el.textContent = msg;
}

// ── Auto-start (setStartupBehavior) ───────────────────────────────────────

async function _initAutoStart() {
  const btn = document.getElementById('btn-autostart');
  const statusEl = document.getElementById('autostart-status');
  if (!btn || !statusEl) return;

  let current = false;
  try {
    current = (await Office.addin.getStartupBehavior()) === Office.StartupBehavior.load;
  } catch {
    statusEl.textContent = 'not supported';
    btn.style.display = 'none';
    return;
  }

  _renderAutoStart(current, statusEl, btn);

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const next = !((await Office.addin.getStartupBehavior()) === Office.StartupBehavior.load);
      await Office.addin.setStartupBehavior(
        next ? Office.StartupBehavior.load : Office.StartupBehavior.none,
      );
      _renderAutoStart(next, statusEl, btn);
    } catch (e) {
      statusEl.textContent = 'error: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  });
}

function _renderAutoStart(enabled, statusEl, btn) {
  if (enabled) {
    statusEl.textContent = 'On — connects on document open';
    statusEl.className = 'on';
    btn.textContent = 'Disable';
  } else {
    statusEl.textContent = 'Off';
    statusEl.className = 'off';
    btn.textContent = 'Enable';
  }
}

// ── Session helpers ────────────────────────────────────────────────────────

async function _resolveDocumentName() {
  if (documentName !== 'Unknown') return;
  const MAX_ATTEMPTS = 24; // 24 × 5s = 2 min
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const name = await _getDocumentNameAsync();
    if (name && name !== 'Unknown') {
      documentName = name;
      send({ type: 'update_name', sessionId, documentName: name });
      return;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

function _getDocumentNameAsync() {
  return new Promise((resolve) => {
    try {
      Office.context.document.getFilePropertiesAsync((result) => {
        const url = result.status === Office.AsyncResultStatus.Succeeded && result.value?.url;
        if (url) {
          const decoded = decodeURIComponent(url);
          const name = decoded.split('/').pop().split('\\').pop();
          resolve(name || 'Unknown');
        } else {
          resolve('Unknown');
        }
      });
    } catch {
      resolve('Unknown');
    }
  });
}

function _loadOrCreateSessionId() {
  const key = 'rgm_ppt_session_id';
  let sid = null;
  try {
    sid = sessionStorage.getItem(key);
  } catch {}
  if (!sid) {
    sid =
      'ppt_' +
      Array.from(crypto.getRandomValues(new Uint8Array(5)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    try {
      sessionStorage.setItem(key, sid);
    } catch {}
  }
  return sid;
}

function _getDocumentName() {
  try {
    const url = decodeURIComponent(Office.context.document.url || '');
    if (url) return url.split('/').pop().split('\\').pop() || 'Unknown';
  } catch {}
  return 'Unknown';
}

function sendChat(message) {
  send({ type: 'chat', sessionId, message });
}

function sendChatAbort() {
  send({ type: 'chat_abort', sessionId });
}

window.sendChat = sendChat;
window.sendChatAbort = sendChatAbort;
