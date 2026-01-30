import { v4 as uuidv4 } from 'uuid';
import { PtySession, SessionInfo } from './pty-session.js';
import { ProcessDetector, ExternalProcessInfo } from './process-detector.js';

// Re-export for convenience
export type { ExternalProcessInfo };

export class SessionManager {
  private sessions: Map<string, PtySession> = new Map();
  private processDetector: ProcessDetector = new ProcessDetector();

  createSession(cwd: string, args: string[] = []): PtySession {
    const id = uuidv4().slice(0, 8);
    const session = new PtySession(id, cwd, args);

    try {
      session.start();
    } catch (err) {
      // Don't add the session to the map if it failed to start
      throw err;
    }

    // Only add to sessions map if start succeeded
    this.sessions.set(id, session);
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

  /**
   * Discover external Claude Code sessions running outside this server
   * @returns Array of external Claude processes not managed by this server
   */
  async discoverExternalSessions(): Promise<ExternalProcessInfo[]> {
    // Get PIDs of sessions managed by this server
    const managedPids = new Set<number>();
    for (const session of this.sessions.values()) {
      const pid = session.getPid();
      if (pid !== null) {
        managedPids.add(pid);
      }
    }

    const externalProcesses = await this.processDetector.detectClaudeProcesses(managedPids);
    return externalProcesses;
  }

  /**
   * Adopt an external Claude session by killing it and resuming with --continue
   * @param pid Process ID to kill
   * @param cwd Working directory of the external session
   * @returns New PtySession running in the same directory with --continue flag
   */
  async adoptExternalSession(pid: number, cwd: string): Promise<PtySession> {
    // Validate inputs
    if (!pid || pid <= 0) {
      throw new Error('Invalid process ID');
    }

    if (!cwd || typeof cwd !== 'string') {
      throw new Error('Invalid working directory');
    }

    // Verify the process is still running
    if (!this.processDetector.isProcessRunning(pid)) {
      throw new Error(`Process ${pid} is not running or already terminated`);
    }

    // Verify this process is actually a Claude process we discovered
    // (prevents arbitrary process termination)
    const discovered = await this.discoverExternalSessions();
    const isValid = discovered.some(p => p.pid === pid && p.cwd === cwd);
    if (!isValid) {
      throw new Error(`Process ${pid} is not a valid Claude Code session`);
    }

    // Kill the external process
    const killed = await this.processDetector.killProcess(pid);
    if (!killed) {
      throw new Error(`Failed to kill process ${pid} - permission denied or process protected`);
    }

    // Wait a bit for the process to fully terminate and release resources
    await new Promise(resolve => setTimeout(resolve, 150));

    // Verify process is actually dead
    if (this.processDetector.isProcessRunning(pid)) {
      throw new Error(`Process ${pid} could not be terminated`);
    }

    // Create new session with --continue flag
    const session = this.createSession(cwd, ['--continue']);
    return session;
  }
}
