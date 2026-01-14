// Claude Code Remote - xterm.js Client

class ClaudeRemote {
  constructor() {
    this.ws = null;
    this.terminal = null;
    this.fitAddon = null;
    this.currentSessionId = null;
    this.sessions = [];

    // Check URL for token first, then localStorage
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    this.token = urlToken || localStorage.getItem('authToken') || '';

    // Clean token from URL for security
    if (urlToken) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    this.initElements();
    this.bindEvents();
    this.initTerminal();

    // Auto-connect if we have a token
    if (urlToken) {
      this.elements.tokenInput.value = this.token;
      setTimeout(() => this.connect(), 100);
    } else if (this.token) {
      this.elements.tokenInput.value = this.token;
    }
  }

  initElements() {
    this.elements = {
      // Screens
      authScreen: document.getElementById('auth-screen'),
      mainScreen: document.getElementById('main-screen'),
      previewScreen: document.getElementById('preview-screen'),

      // Auth
      tokenInput: document.getElementById('token-input'),
      connectBtn: document.getElementById('connect-btn'),
      authError: document.getElementById('auth-error'),

      // Main
      header: document.getElementById('header'),
      sessionSelect: document.getElementById('session-select'),
      newSessionBtn: document.getElementById('new-session-btn'),
      previewBtn: document.getElementById('preview-btn'),
      toggleHeaderBtn: document.getElementById('toggle-header-btn'),
      terminalContainer: document.getElementById('terminal-container'),

      // Preview
      backBtn: document.getElementById('back-btn'),
      portSelect: document.getElementById('port-select'),
      refreshPreviewBtn: document.getElementById('refresh-preview-btn'),
      previewFrame: document.getElementById('preview-frame'),

      // Modal
      newSessionModal: document.getElementById('new-session-modal'),
      cwdInput: document.getElementById('cwd-input'),
      cancelSessionBtn: document.getElementById('cancel-session-btn'),
      createSessionBtn: document.getElementById('create-session-btn'),
    };
  }

