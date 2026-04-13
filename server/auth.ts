import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.claude-code-remote');
const AUTH_FILE = path.join(CONFIG_DIR, 'auth.json');

function loadOrCreatePersistedToken(): string {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      const data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
      if (typeof data.token === 'string' && data.token.length > 0) {
        return data.token;
      }
    }
  } catch {
    // fall through to regenerate
  }
  const token = crypto.randomBytes(4).toString('hex');
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify({ token }, null, 2), { mode: 0o600 });
  } catch {
    // If persistence fails, still return the generated token for this session
  }
  return token;
}

// `--rotate-token` invalidates the persisted token (forces re-pair on all devices)
if (process.argv.includes('--rotate-token')) {
  try { if (fs.existsSync(AUTH_FILE)) fs.unlinkSync(AUTH_FILE); } catch { /* ignore */ }
}

// Token precedence: env override > persisted token > newly generated & persisted
const AUTH_TOKEN = process.env.CLAUDE_REMOTE_TOKEN || loadOrCreatePersistedToken();

export function getAuthToken(): string {
  return AUTH_TOKEN;
}

// Express middleware for HTTP routes
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Check Authorization header first, then query param (for iframes)
  const authHeader = req.headers.authorization;
  const queryToken = req.query.token as string | undefined;

  let token: string | undefined;

  if (authHeader) {
    token = authHeader.replace('Bearer ', '');
  } else if (queryToken) {
    token = queryToken;
  }

  if (!token) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }

  if (token !== AUTH_TOKEN) {
    res.status(403).json({ error: 'Invalid token' });
    return;
  }

  next();
}

// Validate token for WebSocket connections
export function validateToken(token: string): boolean {
  return token === AUTH_TOKEN;
}
