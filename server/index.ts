#!/usr/bin/env node

import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import qrcode from 'qrcode-terminal';
import { SessionManager } from './session-manager.js';
import type { ParsedOutput } from './pty-session.js';
import { getAuthToken, validateToken, authMiddleware } from './auth.js';
import { PortDetector } from './port-detector.js';
import { createPortProxy } from './port-proxy.js';
import { startTunnel, type TunnelResult } from './tunnel/index.js';
import { loadPreferences, savePreferences } from './preferences.js';
import { parseConfig } from './config.js';
import { Scheduler } from './scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config = parseConfig();
const PORT = config.port;
const DEV_MODE = config.devMode;
const sessionManager = new SessionManager();
const portDetector = new PortDetector();

// Broadcast helper for scheduler (initialized after wss is created)
let broadcastToAll: (msg: object) => void = () => {};

const app = express();
app.use(express.json());
app.use(cookieParser());

// Livereload in dev mode
if (DEV_MODE) {
  const livereload = await import('livereload');
  const connectLivereload = await import('connect-livereload');

  const lrServer = livereload.default.createServer({
    exts: ['html', 'css', 'js', 'ts'],
    delay: 100,
  });
  lrServer.watch(path.join(__dirname, '../web'));
  lrServer.watch(path.join(__dirname, '../server'));

  app.use(connectLivereload.default());
  console.log('\x1b[36m[Dev] Livereload enabled\x1b[0m');
}

// Serve static files (web frontend)
app.use(express.static(path.join(__dirname, '../web')));

// API routes (protected)
app.get('/api/sessions', authMiddleware, (_req, res) => {
  res.json(sessionManager.listSessions());
});

app.get('/api/ports', authMiddleware, async (_req, res) => {
  const ports = await portDetector.detectPorts();
  res.json(ports);
});

// Directory listing for autocomplete
app.get('/api/dirs', authMiddleware, (req, res) => {
  try {
    let inputPath = (req.query.path as string) || '';

    // Expand ~ to home directory
    if (inputPath.startsWith('~/')) {
      inputPath = inputPath.replace('~/', `${os.homedir()}/`);
    } else if (inputPath === '~') {
      inputPath = os.homedir();
    }

    // Determine base directory and prefix to search
    let dirToRead: string;
    let prefix: string;

    if (inputPath.endsWith('/')) {
      // User typed a complete directory path, list its contents
      dirToRead = inputPath;
      prefix = '';
    } else {
      // User is typing a name, list parent and filter
      dirToRead = path.dirname(inputPath) || '/';
      prefix = path.basename(inputPath).toLowerCase();
    }

    // Ensure path is absolute
    if (!path.isAbsolute(dirToRead)) {
      dirToRead = path.resolve(process.cwd(), dirToRead);
    }

    // Read directory
    const entries = fs.readdirSync(dirToRead, { withFileTypes: true });

    // Filter to directories only, apply prefix filter, limit results
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .filter(e => !prefix || e.name.toLowerCase().startsWith(prefix))
      .slice(0, 20)
      .map(e => {
        const fullPath = path.join(dirToRead, e.name);
        // Convert back to ~ notation for display
        const displayPath = fullPath.startsWith(os.homedir())
          ? fullPath.replace(os.homedir(), '~')
          : fullPath;
        return { name: e.name, path: displayPath + '/' };
      });

    res.json(dirs);
  } catch {
    res.json([]);
  }
});

// Port proxy routes (handles its own auth with cookie support)
app.use('/preview', createPortProxy());

const server = createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server });

// Initialize scheduler with broadcast
broadcastToAll = (msg: object) => {
  const buffer = Buffer.from(JSON.stringify(msg));
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      const clientWithAuth = client as WebSocket & { isAuthenticated?: boolean };
      if (clientWithAuth.isAuthenticated) {
        client.send(buffer);
      }
    }
  });
};
const scheduler = new Scheduler(process.cwd(), broadcastToAll);

