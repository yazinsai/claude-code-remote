import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// Generate a short random token if not provided via env (8 chars for easy mobile typing)
const AUTH_TOKEN = process.env.CLAUDE_REMOTE_TOKEN || crypto.randomBytes(4).toString('hex');

export function getAuthToken(): string {
  return AUTH_TOKEN;
}

// Express middleware for HTTP routes
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }

  const token = authHeader.replace('Bearer ', '');

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
