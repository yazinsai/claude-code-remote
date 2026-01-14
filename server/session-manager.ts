import { v4 as uuidv4 } from 'uuid';
import { PtySession, SessionInfo } from './pty-session.js';

export class SessionManager {
  private sessions: Map<string, PtySession> = new Map();

  createSession(cwd: string): PtySession {
    const id = uuidv4().slice(0, 8);
    const session = new PtySession(id, cwd);
    this.sessions.set(id, session);
    session.start();
    return session;
  }

  getSession(id: string): PtySession | undefined {
    return this.sessions.get(id);
  }

  listSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => s.getInfo());
  }

  destroySession(id: string): boolean {
    const session = this.sessions.get(id);
    if (session) {
      session.stop();
      this.sessions.delete(id);
      return true;
    }
    return false;
  }

  destroyAll(): void {
    for (const session of this.sessions.values()) {
      session.stop();
    }
    this.sessions.clear();
  }
}