interface ClientState {
  authenticated: boolean;
  sessionId: string | null;
  outputHandler: ((data: { raw: string; parsed: ParsedOutput[] }) => void) | null;
  exitHandler: ((code: number) => void) | null;
}

// Broadcast activity status to all authenticated clients every 5 seconds
setInterval(async () => {
  const sessions = sessionManager.listSessions();
  const externalSessions = await sessionManager.discoverExternalSessions();
  const statusMessage = JSON.stringify({ type: 'session:status', sessions, externalSessions });
  const statusBuffer = Buffer.from(statusMessage);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      // Only send to authenticated clients (we track this via custom property)
      const clientWithAuth = client as WebSocket & { isAuthenticated?: boolean };
      if (clientWithAuth.isAuthenticated) {
        client.send(statusBuffer);
      }
    }
  });
}, 5000);

wss.on('connection', (ws: WebSocket) => {
  const wsWithAuth = ws as WebSocket & { isAuthenticated?: boolean };
  const state: ClientState = {
    authenticated: false,
    sessionId: null,
    outputHandler: null,
    exitHandler: null,
  };

  ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
    // Binary messages = control (JSON)
    // Text messages = terminal input (raw)
    if (isBinary) {
      const str = Buffer.isBuffer(data) ? data.toString() : Buffer.from(data as ArrayBuffer).toString();
      let message: ControlMessage;
      try {
        message = JSON.parse(str);
      } catch {
        sendControl(ws, { type: 'error', error: 'Invalid control message' });
        return;
      }
      handleControlMessage(ws, state, message);
    } else {
      // Raw terminal input - forward to PTY
      if (state.authenticated && state.sessionId) {
        const session = sessionManager.getSession(state.sessionId);
        if (session) {
          const str = Buffer.isBuffer(data) ? data.toString() : data.toString();
          session.write(str);
        }
      }
    }
  });

  ws.on('close', () => {
    // Clean up event handlers
    if (state.sessionId && state.outputHandler) {
      const session = sessionManager.getSession(state.sessionId);
      if (session) {
        session.off('output', state.outputHandler);
        if (state.exitHandler) {
          session.off('exit', state.exitHandler);
        }
      }
    }
  });
});

// Send control message (binary)
function sendControl(ws: WebSocket, message: object) {
  ws.send(Buffer.from(JSON.stringify(message)));
}

interface ControlMessage {
  type: string;
  token?: string;
  cwd?: string;
  sessionId?: string;
  cols?: number;
  rows?: number;
  // Image upload
  data?: string;
  mimeType?: string;
  filename?: string;
  // Preferences
  preferences?: { notificationsEnabled?: boolean };
  // External session adoption
  pid?: number;
  // Client-side caching
  hasCache?: boolean;
  // Schedule fields
  name?: string;
  prompt?: string;
  preset?: string;
  scheduleId?: string;
  enabled?: boolean;
  timestamp?: string;
}

