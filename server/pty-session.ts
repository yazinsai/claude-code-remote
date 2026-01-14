import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import stripAnsi from 'strip-ansi';

export interface SessionInfo {
  id: string;
  cwd: string;
  createdAt: Date;
  status: 'running' | 'stopped';
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

export class PtySession extends EventEmitter {
  public readonly id: string;
  public readonly cwd: string;
  public readonly createdAt: Date;

  private pty: pty.IPty | null = null;
  private buffer: string = '';
  private status: 'running' | 'stopped' = 'stopped';

  constructor(id: string, cwd: string) {
    super();
    this.id = id;
    this.cwd = cwd;
    this.createdAt = new Date();
  }

  getInfo(): SessionInfo {
    return {
      id: this.id,
      cwd: this.cwd,
      createdAt: this.createdAt,
      status: this.status,
    };
  }

  start(): void {
    if (this.pty) {
      return;
    }

    // Spawn claude command in the specified directory
    const homedir = process.env.HOME || '';
    const claudePath = `${homedir}/.local/bin/claude`;

    this.pty = pty.spawn(claudePath, [], {
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
