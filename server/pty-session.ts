import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import stripAnsi from 'strip-ansi';
import * as fs from 'fs';
import { execSync } from 'child_process';

export type ActivityStatus = 'busy' | 'idle' | 'unknown';

export interface SessionInfo {
  id: string;
  cwd: string;
  createdAt: Date;
  status: 'running' | 'stopped';
  activityStatus: ActivityStatus;
}

export interface ParsedOutput {
  type: 'text' | 'tool_start' | 'tool_end' | 'ask_user' | 'diff';
  content: string;
  raw: string;
  metadata?: {
    toolName?: string;
    options?: Array<{ label: string; value: string }>;
    filePath?: string;
  };
}

const ACTIVITY_THRESHOLD_MS = 30000; // 30 seconds - same as external session detection

export class PtySession extends EventEmitter {
  public readonly id: string;
  public readonly cwd: string;
  public readonly createdAt: Date;

  private pty: pty.IPty | null = null;
  private buffer: string = '';
  private outputHistory: string = '';
  private static readonly MAX_HISTORY_SIZE = 100000; // ~100KB of history
  private status: 'running' | 'stopped' = 'stopped';
  private args: string[];
  private lastActivityTime: number = Date.now();

  constructor(id: string, cwd: string, args: string[] = []) {
    super();
    this.id = id;
    this.cwd = cwd;
    this.createdAt = new Date();
    this.args = args;
  }

  getInfo(): SessionInfo {
    return {
      id: this.id,
      cwd: this.cwd,
      createdAt: this.createdAt,
      status: this.status,
      activityStatus: this.getActivityStatus(),
    };
  }

  getActivityStatus(): ActivityStatus {
    if (this.status === 'stopped') {
      return 'idle';
    }
    const now = Date.now();
    return (now - this.lastActivityTime) < ACTIVITY_THRESHOLD_MS ? 'busy' : 'idle';
  }

  getHistory(): string {
    return this.outputHistory;
  }

  /**
   * Find the claude CLI binary using multiple strategies:
   * 1. CLAUDE_PATH env var (explicit override)
   * 2. 'which claude' (respects user's PATH)
   * 3. Common fallback paths
   */
  private static findClaudeBinary(): string {
    // 1. Check CLAUDE_PATH env var first (explicit override)
    if (process.env.CLAUDE_PATH) {
      if (fs.existsSync(process.env.CLAUDE_PATH)) {
        return process.env.CLAUDE_PATH;
      }
      throw new Error(
        `CLAUDE_PATH is set to "${process.env.CLAUDE_PATH}" but file does not exist`
      );
    }

    // 2. Try to find via 'which claude' (respects user's PATH)
    try {
      const whichResult = execSync('which claude', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      if (whichResult && fs.existsSync(whichResult)) {
        return whichResult;
      }
    } catch {
      // 'which' failed, continue to fallbacks
    }

    // 3. Check common fallback paths
    const homedir = process.env.HOME || '';
    const fallbackPaths = [
      `${homedir}/.local/bin/claude`,
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
      '/usr/bin/claude',
    ];

    for (const fallbackPath of fallbackPaths) {
      if (fs.existsSync(fallbackPath)) {
        return fallbackPath;
      }
    }

    // 4. None found - throw helpful error
    throw new Error(
      'Could not find claude CLI. Please ensure it is installed and either:\n' +
      '  - Set CLAUDE_PATH environment variable to the full path\n' +
      '  - Add the claude binary location to your PATH\n' +
      '  - Create a symlink: ln -s /path/to/claude ~/.local/bin/claude'
    );
  }

  start(): void {
    if (this.pty) {
      return;
    }

    // Find claude binary using multiple strategies
    const claudePath = PtySession.findClaudeBinary();

    this.pty = pty.spawn(claudePath, this.args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: this.cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        FORCE_COLOR: '1',
      },
    });

    this.status = 'running';

    this.pty.onData((data: string) => {
      this.buffer += data;
      this.lastActivityTime = Date.now(); // Track activity

      // Store in history (with size limit)
      this.outputHistory += data;
      if (this.outputHistory.length > PtySession.MAX_HISTORY_SIZE) {
        // Trim from the beginning, keeping recent output
        this.outputHistory = this.outputHistory.slice(-PtySession.MAX_HISTORY_SIZE);
      }

      // Emit raw output
      this.emit('output', {
        raw: data,
        parsed: this.parseOutput(data),
      });
    });

    this.pty.onExit(({ exitCode }) => {
      this.status = 'stopped';
      this.emit('exit', exitCode);
    });
  }

  write(data: string): void {
    if (this.pty) {
      this.pty.write(data);
    }
  }

  resize(cols: number, rows: number): void {
    if (this.pty) {
      this.pty.resize(cols, rows);
    }
  }

  stop(): void {
    if (this.pty) {
      this.pty.kill();
      this.pty = null;
      this.status = 'stopped';
    }
  }

  getPid(): number | null {
    return this.pty?.pid ?? null;
  }

  private parseOutput(data: string): ParsedOutput[] {
    const results: ParsedOutput[] = [];
    // Strip ANSI for pattern matching only (raw is preserved for colored rendering)
    const clean = stripAnsi(data);

    // Detect AskUserQuestion prompts with options
    // Claude Code shows these as numbered lists
    const optionPattern = /(\d+)\.\s+([^\n]+)/g;
    const matches = [...clean.matchAll(optionPattern)];

    if (matches.length >= 2 && clean.includes('?')) {
      const options = matches.map((m) => ({
        label: m[2].trim(),
        value: m[1],
      }));

      results.push({
        type: 'ask_user',
        content: clean,
        raw: data,
        metadata: { options },
      });

      return results;
    }

    // Detect tool usage patterns
    if (clean.includes('Read') || clean.includes('Edit') || clean.includes('Write') || clean.includes('Bash')) {
      const toolMatch = clean.match(/(Read|Edit|Write|Bash|Glob|Grep)/);
      if (toolMatch) {
        results.push({
          type: 'tool_start',
          content: clean,
          raw: data,
          metadata: { toolName: toolMatch[1] },
        });
        return results;
      }
    }

    // Detect diff output
    if (clean.includes('@@') && (clean.includes('+') || clean.includes('-'))) {
      results.push({
        type: 'diff',
        content: clean,
        raw: data,
      });
      return results;
    }

    // Default: plain text
    results.push({
      type: 'text',
      content: clean,
      raw: data,
    });

    return results;
  }
}