function handleControlMessage(ws: WebSocket, state: ClientState, message: ControlMessage) {
  // Auth required for all commands except 'auth'
  if (message.type !== 'auth' && !state.authenticated) {
    sendControl(ws, { type: 'error', error: 'Not authenticated' });
    return;
  }

  switch (message.type) {
    case 'auth': {
      if (message.token && validateToken(message.token)) {
        state.authenticated = true;
        // Mark WebSocket as authenticated for broadcast filtering
        (ws as WebSocket & { isAuthenticated?: boolean }).isAuthenticated = true;
        const preferences = loadPreferences();
        sendControl(ws, { type: 'auth:success', preferences });
      } else {
        sendControl(ws, { type: 'auth:failed', error: 'Invalid token' });
      }
      break;
    }

    case 'preferences:set': {
      if (message.preferences) {
        const updated = savePreferences(message.preferences);
        sendControl(ws, { type: 'preferences:updated', preferences: updated });
      }
      break;
    }

    case 'session:create': {
      // Clean up previous session handlers if any
      cleanupSessionHandlers(state);

      let cwd = message.cwd || process.cwd();
      // Expand ~ to home directory (shell doesn't do this for cwd)
      if (cwd.startsWith('~/')) {
        cwd = cwd.replace('~/', `${process.env.HOME || ''}/`);
      } else if (cwd === '~') {
        cwd = process.env.HOME || process.cwd();
      }

      // Validate that the directory exists
      if (!fs.existsSync(cwd)) {
        sendControl(ws, { type: 'error', error: `Directory does not exist: ${cwd}` });
        break;
      }

      // Validate it's actually a directory
      const stats = fs.statSync(cwd);
      if (!stats.isDirectory()) {
        sendControl(ws, { type: 'error', error: `Path is not a directory: ${cwd}` });
        break;
      }

      let session;
      try {
        session = sessionManager.createSession(cwd);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to create session';
        sendControl(ws, { type: 'error', error: errorMessage });
        break;
      }
      state.sessionId = session.id;

      // Subscribe to session output - send as raw text
      state.outputHandler = ({ raw, parsed }: { raw: string; parsed: ParsedOutput[] }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(raw); // Send as text (not binary)

          // Notify on ask_user events (input required)
          if (parsed?.some((p: ParsedOutput) => p.type === 'ask_user')) {
            const askEvent = parsed.find((p: ParsedOutput) => p.type === 'ask_user');
            sendControl(ws, {
              type: 'session:input_required',
              sessionId: session.id,
              sessionName: session.getInfo().cwd.split('/').pop(),
              preview: askEvent?.content?.slice(0, 150) || 'Input needed',
            });
          }
        }
      };
      session.on('output', state.outputHandler);

      state.exitHandler = (code: number) => {
        sendControl(ws, { type: 'session:exit', sessionId: session.id, exitCode: code });
      };
      session.on('exit', state.exitHandler);

      sendControl(ws, { type: 'session:created', session: session.getInfo() });
      break;
    }

    case 'session:list': {
      sendControl(ws, { type: 'session:list', sessions: sessionManager.listSessions() });
      break;
    }

    case 'session:discover': {
      // Discover external Claude Code sessions
      sessionManager.discoverExternalSessions()
        .then(externalSessions => {
          sendControl(ws, { type: 'session:discovered', sessions: externalSessions });
        })
        .catch(err => {
          sendControl(ws, { type: 'error', error: `Failed to discover sessions: ${err.message}` });
        });
      break;
    }

    case 'session:adopt': {
      // Adopt an external Claude session
      const { pid, cwd } = message;
      if (!pid || !cwd) {
        sendControl(ws, { type: 'error', error: 'Missing pid or cwd' });
        break;
      }

      // Clean up previous session handlers if any
      cleanupSessionHandlers(state);

      sessionManager.adoptExternalSession(pid, cwd)
        .then(session => {
          state.sessionId = session.id;

          // Subscribe to session output - send as raw text
          state.outputHandler = ({ raw, parsed }: { raw: string; parsed: ParsedOutput[] }) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(raw); // Send as text (not binary)

              // Notify on ask_user events (input required)
              if (parsed?.some((p: ParsedOutput) => p.type === 'ask_user')) {
                const askEvent = parsed.find((p: ParsedOutput) => p.type === 'ask_user');
                sendControl(ws, {
                  type: 'session:input_required',
                  sessionId: session.id,
                  sessionName: session.getInfo().cwd.split('/').pop(),
                  preview: askEvent?.content?.slice(0, 150) || 'Input needed',
                });
              }
            }
          };
          session.on('output', state.outputHandler);

          state.exitHandler = (code: number) => {
            sendControl(ws, { type: 'session:exit', sessionId: session.id, exitCode: code });
          };
          session.on('exit', state.exitHandler);

          sendControl(ws, {
            type: 'session:created',
            session: session.getInfo(),
            isAdopted: true,
          });
        })
        .catch(err => {
          sendControl(ws, { type: 'error', error: `Failed to adopt session: ${err.message}` });
        });
      break;
    }

    case 'session:attach': {
      const session = sessionManager.getSession(message.sessionId!);
      if (!session) {
        sendControl(ws, { type: 'error', error: 'Session not found' });
        return;
      }

      // Clean up previous session handlers if any
      cleanupSessionHandlers(state);

      state.sessionId = session.id;

      // Subscribe to session output - send as raw text
      state.outputHandler = ({ raw, parsed }: { raw: string; parsed: ParsedOutput[] }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(raw); // Send as text (not binary)

          // Notify on ask_user events (input required)
          if (parsed?.some((p: ParsedOutput) => p.type === 'ask_user')) {
            const askEvent = parsed.find((p: ParsedOutput) => p.type === 'ask_user');
            sendControl(ws, {
              type: 'session:input_required',
              sessionId: session.id,
              sessionName: session.getInfo().cwd.split('/').pop(),
              preview: askEvent?.content?.slice(0, 150) || 'Input needed',
            });
          }
        }
      };
      session.on('output', state.outputHandler);

      state.exitHandler = (code: number) => {
        sendControl(ws, { type: 'session:exit', sessionId: session.id, exitCode: code });
      };
      session.on('exit', state.exitHandler);

      // Send session info first
      sendControl(ws, { type: 'session:attached', session: session.getInfo() });

      // Only replay history if client doesn't have it cached
      if (!message.hasCache) {
        const history = session.getHistory();
        if (history && ws.readyState === WebSocket.OPEN) {
          ws.send(history); // Send as text (terminal output)
        }
      }
      break;
    }

    case 'resize': {
      const session = sessionManager.getSession(state.sessionId!);
      if (session && message.cols && message.rows) {
        try {
          session.resize(message.cols, message.rows);
        } catch {
          // PTY may have been closed, ignore resize errors
        }
      }
      break;
    }

    case 'session:destroy': {
      if (message.sessionId) {
        sessionManager.destroySession(message.sessionId);
        sendControl(ws, { type: 'session:destroyed', sessionId: message.sessionId });
      }
      break;
    }

    case 'image:upload': {
      const { data, mimeType } = message;
      if (!data) {
        sendControl(ws, { type: 'error', error: 'No image data provided' });
        break;
      }
      const ext = mimeType?.split('/')[1] || 'png';
      const tempPath = path.join(os.tmpdir(), `claude-remote-${Date.now()}.${ext}`);

      try {
        const buffer = Buffer.from(data, 'base64');
        fs.writeFileSync(tempPath, buffer);
        sendControl(ws, { type: 'image:uploaded', path: tempPath });
      } catch (err) {
        sendControl(ws, { type: 'error', error: 'Failed to save image' });
      }
      break;
    }

    case 'schedule:create': {
      const { name, prompt, cwd, preset } = message;
      if (!name || !prompt || !cwd || !preset) {
        sendControl(ws, { type: 'error', error: 'Missing required schedule fields' });
        break;
      }
      try {
        const schedule = scheduler.createSchedule(name, prompt, cwd, preset);
        broadcastToAll({ type: 'schedule:updated', schedule });
      } catch (err) {
        sendControl(ws, { type: 'error', error: err instanceof Error ? err.message : 'Failed to create schedule' });
      }
      break;
    }

    case 'schedule:update': {
      const { scheduleId, enabled } = message;
      if (!scheduleId) {
        sendControl(ws, { type: 'error', error: 'Missing scheduleId' });
        break;
      }
      try {
        const schedule = scheduler.updateSchedule(scheduleId, { enabled });
        broadcastToAll({ type: 'schedule:updated', schedule });
      } catch (err) {
        sendControl(ws, { type: 'error', error: err instanceof Error ? err.message : 'Failed to update schedule' });
      }
      break;
    }

    case 'schedule:delete': {
      const { scheduleId } = message;
      if (!scheduleId) {
        sendControl(ws, { type: 'error', error: 'Missing scheduleId' });
        break;
      }
      try {
        scheduler.deleteSchedule(scheduleId);
        broadcastToAll({ type: 'schedule:updated', deleted: scheduleId });
      } catch (err) {
        sendControl(ws, { type: 'error', error: err instanceof Error ? err.message : 'Failed to delete schedule' });
      }
      break;
    }

    case 'schedule:trigger': {
      const { scheduleId } = message;
      if (!scheduleId) {
        sendControl(ws, { type: 'error', error: 'Missing scheduleId' });
        break;
      }
      try {
        scheduler.triggerSchedule(scheduleId);
        sendControl(ws, { type: 'schedule:triggered', scheduleId });
      } catch (err) {
        sendControl(ws, { type: 'error', error: err instanceof Error ? err.message : 'Failed to trigger schedule' });
      }
      break;
    }

    case 'schedule:list': {
      sendControl(ws, { type: 'schedule:list', schedules: scheduler.listSchedules() });
      break;
    }

    case 'schedule:runs': {
      const { scheduleId } = message;
      if (!scheduleId) {
        sendControl(ws, { type: 'error', error: 'Missing scheduleId' });
        break;
      }
      sendControl(ws, { type: 'schedule:runs', scheduleId, runs: scheduler.listRuns(scheduleId) });
      break;
    }

    case 'schedule:log': {
      const { scheduleId, timestamp } = message;
      if (!scheduleId || !timestamp) {
        sendControl(ws, { type: 'error', error: 'Missing scheduleId or timestamp' });
        break;
      }
      try {
        const content = scheduler.getRunLog(scheduleId, timestamp);
        sendControl(ws, { type: 'schedule:log', scheduleId, timestamp, content });
      } catch (err) {
        sendControl(ws, { type: 'error', error: err instanceof Error ? err.message : 'Run log not found' });
      }
      break;
    }

    default:
      sendControl(ws, { type: 'error', error: `Unknown message type: ${message.type}` });
  }
}

