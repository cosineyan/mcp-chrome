/* global marked */

class ChatPanel {
  constructor(container) {
    this._container = container;
    this._busy = false;
    this._currentMsg = null;
    this._currentContent = '';
    this._busyStart = 0;
    this._heartbeatTimer = null;
    this._lastStatusText = '';
    this._render();
  }

  _render() {
    this._container.innerHTML = `
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-status" id="chat-status"></div>
      <div class="chat-input-area">
        <textarea id="chat-input" placeholder="Ask Claude about this presentation…" rows="3"></textarea>
        <div class="chat-btn-row">
          <button class="chat-send-btn" id="chat-send">Send</button>
          <button class="chat-stop-btn" id="chat-stop">Stop</button>
        </div>
      </div>
    `;

    this._messagesEl = document.getElementById('chat-messages');
    this._statusEl = document.getElementById('chat-status');
    this._inputEl = document.getElementById('chat-input');
    this._sendBtn = document.getElementById('chat-send');
    this._stopBtn = document.getElementById('chat-stop');

    this._sendBtn.addEventListener('click', () => this._send());
    this._inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._send();
      }
    });
    this._stopBtn.addEventListener('click', () => {
      if (window.sendChatAbort) window.sendChatAbort();
    });

    this._setBusy(false);
  }

  _send() {
    const text = this._inputEl.value.trim();
    if (!text || this._busy) return;
    this._inputEl.value = '';
    this._addMessage('user', text);
    if (window.sendChat) window.sendChat(text);
    this._setBusy(true);
  }

  _addMessage(role, text) {
    const msg = document.createElement('div');
    msg.className = `chat-msg ${role}`;
    if (role === 'assistant') {
      msg.innerHTML = this._toHtml(text);
    } else {
      msg.textContent = text;
    }
    this._messagesEl.appendChild(msg);
    this._messagesEl.scrollTop = this._messagesEl.scrollHeight;
    return msg;
  }

  _toHtml(text) {
    if (typeof marked !== 'undefined') return marked.parse(text);
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');
  }

  _setBusy(busy) {
    this._busy = busy;
    this._sendBtn.disabled = busy;
    this._stopBtn.style.display = busy ? '' : 'none';
    if (busy) {
      this._busyStart = Date.now();
      this._startHeartbeat();
    } else {
      this._stopHeartbeat();
      this._statusEl.textContent = '';
      this._statusEl.style.display = 'none';
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (this._statusEl.style.display !== 'none' && this._lastStatusText) {
        const elapsed = Math.round((Date.now() - this._busyStart) / 1000);
        this._statusEl.textContent =
          elapsed >= 5 ? `${this._lastStatusText} (${elapsed}s)` : this._lastStatusText;
      }
    }, 3000);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  handleEvent(msg) {
    switch (msg.type) {
      case 'chat_status':
        this._lastStatusText = msg.status === 'thinking' ? 'Claude is thinking…' : msg.status;
        this._statusEl.textContent = this._lastStatusText;
        this._statusEl.style.display = 'block';
        break;

      case 'chat_delta':
        if (msg.content) {
          this._statusEl.style.display = 'none';
          if (!this._currentMsg) {
            this._currentMsg = this._addMessage('assistant', '');
            this._currentContent = '';
          }
          this._currentContent += msg.content;
          this._currentMsg.innerHTML = this._toHtml(this._currentContent);
          this._messagesEl.scrollTop = this._messagesEl.scrollHeight;
        }
        break;

      case 'chat_done':
        this._currentMsg = null;
        this._currentContent = '';
        this._setBusy(false);
        break;

      case 'chat_error':
        this._addMessage('assistant', `**Error:** ${msg.error || 'unknown error'}`);
        this._currentMsg = null;
        this._currentContent = '';
        this._setBusy(false);
        break;
    }
  }
}