  initTerminal() {
    // Create terminal with mobile-friendly settings
    this.terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#264f78',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff',
      },
      scrollback: 5000,
      allowTransparency: false,
      convertEol: true,
    });

    // Add fit addon for responsive sizing
    this.fitAddon = new FitAddon.FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    // Add web links addon for clickable URLs
    const webLinksAddon = new WebLinksAddon.WebLinksAddon();
    this.terminal.loadAddon(webLinksAddon);

    // Open terminal in container
    this.terminal.open(this.elements.terminalContainer);

    // Handle terminal input -> send to server
    this.terminal.onData((data) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentSessionId) {
        this.ws.send(data); // Send as text
      }
    });

    // Handle resize -> notify server
    this.terminal.onResize(({ cols, rows }) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentSessionId) {
        this.sendControl({ type: 'resize', cols, rows });
      }
    });

    // Fit terminal on window resize
    window.addEventListener('resize', () => this.fitTerminal());

    // Use ResizeObserver for container changes
    const resizeObserver = new ResizeObserver(() => this.fitTerminal());
    resizeObserver.observe(this.elements.terminalContainer);
  }

  fitTerminal() {
    if (this.fitAddon && this.elements.mainScreen.classList.contains('active')) {
      try {
        this.fitAddon.fit();
      } catch (e) {
        // Ignore fit errors during transitions
      }
    }
  }

  bindEvents() {
    // Auth
    this.elements.connectBtn.addEventListener('click', () => this.connect());
    this.elements.tokenInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.connect();
    });

    // Main
    this.elements.sessionSelect.addEventListener('change', (e) => {
      if (e.target.value) this.attachSession(e.target.value);
    });
    this.elements.newSessionBtn.addEventListener('click', () => this.showNewSessionModal());
    this.elements.previewBtn.addEventListener('click', () => this.showPreview());
    this.elements.toggleHeaderBtn.addEventListener('click', () => this.toggleHeader());

    // Preview
    this.elements.backBtn.addEventListener('click', () => this.hidePreview());
    this.elements.portSelect.addEventListener('change', (e) => this.loadPreview(e.target.value));
    this.elements.refreshPreviewBtn.addEventListener('click', () => {
      const port = this.elements.portSelect.value;
      if (port) this.loadPreview(port);
    });

    // Modal
    this.elements.cancelSessionBtn.addEventListener('click', () => this.hideNewSessionModal());
    this.elements.createSessionBtn.addEventListener('click', () => this.createSession());
  }

  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');

    // Fit terminal when showing main screen
    if (screenId === 'main-screen') {
      setTimeout(() => this.fitTerminal(), 50);
    }
  }

  toggleHeader() {
    this.elements.header.classList.toggle('collapsed');
    this.elements.toggleHeaderBtn.textContent = this.elements.header.classList.contains('collapsed') ? 'v' : '^';
    setTimeout(() => this.fitTerminal(), 300);
  }

  connect() {
    const token = this.elements.tokenInput.value.trim();
    if (!token) {
      this.elements.authError.textContent = 'Please enter a token';
      return;
    }

    this.token = token;
    this.elements.authError.textContent = '';
    this.elements.connectBtn.disabled = true;
    this.elements.connectBtn.textContent = 'Connecting...';

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      // Send auth as binary (control message)
      this.sendControl({ type: 'auth', token });
    };

    this.ws.onmessage = (event) => {
      // Check if binary (control) or text (terminal output)
      if (event.data instanceof Blob) {
        // Binary = control message
        event.data.text().then(text => {
          const message = JSON.parse(text);
          this.handleControlMessage(message);
        });
      } else if (event.data instanceof ArrayBuffer) {
        // Binary = control message
        const text = new TextDecoder().decode(event.data);
        const message = JSON.parse(text);
        this.handleControlMessage(message);
      } else {
        // Text = terminal output -> write to xterm
        this.terminal.write(event.data);
      }
    };

    this.ws.onerror = () => {
      this.elements.authError.textContent = 'Connection failed';
      this.elements.connectBtn.disabled = false;
      this.elements.connectBtn.textContent = 'Connect';
    };

    this.ws.onclose = () => {
      if (this.elements.mainScreen.classList.contains('active')) {
        this.terminal.writeln('\r\n\x1b[33mDisconnected. Please reconnect.\x1b[0m');
      }
      this.elements.connectBtn.disabled = false;
      this.elements.connectBtn.textContent = 'Connect';
    };
  }

  sendControl(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Send as binary (ArrayBuffer)
      const data = new TextEncoder().encode(JSON.stringify(message));
      this.ws.send(data);
    }
  }

  handleControlMessage(message) {
    switch (message.type) {
      case 'auth:success':
        localStorage.setItem('authToken', this.token);
        this.showScreen('main-screen');
        this.sendControl({ type: 'session:list' });
        this.loadPorts();
        this.fitTerminal();
        break;

      case 'auth:failed':
        this.elements.authError.textContent = message.error || 'Authentication failed';
        this.elements.connectBtn.disabled = false;
        this.elements.connectBtn.textContent = 'Connect';
        break;

      case 'session:list':
        this.updateSessionList(message.sessions);
        break;

      case 'session:created':
      case 'session:attached':
        this.currentSessionId = message.session.id;
        this.terminal.clear();
        this.terminal.writeln(`\x1b[32mConnected to session: ${message.session.id}\x1b[0m`);
        this.terminal.writeln(`\x1b[90mWorking directory: ${message.session.cwd}\x1b[0m\r\n`);
        this.sendControl({ type: 'session:list' });
        // Send initial size
        const { cols, rows } = this.terminal;
        this.sendControl({ type: 'resize', cols, rows });
        // Focus terminal
        this.terminal.focus();
        break;

      case 'session:exit':
        this.terminal.writeln(`\r\n\x1b[33mSession exited with code ${message.exitCode}\x1b[0m`);
        break;

      case 'error':
        this.terminal.writeln(`\r\n\x1b[31mError: ${message.error}\x1b[0m`);
        break;
    }
  }

  updateSessionList(sessions) {
    this.sessions = sessions;
    const select = this.elements.sessionSelect;
    const currentValue = select.value;

    select.innerHTML = '<option value="">Select session...</option>';
    for (const session of sessions) {
      const option = document.createElement('option');
      option.value = session.id;
      option.textContent = `${session.id.slice(0, 8)} - ${session.cwd.split('/').pop()}`;
      select.appendChild(option);
    }

    // Restore selection
    if (this.currentSessionId) {
      select.value = this.currentSessionId;
    } else if (currentValue) {
      select.value = currentValue;
    }
  }

  attachSession(sessionId) {
    this.terminal.clear();
    this.sendControl({ type: 'session:attach', sessionId });
  }

  showNewSessionModal() {
    this.elements.newSessionModal.classList.remove('hidden');
    this.elements.cwdInput.focus();
  }

  hideNewSessionModal() {
    this.elements.newSessionModal.classList.add('hidden');
    this.elements.cwdInput.value = '';
  }

  createSession() {
    const cwd = this.elements.cwdInput.value.trim() || undefined;
    this.terminal.clear();
    this.sendControl({ type: 'session:create', cwd });
    this.hideNewSessionModal();
  }

  async loadPorts() {
    try {
      const response = await fetch('/api/ports', {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      const ports = await response.json();

      const select = this.elements.portSelect;
      select.innerHTML = '<option value="">Select port...</option>';

      for (const port of ports) {
        const option = document.createElement('option');
        option.value = port.port;
        option.textContent = `${port.port} - ${port.process}`;
        select.appendChild(option);
      }
    } catch (err) {
      console.error('Failed to load ports:', err);
    }
  }

  showPreview() {
    this.showScreen('preview-screen');
    this.loadPorts();
  }

  hidePreview() {
    this.showScreen('main-screen');
    this.elements.previewFrame.src = 'about:blank';
  }

  loadPreview(port) {
    if (!port) return;
    this.elements.previewFrame.src = `/preview/${port}/`;
  }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new ClaudeRemote());
} else {
  new ClaudeRemote();
}