function cleanupSessionHandlers(state: ClientState) {
  if (state.sessionId) {
    const session = sessionManager.getSession(state.sessionId);
    if (session) {
      if (state.outputHandler) {
        session.off('output', state.outputHandler);
      }
      if (state.exitHandler) {
        session.off('exit', state.exitHandler);
      }
    }
  }
  state.outputHandler = null;
  state.exitHandler = null;
}

// Track tunnel for cleanup
let tunnelResult: TunnelResult | null = null;

// Start server
// Load schedules before server starts listening
scheduler.loadSchedules();

server.listen(PORT, async () => {
  const token = getAuthToken();

  console.log('\n=================================');
  console.log('  Claude Code Remote');
  console.log('=================================\n');
  console.log(`Local: http://localhost:${PORT}?token=${token}`);

  // Start tunnel based on config
  tunnelResult = await startTunnel(PORT, config.tunnelType);
  const connectUrl = tunnelResult.url
    ? `${tunnelResult.url}?token=${token}`
    : `http://localhost:${PORT}?token=${token}`;

  console.log(`\nScan to connect:\n`);
  qrcode.generate(connectUrl, { small: true });

  if (tunnelResult.url) {
    if (tunnelResult.isPrivate) {
      console.log(`\nTailnet: ${connectUrl}`);
      console.log('(Accessible only to your Tailscale network)');
    } else {
      console.log(`\nPublic: ${connectUrl}`);
    }
  } else {
    console.log('\nNo tunnel available. Options:');
    console.log('  --tunnel=tailscale-serve  (requires Tailscale)');
    console.log('  --tunnel=tailscale-funnel (requires Tailscale + Funnel enabled)');
    console.log('  --tunnel=cloudflare       (requires cloudflared)');
  }

  console.log('\n=================================\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  tunnelResult?.cleanup();
  scheduler.destroy();
  sessionManager.destroyAll();
  server.close();
  process.exit(0);
});
